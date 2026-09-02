"""
Refresh-token store + active-session registry for the auth server.

The auth server is the *only* stateful component. Each user has a single
`sso_session` cookie + an entry in Redis that names their active session.
Each active session can mint refresh tokens (one per client app the user
signed into). Refresh tokens are opaque random strings; access tokens
are short-lived RS256 JWTs verified by signature only.

Why this design:
  - Access tokens (15 min) carry no DB lookups on the hot path.
  - Refresh tokens can be revoked instantly by deleting their Redis key.
  - Single logout at the auth server wipes the SSO cookie and every
    refresh token for the user — every client app then fails to
    refresh and is forced to re-authenticate.

Key layout (Redis):
  sso_session:<sid>            -> { user_id, email, name, created_at }
  refresh:<token>              -> { user_id, client_id, sid, scope, exp }
  user_refresh:<user_id>       -> set of refresh tokens (for bulk revoke)
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Optional

from redis_client import delete_cache, get_cache, set_cache, redis_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Access-token lifetime (kept short on purpose)
# ---------------------------------------------------------------------------
ACCESS_TOKEN_TTL = 15 * 60            # 15 minutes
REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60  # 7 days
SSO_SESSION_TTL = 24 * 60 * 60        # 24 hours


# ---------------------------------------------------------------------------
# Refresh tokens
# ---------------------------------------------------------------------------
def _refresh_key(token: str) -> str:
    return f"refresh:{token}"


def _user_refresh_set_key(user_id: str) -> str:
    return f"user_refresh:{user_id}"


def issue_refresh_token(user_id: str, client_id: str, sid: str,
                        scope: str = "openid profile email") -> str:
    """Mint an opaque refresh token. Caller is responsible for delivering
    it to the client (HTTP body, secure cookie, etc.)."""
    token = secrets.token_urlsafe(48)
    payload = {
        "user_id": user_id,
        "client_id": client_id,
        "sid": sid,
        "scope": scope,
        "iat": int(time.time()),
        "exp": int(time.time()) + REFRESH_TOKEN_TTL,
    }
    set_cache(_refresh_key(token), payload, ttl=REFRESH_TOKEN_TTL)
    try:
        if redis_client is not None:
            redis_client.sadd(_user_refresh_set_key(user_id), token)
            redis_client.expire(_user_refresh_set_key(user_id), REFRESH_TOKEN_TTL)
    except Exception as e:
        logger.warning("Failed to index refresh token for %s: %s", user_id, e)
    return token


def consume_refresh_token(token: str) -> Optional[dict]:
    """Read-and-delete (single-use rotation per RFC 6749 §6).

    Returns the payload if valid, None if the token is unknown, expired,
    or already consumed.
    """
    if not token:
        return None
    payload = get_cache(_refresh_key(token))
    if not payload:
        return None
    # Delete BEFORE returning to prevent races
    delete_cache(_refresh_key(token))
    # exp check (defence in depth — TTL should already have evicted)
    if payload.get("exp", 0) < int(time.time()):
        return None
    try:
        if redis_client is not None:
            redis_client.srem(_user_refresh_set_key(payload.get("user_id", "")), token)
    except Exception:
        pass
    return payload


def peek_refresh_token(token: str) -> Optional[dict]:
    """Read-only (used by /oauth/introspect)."""
    if not token:
        return None
    return get_cache(_refresh_key(token))


def revoke_refresh_token(token: str) -> bool:
    if not token:
        return False
    payload = get_cache(_refresh_key(token))
    delete_cache(_refresh_key(token))
    if payload:
        try:
            if redis_client is not None:
                redis_client.srem(_user_refresh_set_key(payload.get("user_id", "")), token)
        except Exception:
            pass
    return bool(payload)


def revoke_all_user_refresh_tokens(user_id: str) -> int:
    """Revoke every refresh token issued to this user. Returns the count."""
    if not user_id:
        return 0
    revoked = 0
    try:
        if redis_client is None:
            return 0
        idx = _user_refresh_set_key(user_id)
        tokens = redis_client.smembers(idx) or set()
        for t in tokens:
            delete_cache(_refresh_key(t))
            revoked += 1
        redis_client.delete(idx)
    except Exception as e:
        logger.warning("Failed to revoke refresh tokens for %s: %s", user_id, e)
    return revoked


# ---------------------------------------------------------------------------
# SSO session (server-side state for the browser cookie)
# ---------------------------------------------------------------------------
_SSO_KEY = "sso_session:{sid}"


def create_sso_session(sid: str, user_id: str, email: str, name: str) -> None:
    set_cache(
        _SSO_KEY.format(sid=sid),
        {
            "user_id": user_id,
            "email": email,
            "name": name,
            "created_at": int(time.time()),
        },
        ttl=SSO_SESSION_TTL,
    )


def get_sso_session(sid: str) -> Optional[dict]:
    if not sid:
        return None
    return get_cache(_SSO_KEY.format(sid=sid))


def delete_sso_session(sid: str) -> None:
    if not sid:
        return
    delete_cache(_SSO_KEY.format(sid=sid))
