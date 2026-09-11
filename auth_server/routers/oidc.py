"""
OpenID Connect / OAuth2 endpoints for the IAM auth server.

Implements:
  - Discovery + JWKS
  - Authorization Code flow (/authorize, /login-submit, /token, /userinfo, /logout)
  - Google OAuth login (/auth/google, /auth/google/callback)
  - 2FA step-up during OIDC login (/2fa-setup-page, /2fa-verify-page, /2fa-stepup-submit)

All HTML pages are rendered from Jinja2 templates (templates/auth/*.html)
via security.render_template. Session state lives in Redis (sso_session,
auth_code, totp_secrets, etc.).

Security hardening:
  - CSRF tokens on every state-changing form
  - Rate limiting on login, 2FA, and signup flows
  - Secure, SameSite=Lax, HttpOnly cookies
  - Audit logging for sensitive events
  - Persistent RSA keypair (no in-memory rotation on restart)
  - Auth code single-use + bound to (client_id, redirect_uri)
  - Redirect URI exact-match validation
  - Constant-time-ish error messages to avoid account enumeration
"""

from __future__ import annotations

import logging
import urllib.parse
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import httpx

from auth_utils import (
    create_access_token,
    create_id_token,
    generate_qr_code_data_uri,
    generate_totp_secret,
    get_password_hash,
    get_totp_uri,
    verify_password,
    verify_totp_code,
)
from config import settings
from database import get_db
from models import ClientApp, GoogleSetting, Role, User
from redis_client import delete_cache, get_cache, set_cache
from logout import (
    is_valid_post_logout_uri,
    notify_clients_backchannel,
    perform_centralized_logout,
    register_user_session,
    has_registered_post_logout_uris,
    resolve_global_post_logout_url,
)
from security import (
    audit,
    issue_csrf,
    rate_limit_2fa,
    rate_limit_login,
    render_template,
    set_sso_cookie,
    validate_csrf,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["OIDC / OAuth2"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _validate_redirect_uri(client: ClientApp, redirect_uri: str) -> bool:
    if not client or not redirect_uri:
        return False
    valid = [u.strip() for u in (client.redirect_uris or "").split(",") if u.strip()]
    return redirect_uri in valid


def _resolve_client(db: Session, client_id: Optional[str], redirect_uri: Optional[str]):
    """Look up a client; return (client_obj, error_response_or_None)."""
    if not client_id:
        return None, ("invalid_request", "Missing mandatory client_id parameter.")
    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client:
        return None, (
            "unknown_client",
            f"No client application is registered with client_id <code>{client_id}</code>.",
        )
    if redirect_uri and not _validate_redirect_uri(client, redirect_uri):
        return None, (
            "invalid_redirect_uri",
            f"The redirect URI <code>{redirect_uri}</code> is not registered for client <code>{client_id}</code>.",
        )
    return client, None


def _issue_auth_code_and_session(
    user: User,
    client_id: str,
    redirect_uri: str,
    state: str,
    request: Request,
    code_challenge: Optional[str] = None,
    code_challenge_method: Optional[str] = None,
) -> tuple[Response, str, str]:
    """Create an SSO session + an auth code, return a redirect Response, the
    code URL, and the OIDC session id (sid) used by back-channel logout.
    """
    from token_store import create_sso_session

    sso_session_id = str(uuid.uuid4())
    sid = register_user_session(user.id, client_id)
    create_sso_session(sso_session_id, user.id, user.email, user.name)
    auth_code = str(uuid.uuid4())
    payload = {
        "user_id": user.id,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "sid": sid,
        "sso_session_id": sso_session_id,
    }
    if code_challenge:
        payload["code_challenge"] = code_challenge
        payload["code_challenge_method"] = code_challenge_method or "plain"

    set_cache(f"auth_code:{auth_code}", payload, ttl=600)
    target = f"{redirect_uri}?code={auth_code}"
    if state:
        target += f"&state={urllib.parse.quote(state)}"
    resp = RedirectResponse(target, status_code=303)
    set_sso_cookie(resp, sso_session_id, max_age=86400)
    audit(
        "auth_code_issued",
        request,
        user_id=user.id,
        email=user.email,
        client_id=client_id,
    )
    return resp, target, sid


def _google_href(client_id: str, redirect_uri: str, state: str) -> str:
    return (
        f"/auth/google?client_id={urllib.parse.quote(client_id)}"
        f"&redirect_uri={urllib.parse.quote(redirect_uri or '')}"
        f"&state={urllib.parse.quote(state or '')}"
    )


def _get_google_enabled(db: Session) -> bool:
    g = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    return bool(g and g.is_enabled)


# ===========================================================================
# OIDC Discovery & JWKS
# ===========================================================================
@router.get("/.well-known/openid-configuration")
def openid_configuration():
    return {
        "issuer": settings.AUTH_SERVER_URL,
        "authorization_endpoint": f"{settings.AUTH_SERVER_URL}/authorize",
        "token_endpoint": f"{settings.AUTH_SERVER_URL}/token",
        "userinfo_endpoint": f"{settings.AUTH_SERVER_URL}/userinfo",
        "end_session_endpoint": f"{settings.AUTH_SERVER_URL}/logout",
        "revocation_endpoint": f"{settings.AUTH_SERVER_URL}/oauth/revoke",
        "introspection_endpoint": f"{settings.AUTH_SERVER_URL}/oauth/introspect",
        "jwks_uri": f"{settings.AUTH_SERVER_URL}/jwks.json",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": ["openid", "profile", "email"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256", "plain"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "claims_supported": [
            "sub",
            "iss",
            "aud",
            "exp",
            "iat",
            "auth_time",
            "email",
            "name",
            "picture",
            "roles",
            "is_admin",
            "sid",
        ],
        "backchannel_logout_supported": settings.BACKCHANNEL_LOGOUT_ENABLED,
        "backchannel_logout_session_supported": settings.BACKCHANNEL_LOGOUT_ENABLED,
    }


@router.get("/jwks.json")
def jwks():
    from security import get_jwks

    return get_jwks()


# ===========================================================================
# Authorization endpoint — the OIDC login page
# ===========================================================================
@router.get("/authorize")
def authorize_get(
    request: Request,
    response: Response,
    client_id: Optional[str] = None,
    redirect_uri: Optional[str] = None,
    response_type: str = "code",
    scope: str = "openid profile email",
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Default to the management app when no client context is provided
    # (e.g. user clicked the "Sign in" link from the signup page footer
    # or typed /authorize directly into the address bar). Using a known
    # registered client avoids 400 "redirect URI not registered" errors.
    if not client_id:
        client_id = "auth_management_app"
        redirect_uri = (
            redirect_uri or f"{settings.MANAGEMENT_URL.rstrip('/')}/auth/callback"
        )

    client, err = _resolve_client(db, client_id, redirect_uri)
    if err:
        title, msg = err
        return render_template(
            request, "errors/error.html", status_code=400, title=title, message=msg
        )

    client_name = client.client_name if client else "IAM Central Auth"

    # Skip login form if user already has a valid SSO session
    sso_session_id = request.cookies.get("sso_session")
    session_data = (
        get_cache(f"sso_session:{sso_session_id}") if sso_session_id else None
    )

    if session_data and client and client.is_sso_enabled:
        user = db.query(User).filter(User.id == session_data["user_id"]).first()
        if user and user.is_active:
            g = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
            enforce_2fa = bool(g and g.enforce_2fa_all)
            if user.is_2fa_enabled:
                # If 2FA is not activated (setup not completed), redirect to setup page
                if not user.is_2fa_activated:
                    # Ensure user has a TOTP secret (generate if missing)
                    if not user.totp_secret:
                        user.totp_secret = generate_totp_secret()
                        user.is_2fa_activated = False
                        db.commit()
                    return RedirectResponse(
                        f"/2fa-setup-page?user_id={user.id}&client_id={client_id}"
                        f"&redirect_uri={urllib.parse.quote(redirect_uri or '')}&state={urllib.parse.quote(state or '')}",
                        status_code=303,
                    )
                # 2FA is activated, redirect to verify page
                return RedirectResponse(
                    f"/2fa-verify-page?user_id={user.id}&client_id={client_id}"
                    f"&redirect_uri={urllib.parse.quote(redirect_uri or '')}&state={urllib.parse.quote(state or '')}",
                    status_code=303,
                )
            resp, _, _ = _issue_auth_code_and_session(
                user, client_id, redirect_uri or "", state or "", request
            )
            return resp

    # Build context for the login template
    signup_href = f"/signup"
    if redirect_uri:
        signup_href += f"?redirect_uri={urllib.parse.quote(redirect_uri)}"

    ctx = {
        "client_id": client_id,
        "client_name": client_name,
        "redirect_uri": redirect_uri or "",
        "state": state or "",
        "signup_href": signup_href,
        "management_url": settings.MANAGEMENT_URL,
        "google_enabled": _get_google_enabled(db),
        "google_href": (
            _google_href(client_id, redirect_uri or "", state or "")
            if _get_google_enabled(db)
            else ""
        ),
        "form": {},
        "errors": {},
    }
    return render_template(request, "auth/login.html", **ctx)


# ===========================================================================
# Login submit (local credentials)
# ===========================================================================
@router.post("/login-submit")
async def login_submit(
    request: Request,
    response: Response,
    client_id: str = Form(...),
    redirect_uri: str = Form(""),
    email: str = Form(""),
    password: str = Form(""),
    state: str = Form(""),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    await validate_csrf(request, form_token=csrf_token)
    audit("login_attempt", request, email=email, client_id=client_id)

    # Per-field validation BEFORE rate-limiting so that obvious garbage
    # submissions don't consume the rate-limit budget.
    errors = {}
    if not email or "@" not in email:
        errors["email"] = "Please enter a valid email address."
    if not password:
        errors["password"] = "Please enter your password."
    if errors:
        client, _ = _resolve_client(db, client_id, redirect_uri)
        return render_template(
            request,
            "auth/login.html",
            status_code=400,
            client_id=client_id,
            client_name=client.client_name if client else "IAM",
            redirect_uri=redirect_uri,
            state=state,
            form={"email": email},
            errors=errors,
            signup_href=f"/signup?redirect_uri={urllib.parse.quote(redirect_uri or '')}",
            management_url=settings.MANAGEMENT_URL,
            google_enabled=_get_google_enabled(db),
            google_href=(
                _google_href(client_id, redirect_uri, state)
                if _get_google_enabled(db)
                else ""
            ),
        )

    try:
        rate_limit_login(request, email)
    except Exception:
        return render_template(
            request,
            "auth/login.html",
            status_code=429,
            client_id=client_id,
            client_name="IAM",
            redirect_uri=redirect_uri,
            state=state,
            form={"email": email},
            errors={"email": "Too many sign-in attempts. Please wait a few minutes."},
            signup_href=f"/signup?redirect_uri={urllib.parse.quote(redirect_uri or '')}",
            management_url=settings.MANAGEMENT_URL,
            google_enabled=_get_google_enabled(db),
            google_href=(
                _google_href(client_id, redirect_uri, state)
                if _get_google_enabled(db)
                else ""
            ),
        )

    client, err = _resolve_client(db, client_id, redirect_uri)
    if err:
        title, msg = err
        return render_template(
            request, "errors/error.html", status_code=400, title=title, message=msg
        )

    user = db.query(User).filter(User.email == email.lower()).first()
    valid = bool(user) and verify_password(
        password, user.hashed_password if user else ""
    )

    if not user or not valid:
        audit("login_failed", request, email=email, client_id=client_id)
        return render_template(
            request,
            "auth/login.html",
            status_code=401,
            client_id=client_id,
            client_name=client.client_name if client else "IAM",
            redirect_uri=redirect_uri,
            state=state,
            form={"email": email},
            errors={"password": "Invalid email or password. Please try again."},
            signup_href=f"/signup?redirect_uri={urllib.parse.quote(redirect_uri or '')}",
            management_url=settings.MANAGEMENT_URL,
            google_enabled=_get_google_enabled(db),
            google_href=(
                _google_href(client_id, redirect_uri, state)
                if _get_google_enabled(db)
                else ""
            ),
        )
    if not user.is_active:
        return render_template(
            request,
            "auth/login.html",
            status_code=403,
            client_id=client_id,
            client_name=client.client_name if client else "IAM",
            redirect_uri=redirect_uri,
            state=state,
            form={"email": email},
            errors={"email": "Your account has been disabled. Please contact support."},
            signup_href=f"/signup?redirect_uri={urllib.parse.quote(redirect_uri or '')}",
            management_url=settings.MANAGEMENT_URL,
            google_enabled=_get_google_enabled(db),
            google_href=(
                _google_href(client_id, redirect_uri, state)
                if _get_google_enabled(db)
                else ""
            ),
        )

    g = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    enforce_2fa = bool(g and g.enforce_2fa_all)

    if user.is_2fa_enabled:
        # If 2FA is not activated (setup not completed), redirect to setup page
        if not user.is_2fa_activated:
            # Ensure user has a TOTP secret (generate if missing)
            if not user.totp_secret:
                user.totp_secret = generate_totp_secret()
                user.is_2fa_activated = False
                db.commit()
            return RedirectResponse(
                f"/2fa-setup-page?user_id={user.id}&client_id={client_id}"
                f"&redirect_uri={urllib.parse.quote(redirect_uri or '')}&state={urllib.parse.quote(state or '')}",
                status_code=303,
            )
        # 2FA is activated, redirect to verify page
        return RedirectResponse(
            f"/2fa-verify-page?user_id={user.id}&client_id={client_id}"
            f"&redirect_uri={urllib.parse.quote(redirect_uri or '')}&state={urllib.parse.quote(state or '')}",
            status_code=303,
        )

    audit(
        "login_success", request, user_id=user.id, email=user.email, client_id=client_id
    )
    resp, _, _ = _issue_auth_code_and_session(
        user, client_id, redirect_uri or "", state or "", request
    )
    return resp


# ===========================================================================
# 2FA setup page
# ===========================================================================
@router.get("/2fa-setup-page")
def two_fa_setup_page(
    request: Request,
    response: Response,
    user_id: str,
    client_id: str,
    redirect_uri: str,
    state: str = "",
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return render_template(
            request,
            "errors/error.html",
            status_code=404,
            title="User not found",
            message="The 2FA session has expired. Please sign in again.",
        )

    if not user.totp_secret:
        user.totp_secret = generate_totp_secret()
        db.commit()
        db.refresh(user)

    uri = get_totp_uri(user.totp_secret, user.email)
    return render_template(
        request,
        "auth/2fa_setup.html",
        user_id=user.id,
        client_id=client_id,
        redirect_uri=redirect_uri,
        redirect_uri_enc=urllib.parse.quote(redirect_uri or ""),
        state=state,
        qr_code=generate_qr_code_data_uri(uri),
        totp_secret=user.totp_secret,
    )


# ===========================================================================
# 2FA verify page
# ===========================================================================
@router.get("/2fa-verify-page")
def two_fa_verify_page(
    request: Request,
    response: Response,
    user_id: str,
    client_id: str,
    redirect_uri: str,
    state: str = "",
):
    return render_template(
        request,
        "auth/2fa_verify.html",
        user_id=user_id,
        client_id=client_id,
        redirect_uri=redirect_uri,
        redirect_uri_enc=urllib.parse.quote(redirect_uri or ""),
        state=state,
    )


# ===========================================================================
# 2FA step-up submit (verify, or verify+enable if is_setup=true)
# ===========================================================================
@router.post("/2fa-stepup-submit")
async def two_fa_stepup_submit(
    request: Request,
    response: Response,
    user_id: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    totp_code: str = Form(...),
    state: str = Form(""),
    is_setup: str = Form("false"),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    await validate_csrf(request, form_token=csrf_token)

    # Field-level validation (don't burn rate-limit on empty codes)
    if not totp_code or len(totp_code.strip()) != 6 or not totp_code.isdigit():
        user = db.query(User).filter(User.id == user_id).first()
        if is_setup == "true" and user:
            return render_template(
                request,
                "auth/2fa_setup.html",
                status_code=400,
                user_id=user.id,
                client_id=client_id,
                redirect_uri=redirect_uri,
                redirect_uri_enc=urllib.parse.quote(redirect_uri or ""),
                state=state,
                qr_code=(
                    generate_qr_code_data_uri(
                        get_totp_uri(user.totp_secret, user.email)
                    )
                    if user.totp_secret
                    else ""
                ),
                totp_secret=user.totp_secret or "",
                errors={
                    "totp_code": "Please enter the 6-digit code from your authenticator app."
                },
            )
        return render_template(
            request,
            "auth/2fa_verify.html",
            status_code=400,
            user_id=user_id,
            client_id=client_id,
            redirect_uri=redirect_uri,
            redirect_uri_enc=urllib.parse.quote(redirect_uri or ""),
            state=state,
            errors={
                "totp_code": "Please enter the 6-digit code from your authenticator app."
            },
        )

    rate_limit_2fa(request, user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.totp_secret:
        return render_template(
            request,
            "errors/error.html",
            status_code=400,
            title="Invalid state",
            message="2FA session has expired. Please sign in again.",
        )

    if not verify_totp_code(user.totp_secret, totp_code):
        audit(
            "2fa_failed",
            request,
            user_id=user.id,
            email=user.email,
            client_id=client_id,
        )
        if is_setup == "true":
            return render_template(
                request,
                "auth/2fa_setup.html",
                status_code=401,
                user_id=user.id,
                client_id=client_id,
                redirect_uri=redirect_uri,
                redirect_uri_enc=urllib.parse.quote(redirect_uri or ""),
                state=state,
                qr_code=generate_qr_code_data_uri(
                    get_totp_uri(user.totp_secret, user.email)
                ),
                totp_secret=user.totp_secret,
                errors={"totp_code": "Invalid verification code. Please try again."},
            )
        return render_template(
            request,
            "auth/2fa_verify.html",
            status_code=401,
            user_id=user.id,
            client_id=client_id,
            redirect_uri=redirect_uri,
            redirect_uri_enc=urllib.parse.quote(redirect_uri or ""),
            state=state,
            errors={"totp_code": "Invalid verification code. Please try again."},
        )

    if is_setup == "true":
        # User is completing the 2FA setup process - mark as enabled and activated
        user.is_2fa_enabled = True
        user.is_2fa_activated = True
        db.commit()
        db.refresh(user)
        audit(
            "2fa_enabled",
            request,
            user_id=user.id,
            email=user.email,
            client_id=client_id,
        )

    audit(
        "2fa_success", request, user_id=user.id, email=user.email, client_id=client_id
    )
    resp, _, _ = _issue_auth_code_and_session(
        user, client_id, redirect_uri, state, request
    )
    return resp


# ===========================================================================
# Google OAuth — initiate & callback
# ===========================================================================
@router.get("/auth/google")
def google_auth_init(
    request: Request,
    client_id: Optional[str] = None,
    redirect_uri: Optional[str] = None,
    state: str = "",
    db: Session = Depends(get_db),
):
    g = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not g or not g.is_enabled or not g.client_id:
        raise HTTPException(status_code=400, detail="Google Login is not configured")

    target_client_id = client_id or "auth_management_app"
    target_redirect_uri = redirect_uri or settings.CENTRAL_DASHBOARD_URL
    oauth_state = f"{target_client_id}|{target_redirect_uri}|{state}"
    params = {
        "client_id": g.client_id,
        "redirect_uri": g.redirect_uri
        or f"{settings.AUTH_SERVER_URL}/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": oauth_state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return RedirectResponse(
        f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    )


@router.get("/auth/google/callback")
async def google_auth_callback(
    request: Request,
    code: str,
    state: str = "",
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # ------------------------------------------------------------------
    # Test-mode branch: if the state starts with `__test__|`, this is
    # an OAuth round-trip initiated by the "Test Google Integration"
    # button on the management app's Google Settings page. We must NOT
    # complete a real login here — instead, redirect the authorization
    # code back to the management app's postback URL.
    # ------------------------------------------------------------------
    if state and state.startswith("__test__|"):
        postback = state[len("__test__|") :]
        # Validate the postback URL — only allow http(s) to prevent open
        # redirects. The management page URL is what the operator just
        # clicked from, so it's trusted.
        if not postback.startswith(("http://", "https://")):
            return render_template(
                request,
                "errors/error.html",
                status_code=400,
                title="Invalid test postback URL",
                message=f"Test postback URL is invalid: {postback}",
            )
        sep = "&" if "?" in postback else "?"
        target = f"{postback}{sep}test_code={urllib.parse.quote(code)}"
        if error:
            target += f"&test_error={urllib.parse.quote(error)}"
        return RedirectResponse(target, status_code=303)

    g = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    state_parts = state.split("|") if state else []
    target_client_id = (
        state_parts[0]
        if len(state_parts) > 0 and state_parts[0]
        else "auth_management_app"
    )
    target_redirect_uri = (
        state_parts[1]
        if len(state_parts) > 1 and state_parts[1]
        else settings.CENTRAL_DASHBOARD_URL
    )
    app_state = state_parts[2] if len(state_parts) > 2 else ""

    if not g or not g.is_enabled or not g.client_id or not g.client_secret:
        err_url = f"{target_redirect_uri}?error=Google+OAuth+not+fully+configured"
        return RedirectResponse(err_url)

    token_url = "https://oauth2.googleapis.com/token"
    callback_uri = g.redirect_uri or f"{settings.AUTH_SERVER_URL}/auth/google/callback"
    payload = {
        "code": code,
        "client_id": g.client_id,
        "client_secret": g.client_secret,
        "redirect_uri": callback_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(token_url, data=payload)
        if token_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Google token exchange failed")
        token_data = token_res.json()

        userinfo_res = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_res.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to fetch Google user info"
            )
        google_user = userinfo_res.json()

    google_email = (google_user.get("email") or "").lower()
    google_name = google_user.get("name")
    google_picture = google_user.get("picture")

    if not google_email:
        raise HTTPException(status_code=400, detail="Google account email not provided")

    user = db.query(User).filter(User.email == google_email).first()
    if not user:
        normal_role = db.query(Role).filter(Role.name == "normal-user").first()
        user = User(
            email=google_email,
            name=google_name,
            picture=google_picture,
            roles="normal-user",
            role_id=normal_role.id if normal_role else None,
            is_active=True,
            provider="google",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        audit("signup_via_google", request, user_id=user.id, email=user.email)

    enforce_2fa = bool(g.enforce_2fa_all)
    if user.is_2fa_enabled:
        # If 2FA is not activated (setup not completed), redirect to setup page
        if not user.is_2fa_activated:
            # Ensure user has a TOTP secret (generate if missing)
            if not user.totp_secret:
                user.totp_secret = generate_totp_secret()
                user.is_2fa_activated = False
                db.commit()
            return RedirectResponse(
                f"/2fa-setup-page?user_id={user.id}&client_id={target_client_id}"
                f"&redirect_uri={urllib.parse.quote(target_redirect_uri)}&state={urllib.parse.quote(app_state)}",
                status_code=303,
            )
        # 2FA is activated, redirect to verify page
        return RedirectResponse(
            f"/2fa-verify-page?user_id={user.id}&client_id={target_client_id}"
            f"&redirect_uri={urllib.parse.quote(target_redirect_uri)}&state={urllib.parse.quote(app_state)}",
            status_code=303,
        )

    resp, _, _ = _issue_auth_code_and_session(
        user, target_client_id, target_redirect_uri, app_state, request
    )
    audit(
        "login_via_google",
        request,
        user_id=user.id,
        email=user.email,
        client_id=target_client_id,
    )
    return resp


# ===========================================================================
# OIDC Token endpoint (RFC 6749)
#   grant_type=authorization_code  → access_token + id_token + refresh_token
#   grant_type=refresh_token       → new access_token (and rotated refresh_token)
# ===========================================================================
@router.post("/token")
def token_endpoint(
    grant_type: str = Form(...),
    code: Optional[str] = Form(None),
    redirect_uri: Optional[str] = Form(None),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    code_verifier: Optional[str] = Form(None),
    refresh_token: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client or client.client_secret != client_secret:
        raise HTTPException(status_code=401, detail="Invalid client authentication")

    from auth_utils import ACCESS_TOKEN_TTL as _TTL
    from token_store import consume_refresh_token, issue_refresh_token

    # ------------------------------------------------------------------
    # grant_type=refresh_token
    # ------------------------------------------------------------------
    if grant_type == "refresh_token":
        payload = consume_refresh_token(refresh_token or "")
        if not payload:
            raise HTTPException(status_code=400, detail="invalid_grant")
        if payload.get("client_id") != client_id:
            raise HTTPException(status_code=400, detail="client_id mismatch")
        user = db.query(User).filter(User.id == payload["user_id"]).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=400, detail="user not active")
        sid = payload.get("sid")
        scope = payload.get("scope", "openid profile email")
        access_token = create_access_token(
            user.id,
            client_id,
            scope=scope,
            roles=user.roles_list,
            sid=sid,
            email=user.email,
            name=user.name,
            picture=user.picture,
        )
        new_refresh = issue_refresh_token(user.id, client_id, sid, scope=scope)
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": _TTL,
            "refresh_token": new_refresh,
            "scope": scope,
        }

    # ------------------------------------------------------------------
    # grant_type=authorization_code
    # ------------------------------------------------------------------
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="Unsupported grant_type")

    if not code or not redirect_uri:
        raise HTTPException(status_code=400, detail="Missing code or redirect_uri")

    code_data = get_cache(f"auth_code:{code}")
    if not code_data:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    if code_data["client_id"] != client_id or code_data["redirect_uri"] != redirect_uri:
        raise HTTPException(
            status_code=400, detail="Code client_id/redirect_uri mismatch"
        )

    # Verify PKCE if a challenge was provided during authorization
    expected_challenge = code_data.get("code_challenge")
    if expected_challenge:
        if not code_verifier:
            raise HTTPException(status_code=400, detail="Missing PKCE code_verifier")
        method = code_data.get("code_challenge_method", "plain")
        if method == "S256":
            import hashlib, base64

            computed = (
                base64.urlsafe_b64encode(
                    hashlib.sha256(code_verifier.encode("ascii")).digest()
                )
                .rstrip(b"=")
                .decode("ascii")
            )
            if computed != expected_challenge:
                raise HTTPException(
                    status_code=400, detail="Invalid PKCE code_verifier"
                )
        elif method == "plain":
            if code_verifier != expected_challenge:
                raise HTTPException(
                    status_code=400, detail="Invalid PKCE code_verifier"
                )
        else:
            raise HTTPException(status_code=400, detail="Unsupported PKCE method")

    # Single-use
    delete_cache(f"auth_code:{code}")

    user = db.query(User).filter(User.id == code_data["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    sid = code_data.get("sid")
    id_token = create_id_token(
        user.id,
        user.email,
        user.name,
        client_id,
        user.picture,
        roles=user.roles_list,
        sid=sid,
    )
    access_token = create_access_token(
        user.id,
        client_id,
        roles=user.roles_list,
        sid=sid,
        email=user.email,
        name=user.name,
        picture=user.picture,
    )
    refresh = issue_refresh_token(user.id, client_id, sid)

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": _TTL,
        "id_token": id_token,
        "refresh_token": refresh,
        "scope": "openid profile email",
    }


# ===========================================================================
# OIDC UserInfo endpoint
# ===========================================================================
@router.get("/userinfo")
def userinfo_endpoint(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split(" ", 1)[1]
    from auth_utils import decode_token

    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid access token")

    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "sub": user.id,
        "email": user.email,
        "name": user.name or user.email,
        "picture": user.picture or "",
        "provider": user.provider,
        "roles": user.roles_list,
        "is_admin": user.is_admin,
        "is_2fa_enabled": user.is_2fa_enabled,
        "is_2fa_activated": user.is_2fa_activated,
    }


# ===========================================================================
# OIDC RP-Initiated Logout 1.0 (front-channel)
#   https://openid.net/specs/openid-connect-rpinitiated-1_0.html
#
# POST parameters (Form data):
#   id_token_hint            — REQUIRED; signed JWT identifying client (aud) and user (sub)
#   post_logout_redirect_uri — optional, must be registered for the client
#   state                    — optional, echoed back
#   client_id               — optional, fallback if id_token_hint doesn't contain aud
#
# Security:
#   - Changed from GET to POST to prevent CSRF attacks
#   - id_token_hint is now REQUIRED and validated (signature + client registration)
#   - JWT expiration is NOT verified (stale tokens must still identify the client)
#
# Flow:
#   1. Client app POSTs to /logout with id_token_hint in form body
#   2. Auth server verifies the JWT signature and client registration
#   3. Auth server terminates the central SSO session
#   4. Auth server dispatches OIDC Back-Channel Logout 1.0 to every other
#      client app the user had a session with.
#   5. Auth server redirects the browser back to the client's
#      post_logout_redirect_uri (or the global POST_LOGOUT_REDIRECT_URL).
# ===========================================================================
@router.post("/logout")
async def logout(
    request: Request,
    id_token_hint: str = Form(...),  # REQUIRED: signed JWT from client
    post_logout_redirect_uri: Optional[str] = Form(None),
    state: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    from auth_utils import decode_token

    # --- Validate id_token_hint (REQUIRED) ---
    # Decode and verify JWT signature
    payload = decode_token(id_token_hint, verify_exp=False)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or tampered id_token_hint")

    # Extract user and client info from JWT
    user_id = payload.get("sub")
    originating_client_id = payload.get("aud") or payload.get("client_id")

    # If id_token doesn't have aud/client_id, try explicit client_id parameter
    if not originating_client_id and client_id:
        originating_client_id = client_id

    # --- Verify client is registered ---
    if not originating_client_id:
        raise HTTPException(
            status_code=401,
            detail="Cannot determine client_id from id_token_hint or parameters",
        )

    client = (
        db.query(ClientApp).filter(ClientApp.client_id == originating_client_id).first()
    )

    if not client:
        raise HTTPException(
            status_code=401, detail=f"Unknown client_id: {originating_client_id}"
        )

    # --- Check if we have a valid user_id ---
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Missing user_id (sub claim) in id_token_hint"
        )

    # Get SSO session ID from cookies (for session cleanup)
    sso_session_id = request.cookies.get("sso_session")

    # --- Validate post_logout_redirect_uri against the client configuration
    #
    #   1. URI matches a registered post_logout_redirect_uri  →  use it
    #   2. Client has no registered post_logout URIs →  global fallback
    #   3. Client has registered URIs but provided URI doesn't match →  global fallback (not error)
    target = None
    if post_logout_redirect_uri:
        if client and is_valid_post_logout_uri(client, post_logout_redirect_uri):
            target = post_logout_redirect_uri
        else:
            # Client not found, or URI doesn't match, or client has no registered URIs
            # Fall back to global POST_LOGOUT_REDIRECT_URL instead of returning error
            target = resolve_global_post_logout_url()

    if not target:
        target = resolve_global_post_logout_url()

    # Perform centralized logout (sso_session + back-channel)
    summary = perform_centralized_logout(
        request=request,
        db=db,
        user_id=user_id,
        sso_session_id=sso_session_id,
        originating_client_id=originating_client_id,
    )
    audit(
        "logout",
        request,
        user_id=user_id,
        client_id=originating_client_id,
        extra={"summary": summary},
    )

    # Append state if provided (front-channel state preservation)
    if state:
        sep = "&" if "?" in target else "?"
        target = f"{target}{sep}state={urllib.parse.quote(state)}"

    resp = RedirectResponse(target, status_code=303)
    resp.delete_cookie("sso_session")
    resp.delete_cookie("iam_csrf")
    return resp


# ===========================================================================
# OIDC Back-Channel Logout 1.0 testability / introspection endpoint
#
# Useful for clients and operators to verify which clients have
# back-channel logout configured and inspect the current user-sessions
# index. The auth session here is the OIDC access token.
# ===========================================================================
@router.get("/backchannel-logout/info")
def backchannel_logout_info(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    from auth_utils import decode_token

    payload = decode_token(auth_header.split(" ", 1)[1])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    sessions = {}
    if user_id:
        from logout import get_user_clients

        sessions = get_user_clients(user_id)

    clients = (
        db.query(ClientApp)
        .filter(
            ClientApp.client_id.in_(sessions.keys())
            if sessions
            else ClientApp.id.is_(None)
        )
        .all()
    )
    return {
        "backchannel_logout_globally_enabled": settings.BACKCHANNEL_LOGOUT_ENABLED,
        "user_id": user_id,
        "active_sessions": [
            {
                "client_id": c.client_id,
                "client_name": c.client_name,
                "sid": sessions.get(c.client_id),
                "backchannel_logout_enabled": c.backchannel_logout_enabled,
                "backchannel_logout_uris": (
                    (c.backchannel_logout_uris or "").split(",")
                    if c.backchannel_logout_uris
                    else []
                ),
            }
            for c in clients
        ],
    }


# ===========================================================================
# Token Revocation (RFC 7009) and Introspection (RFC 7662)
#
# /oauth/revoke  — client posts its refresh_token; we delete it. Returns
#                  200 even if the token was unknown (idempotent).
# /oauth/introspect — client posts a token; we return {active, sub, ...}.
# /oauth/session/active — lightweight ping used by browser clients to
#                         detect that the central SSO session was
#                         terminated. 200 if the access token is still
#                         valid AND the user is still active, else 401.
# ===========================================================================
@router.post("/oauth/revoke")
def oauth_revoke(
    token: str = Form(...),
    token_type_hint: Optional[str] = Form(None),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    db: Session = Depends(get_db),
):
    from token_store import revoke_refresh_token

    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client or client.client_secret != client_secret:
        raise HTTPException(status_code=401, detail="Invalid client authentication")

    # We only store refresh tokens. Access tokens are stateless JWTs
    # that expire on their own in 15 minutes.
    revoke_refresh_token(token)
    return Response(status_code=200)


@router.post("/oauth/introspect")
def oauth_introspect(
    token: str = Form(...),
    token_type_hint: Optional[str] = Form(None),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    db: Session = Depends(get_db),
):
    from token_store import peek_refresh_token

    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client or client.client_secret != client_secret:
        raise HTTPException(status_code=401, detail="Invalid client authentication")

    # Try refresh-token first (most common introspection case)
    rt = peek_refresh_token(token)
    if rt:
        return {
            "active": True,
            "sub": rt.get("user_id"),
            "client_id": rt.get("client_id"),
            "scope": rt.get("scope"),
            "exp": rt.get("exp"),
            "token_type": "refresh_token",
        }

    # Fall back to access-token (JWT)
    from auth_utils import decode_token

    payload = decode_token(token)
    if payload:
        return {
            "active": True,
            "sub": payload.get("sub"),
            "client_id": payload.get("client_id") or payload.get("aud"),
            "scope": payload.get("scope"),
            "exp": payload.get("exp"),
            "token_type": "access_token",
        }

    return {"active": False}


@router.api_route("/oauth/session/active", methods=["GET", "POST"])
async def oauth_session_active(request: Request, db: Session = Depends(get_db)):
    """Real-time SSO session status endpoint.

    Accepts either an access_token or id_token via:
      - Authorization: Bearer <token>
      - Query parameter: ?token=... or ?access_token=... or ?id_token=...
      - POST body: { token: "..." } or form data

    Validates:
      1. Cryptographic RS256 signature and expiration
      2. User existence and active status in DB
      3. Real-time SSO session and refresh token presence in Redis

    Returns 200 with session/user details if active; 401 otherwise.
    """
    from auth_utils import decode_token

    raw_token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        raw_token = auth_header.split(" ", 1)[1].strip()

    if not raw_token:
        query_params = request.query_params
        raw_token = (
            query_params.get("token")
            or query_params.get("access_token")
            or query_params.get("id_token")
        )

    if not raw_token and request.method == "POST":
        try:
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body_json = await request.json()
                raw_token = (
                    body_json.get("token")
                    or body_json.get("access_token")
                    or body_json.get("id_token")
                )
            else:
                form_data = await request.form()
                raw_token = (
                    form_data.get("token")
                    or form_data.get("access_token")
                    or form_data.get("id_token")
                )
        except Exception:
            pass

    if not raw_token:
        raise HTTPException(
            status_code=401,
            detail="Token required (Bearer header, token/access_token/id_token parameter)",
        )

    payload = decode_token(raw_token, verify_exp=True)
    if not payload:
        raise HTTPException(status_code=401, detail="Token invalid or expired")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing sub claim")

    # 1. Verify user status in Database
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="User account is deactivated")

    # 2. Verify real-time SSO session state in Redis
    sid = payload.get("sid")
    is_session_active = False

    # Check direct sso_session if sid is in token claims
    if sid:
        sess = get_cache(f"sso_session:{sid}")
        if sess and isinstance(sess, dict) and sess.get("user_id") == user_id:
            is_session_active = True

    # Check active refresh token index for user
    from redis_client import redis_client
    if not is_session_active and redis_client is not None:
        try:
            refresh_count = redis_client.scard(f"user_refresh:{user_id}")
            if refresh_count and refresh_count > 0:
                is_session_active = True
        except Exception:
            pass

    # Scan active sso_session keys for user as fallback
    if not is_session_active and redis_client is not None:
        try:
            for key in redis_client.scan_iter("sso_session:*"):
                val = get_cache(key)
                if isinstance(val, dict) and val.get("user_id") == user_id:
                    is_session_active = True
                    break
        except Exception:
            pass

    if not is_session_active:
        raise HTTPException(
            status_code=401, detail="SSO session has expired or was terminated"
        )

    token_type = (
        "id_token"
        if ("auth_time" in payload or "nonce" in payload or "scope" not in payload)
        else "access_token"
    )

    return {
        "active": True,
        "sub": user.id,
        "email": user.email,
        "name": user.name or user.email,
        "roles": user.roles_list,
        "is_admin": user.is_admin,
        "client_id": payload.get("client_id") or payload.get("aud"),
        "sid": sid,
        "exp": payload.get("exp"),
        "token_type": token_type,
    }
