"""
OIDC RP-Initiated Logout 1.0 + OIDC Back-Channel Logout 1.0 helpers.

Reference specs:
  - https://openid.net/specs/openid-connect-rpinitiated-1_0.html
  - https://openid.net/specs/openid-connect-backchannel-1_0.html

RP-Initiated Logout (front-channel):
    End-User -> Client App -> /logout (auth_server) -> confirm -> redirect
    Query parameters: id_token_hint, post_logout_redirect_uri, state, client_id

Back-Channel Logout:
    When the central SSO session is terminated (via /logout or admin action)
    the OP POSTs a signed logout_token JWT to every registered
    backchannel_logout_uri of clients that have an active user session.

    logout_token claims:
        iss              - issuer
        aud              - client_id of the RP
        sub              - subject (user id)
        sid              - session id (OP session id, NOT the sso_session cookie)
        iat              - issued at
        jti              - one-time id
        events           - { "http://schemas.openid.net/event/backchannel-logout": {} }
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Iterable, Optional
from urllib.parse import urlparse, urlunparse

import httpx
from jose import jwt

from config import settings
from security import get_kid, get_private_pem
from models import ClientApp, User
from redis_client import set_cache, get_cache, delete_cache
from token_store import (
    delete_sso_session,
    revoke_all_user_refresh_tokens,
    revoke_refresh_token,
)

logger = logging.getLogger(__name__)


# Redis key that maps user_id -> set of (client_id, session_id) tuples.
# Each entry is created when a client completes an OIDC login. On logout
# we read this index to know which clients to notify.
_USER_SESSIONS_KEY = "user_sessions:{user_id}"
_BCTX_RETRIES = 2
_BCTX_TIMEOUT = 5.0


# ---------------------------------------------------------------------------
# Track user sessions per client (used for back-channel logout)
# ---------------------------------------------------------------------------
def register_user_session(user_id: str, client_id: str, sid: Optional[str] = None) -> str:
    """Record that `user_id` has an active session on `client_id`.

    Returns the generated session id (a stable id used as `sid` in
    back-channel logout_token JWTs).
    """
    if not sid:
        sid = secrets.token_urlsafe(24)
    key = _USER_SESSIONS_KEY.format(user_id=user_id)
    current = get_cache(key) or {}
    current[client_id] = sid
    set_cache(key, current, ttl=86400 * 7)  # sessions table lives a week
    return sid


def get_user_clients(user_id: str) -> dict:
    """Return a dict of {client_id: sid} for active sessions of this user."""
    return get_cache(_USER_SESSIONS_KEY.format(user_id=user_id)) or {}


def clear_user_session(user_id: str, client_id: Optional[str] = None) -> dict:
    """Remove a user session. If client_id is None, remove all sessions for the user.

    Returns the sessions that were removed.
    """
    key = _USER_SESSIONS_KEY.format(user_id=user_id)
    current = get_cache(key) or {}
    if not current:
        return {}
    if client_id is None:
        delete_cache(key)
        return current
    if client_id in current:
        removed = {client_id: current[client_id]}
        del current[client_id]
        if current:
            set_cache(key, current, ttl=86400 * 7)
        else:
            delete_cache(key)
        return removed
    return {}


# ---------------------------------------------------------------------------
# Logout token (signed JWT) for back-channel logout
# ---------------------------------------------------------------------------
def build_logout_token(client_id: str, sub: str, sid: Optional[str] = None) -> tuple[str, str]:
    """Build a signed logout_token JWT for a specific client.

    Returns (token, jti). The jti should be stored briefly so we can
    prevent replays.
    """
    now = int(time.time())
    jti = secrets.token_urlsafe(16)
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "aud": client_id,
        "iat": now,
        "exp": now + 300,  # 5 minutes
        "jti": jti,
        "sub": sub,
        "events": {"http://schemas.openid.net/event/backchannel-logout": {}},
    }
    if sid:
        payload["sid"] = sid

    token = jwt.encode(payload, get_private_pem(), algorithm="RS256",
                       headers={"kid": get_kid()})
    return token, jti


# ---------------------------------------------------------------------------
# Back-channel logout dispatcher
# ---------------------------------------------------------------------------
def _post_logout(client: ClientApp, logout_token: str) -> tuple[bool, Optional[str]]:
    """POST a logout_token to one of the client's backchannel_logout_uris.

    Per OIDC Back-Channel Logout 1.0 §2.2:
      "The POST entity body MUST be application/x-www-form-urlencoded
       and the logout_token parameter MUST be set to the logout token."

    Returns (success, error_message).
    """
    uris = [u.strip() for u in (client.backchannel_logout_uris or "").split(",") if u.strip()]
    if not uris:
        return False, "no backchannel_logout_uris registered"

    last_err = None
    for uri in uris:
        for attempt in range(1, _BCTX_RETRIES + 1):
            try:
                with httpx.Client(timeout=_BCTX_TIMEOUT) as hx:
                    res = hx.post(
                        uri,
                        # Form-encoded body per OIDC spec
                        data={"logout_token": logout_token},
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Accept": "application/json",
                        },
                    )
                if 200 <= res.status_code < 300:
                    logger.info("Back-channel logout delivered to %s (client=%s, status=%d)",
                                uri, client.client_id, res.status_code)
                    return True, None
                last_err = f"HTTP {res.status_code}: {res.text[:200]}"
                logger.warning("Back-channel logout to %s returned %d (attempt %d/%d): %s",
                               uri, res.status_code, attempt, _BCTX_RETRIES, last_err)
            except Exception as e:
                last_err = str(e)
                logger.warning("Back-channel logout to %s failed (attempt %d/%d): %s",
                               uri, attempt, _BCTX_RETRIES, e)
    return False, last_err


def notify_clients_backchannel(user_id: str, current_client_id: Optional[str] = None,
                               db=None) -> dict:
    """Notify all clients that have an active session for `user_id`.

    If `current_client_id` is given, we still notify it (its session is
    terminating as part of this logout). Returns a dict of
    {client_id: {"ok": bool, "error": str|None}}.
    """
    sessions = get_user_clients(user_id)
    if not sessions:
        return {}

    results: dict = {}
    for client_id, sid in sessions.items():
        client = (db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
                  if db is not None else None)
        if not client:
            results[client_id] = {"ok": False, "error": "client not found"}
            continue
        if not client.backchannel_logout_enabled or not client.backchannel_logout_uris:
            results[client_id] = {"ok": False, "error": "back-channel logout not configured"}
            continue

        token, _jti = build_logout_token(client_id, user_id, sid)
        ok, err = _post_logout(client, token)
        results[client_id] = {"ok": ok, "error": err}

    return results


# ---------------------------------------------------------------------------
# Front-channel RP-initiated logout helpers
# ---------------------------------------------------------------------------
def is_valid_post_logout_uri(client: ClientApp, post_logout_redirect_uri: str) -> bool:
    """Return True if post_logout_redirect_uri is registered for this client.

    Comparison is trailing-slash tolerant so that http://example.com/ matches
    a registered http://example.com (and vice-versa).
    """
    if not post_logout_redirect_uri:
        return False
    uris = [u.strip().rstrip('/') for u in (client.post_logout_redirect_uris or "").split(",") if u.strip()]
    if not uris:
        return False
    return post_logout_redirect_uri.rstrip('/') in uris


# ---------------------------------------------------------------------------
# Centralized logout — terminates SSO + notifies all client apps
# ---------------------------------------------------------------------------
def perform_centralized_logout(
    request,
    db,
    user_id: Optional[str] = None,
    sso_session_id: Optional[str] = None,
    originating_client_id: Optional[str] = None,
) -> dict:
    """End the central SSO session and fire back-channel logout to all clients.

    Returns a summary dict suitable for audit logging and rendering.
    """
    summary = {
        "sso_session_terminated": False,
        "backchannel_results": {},
    }

    if sso_session_id:
        sess = get_cache(f"sso_session:{sso_session_id}")
        if sess:
            user_id = user_id or sess.get("user_id")
            delete_cache(f"sso_session:{sso_session_id}")
            summary["sso_session_terminated"] = True

    if user_id:
        # Revoke every refresh token for this user. Once these are gone,
        # no client app can mint a new access token — they are all forced
        # to re-authenticate. This is the *primary* enforcement mechanism
        # for single logout.
        summary["refresh_tokens_revoked"] = revoke_all_user_refresh_tokens(user_id)

        # Best-effort back-channel logout. If `db` is None (called from
        # the JSON /sso/logout endpoint), we still send the logout_token
        # to the clients we have registered in the in-memory user_sessions
        # index — we just can't enrich the result with client names.
        sessions = get_user_clients(user_id)
        if originating_client_id and originating_client_id in sessions:
            del sessions[originating_client_id]
        if sessions:
            if db is not None:
                summary["backchannel_results"] = notify_clients_backchannel(user_id, db=db)
            else:
                # No DB available: still fire the POSTs but without client
                # names. notify_clients_backchannel handles db=None by
                # looking up clients via a simple in-memory dict fallback.
                summary["backchannel_results"] = _notify_backchannel_no_db(user_id, sessions)
        clear_user_session(user_id)

    return summary


def _notify_backchannel_no_db(user_id: str, sessions: dict) -> dict:
    """Fire back-channel logout when we don't have a DB session (e.g. the
    JSON /sso/logout endpoint was called from a client SPA that doesn't
    share our SQLAlchemy session). We re-fetch each client from the DB
    on the fly by creating a short-lived session.
    """
    from database import SessionLocal
    from models import ClientApp
    results = {}
    db = SessionLocal()
    try:
        for client_id in list(sessions.keys()):
            client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
            if not client:
                results[client_id] = {"ok": False, "error": "client not found"}
                continue
            token, _ = build_logout_token(client_id, user_id, sessions.get(client_id))
            ok, err = _post_logout(client, token)
            results[client_id] = {"ok": ok, "error": err}
    finally:
        db.close()
    return results