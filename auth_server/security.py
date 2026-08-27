"""
Security utilities for the IAM auth server.

Provides:
  - CSRF token generation, validation, cookie binding
  - IP- + identifier-based rate limiting backed by Redis
  - Persistent RSA keypair for OIDC token signing (loaded from / written to disk)
  - Audit logging of sensitive events
  - Helpers for setting hardened cookies (Secure, SameSite, HttpOnly)
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from functools import wraps
from typing import Callable, Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from itsdangerous import BadSignature, URLSafeSerializer

from config import settings
from redis_client import get_cache, set_cache, delete_cache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CSRF protection
# ---------------------------------------------------------------------------
# We bind a CSRF token to a double-submit cookie. The token value is stored
# in a signed cookie ("csrf_token"); the form must echo the same value in
# the "csrf_token" field. This means attackers who can't read the cookie
# (cross-origin forms) can't submit valid forms.

# A per-session secret is mixed into the cookie so stolen cookies are harder
# to forge. We rotate it on every successful login and on /authorize GET.

_CSRF_SECRET = settings.SECRET_KEY + "-csrf-v1"
_csrfs = URLSafeSerializer(_CSRF_SECRET, salt="iam-csrf")
_csrf_lock = threading.Lock()

CSRF_COOKIE_NAME = "iam_csrf"
CSRF_FIELD_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"


def generate_csrf_token(session_id: str) -> str:
    """Generate a CSRF token bound to a session id."""
    payload = {"s": session_id, "n": secrets.token_urlsafe(16)}
    return _csrfs.dumps(payload)


def _set_csrf_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        max_age=86400 * 7,
        httponly=False,  # JS does NOT need this; allow form to read it
        secure=_is_https(),
        samesite="lax",
        path="/",
    )


def issue_csrf(response: Response, session_id: str) -> str:
    """Generate a new CSRF token. Use this when you want to *force* rotation
    (e.g. after a successful login). The cookie is also set on `response`.

    For ordinary page renders, prefer just calling `render_template(...)`
    without passing `csrf_token` — it will reuse the existing cookie value
    (no rotation) which keeps the form and cookie in sync.
    """
    token = generate_csrf_token(session_id)
    _set_csrf_cookie(response, token)
    return token


def get_csrf_from_request(request: Request) -> Optional[str]:
    """Read CSRF token from header (preferred) or form."""
    h = request.headers.get(CSRF_HEADER_NAME)
    if h:
        return h
    # Form fallback is handled by route-level Form(...) param.
    cookie = request.cookies.get(CSRF_COOKIE_NAME)
    return cookie


async def validate_csrf(request: Request, form_token: Optional[str] = None) -> None:
    """Raise 403 if the form/header CSRF token does not match the cookie.

    Implements the double-submit cookie pattern: the value rendered into
    the form is exactly the value stored in the (signed) cookie. Attackers
    who can't read the cookie can't forge a valid form submission.
    """
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    if not cookie_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token missing")

    if form_token is None:
        try:
            form = await request.form()
            form_token = form.get(CSRF_FIELD_NAME)
        except Exception:
            form_token = None

    if not form_token or form_token != cookie_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token invalid")


# ---------------------------------------------------------------------------
# Rate limiting (Redis-backed, fixed window)
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    # Honour X-Forwarded-For when present (e.g. behind nginx / caddy)
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def rate_limit(scope: str, identifier: str, limit: int, window_seconds: int) -> int:
    """Fixed-window rate limit using Redis INCR.

    Returns the current counter value; caller should check `>= limit` to deny.
    """
    key = f"rl:{scope}:{identifier}:{int(time.time()) // window_seconds}"
    try:
        val = set_cache_incr(key, ttl=window_seconds + 5)
    except Exception:
        # Fail open if Redis is unavailable — log and allow
        logger.warning("Rate-limit Redis unavailable; allowing request")
        return 0
    if val >= limit:
        retry_after = window_seconds - (int(time.time()) % window_seconds)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Try again in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )
    return val


def set_cache_incr(key: str, ttl: int) -> int:
    """INCR a counter in Redis with an initial TTL."""
    from redis_client import redis_client
    if redis_client is None:
        return 0
    pipe = redis_client.pipeline()
    pipe.incr(key)
    pipe.expire(key, ttl)
    results = pipe.execute()
    return int(results[0])


def rate_limit_login(request: Request, email: str) -> None:
    ip = _client_ip(request)
    # 10 per IP and 10 per email per 5 minutes
    rate_limit("login_ip", ip, 10, 300)
    if email:
        rate_limit("login_email", email.lower(), 10, 300)


def rate_limit_signup(request: Request, email: str) -> None:
    ip = _client_ip(request)
    rate_limit("signup_ip", ip, 5, 600)
    if email:
        rate_limit("signup_email", email.lower(), 5, 600)


def rate_limit_otp(request: Request, email: str) -> None:
    ip = _client_ip(request)
    # OTP endpoints: 5/min per IP, 3/min per email
    rate_limit("otp_ip", ip, 5, 60)
    if email:
        rate_limit("otp_email", email.lower(), 3, 60)


def rate_limit_2fa(request: Request, user_id: str) -> None:
    ip = _client_ip(request)
    rate_limit("2fa_ip", ip, 10, 300)
    if user_id:
        rate_limit("2fa_user", user_id, 5, 300)


# ---------------------------------------------------------------------------
# Cookies — hardened defaults
# ---------------------------------------------------------------------------

def _is_https() -> bool:
    return settings.AUTH_SERVER_URL.startswith("https://")


def set_session_cookie(response: Response, name: str, value: str, max_age: int = 86400) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=max_age,
        httponly=True,
        secure=_is_https(),
        samesite="lax",
        path="/",
    )


def set_sso_cookie(response: Response, session_id: str, max_age: int = 86400) -> None:
    set_session_cookie(response, "sso_session", session_id, max_age=max_age)


def clear_session_cookie(response: Response, name: str) -> None:
    response.delete_cookie(key=name, path="/", secure=_is_https(), samesite="lax", httponly=True)


# ---------------------------------------------------------------------------
# Persistent RSA keypair for OIDC token signing
# ---------------------------------------------------------------------------

_KEY_DIR = os.environ.get("IAM_KEY_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".keys")
_PRIVATE_KEY_PATH = os.path.join(_KEY_DIR, "oidc_private.pem")
_PUBLIC_KEY_PATH = os.path.join(_KEY_DIR, "oidc_public.pem")
_KEY_KID = "iam-key-1"

_private_key: Optional[rsa.RSAPrivateKey] = None
_public_key: Optional[rsa.RSAPublicKey] = None
_key_lock = threading.Lock()


def _load_or_create_keys() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    global _private_key, _public_key
    with _key_lock:
        if _private_key is not None:
            return _private_key, _public_key

        os.makedirs(_KEY_DIR, exist_ok=True)

        if os.path.exists(_PRIVATE_KEY_PATH) and os.path.exists(_PUBLIC_KEY_PATH):
            try:
                with open(_PRIVATE_KEY_PATH, "rb") as f:
                    _private_key = serialization.load_pem_private_key(f.read(), password=None)
                with open(_PUBLIC_KEY_PATH, "rb") as f:
                    _public_key = serialization.load_pem_public_key(f.read())
                logger.info("Loaded persistent OIDC RSA keypair from %s", _KEY_DIR)
                return _private_key, _public_key
            except Exception as e:
                logger.warning("Failed to load existing keypair (%s); generating new one", e)

        # Generate a fresh 2048-bit keypair
        priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pub = priv.public_key()

        try:
            with open(_PRIVATE_KEY_PATH, "wb") as f:
                f.write(priv.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption(),
                ))
            with open(_PUBLIC_KEY_PATH, "wb") as f:
                f.write(pub.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo,
                ))
            os.chmod(_PRIVATE_KEY_PATH, 0o600)
            logger.info("Generated and persisted new OIDC RSA keypair at %s", _KEY_DIR)
        except Exception as e:
            logger.warning("Could not persist OIDC keypair (%s); keys are in-memory only", e)

        _private_key = priv
        _public_key = pub
        return _private_key, _public_key


def get_private_pem() -> str:
    priv, _ = _load_or_create_keys()
    return priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")


def get_public_pem() -> str:
    _, pub = _load_or_create_keys()
    return pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")


def get_jwks() -> dict:
    """Build a JWKS dict for the persisted RSA public key."""
    import base64

    _, pub = _load_or_create_keys()
    numbers = pub.public_numbers()

    def b64(n: int) -> str:
        size = (n.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(n.to_bytes(size, "big")).rstrip(b"=").decode("utf-8")

    return {
        "keys": [
            {
                "kty": "RSA",
                "alg": "RS256",
                "use": "sig",
                "kid": _KEY_KID,
                "n": b64(numbers.n),
                "e": b64(numbers.e),
            }
        ]
    }


def get_kid() -> str:
    return _KEY_KID


def ensure_keys_on_startup() -> tuple[str, str]:
    """Eagerly load (or create + persist) the OIDC RSA keypair at app
    startup. Returns (private_pem, public_pem) so callers can verify
    everything is in order. Logs loudly on any failure so an operator
    notices immediately instead of waiting for a 500 at runtime.

    Safe to call multiple times.
    """
    priv, pub = _load_or_create_keys()
    return (
        priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8"),
        pub.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8"),
    )


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------

_AUDIT_KEY_PREFIX = "audit:"
_AUDIT_TTL = 60 * 60 * 24 * 30  # 30 days


def audit(event: str, request: Request, user_id: Optional[str] = None,
          email: Optional[str] = None, client_id: Optional[str] = None,
          extra: Optional[dict] = None) -> None:
    """Persist a security-relevant event for later review.

    Also writes a structured log line. Stored in Redis as a JSON list per
    event type, capped by TTL.
    """
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "ip": _client_ip(request),
        "ua": request.headers.get("user-agent", ""),
        "user_id": user_id,
        "email": email,
        "client_id": client_id,
        "extra": extra or {},
    }
    try:
        logger.info("AUDIT %s", json.dumps(record, default=str))
    except Exception:
        logger.info("AUDIT %s", record)

    try:
        # Maintain a per-event-type capped list in Redis (last 200 events)
        key = f"{_AUDIT_KEY_PREFIX}{event}"
        existing = get_cache(key) or []
        existing.append(record)
        if len(existing) > 200:
            existing = existing[-200:]
        set_cache(key, existing, ttl=_AUDIT_TTL)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# HTML render helper — small wrapper to render Jinja2 templates from routes
# ---------------------------------------------------------------------------
def render_template(request: Request, template_name: str, status_code: int = 200,
                    **context) -> HTMLResponse:
    """Render a Jinja2 template and guarantee a usable CSRF token.

    The single source of truth for the CSRF token is the ``iam_csrf`` cookie
    value — the same value is injected into the template's ``csrf_token``
    context, so the form field always matches what the browser sends back.
    """
    from starlette.templating import Jinja2Templates
    global _starlette_templates
    try:
        tmpl = _starlette_templates
    except NameError:
        tmpl = None
    if tmpl is None:
        tmpl = Jinja2Templates(directory="templates")
        _starlette_templates = tmpl

    existing_cookie = request.cookies.get(CSRF_COOKIE_NAME)
    caller_token = context.get("csrf_token")

    if caller_token:
        # Route supplied a fresh token explicitly (e.g. after a failed submit)
        csrf = caller_token
    elif existing_cookie:
        # Reuse the token the browser already has.
        csrf = existing_cookie
    else:
        # Brand-new visitor: mint a fresh token.
        csrf = generate_csrf_token(secrets.token_urlsafe(8))

    ctx = {
        "request": request,
        "settings": settings,
        "auth_server_url": settings.AUTH_SERVER_URL,
        "management_url": settings.MANAGEMENT_URL,
        "csrf_token": csrf,
    }
    merged = {**ctx, **context}
    # Always force the template-visible token to match what we put in the cookie.
    merged["csrf_token"] = csrf

    resp = tmpl.TemplateResponse(request, template_name, merged, status_code=status_code)

    # Set / refresh the cookie so the browser stores the same value.
    if not existing_cookie or caller_token:
        _set_csrf_cookie(resp, csrf)
    return resp
