"""
Jinja2-rendered authentication pages:
  - /signup            (GET)            — wizard entry
  - /signup/step/1     (POST)           — submit name+email
  - /signup/step/2     (POST)           — submit 6-digit code
  - /signup/step/3     (POST)           — submit password
  - /signup/step/4     (POST)           — submit 2FA code (optional)
  - /signup/step/skip-2fa (GET)         — skip 2FA and finalize

The login (GET /authorize and POST /login-submit) is in routers/oidc.py
and renders Jinja2 templates via security.render_template.

Flow state is persisted in Redis under `signup_flow:<flow_id>` with a TTL of
30 minutes. After a successful signup the user is *strictly* redirected to
the management portal's profile page (MANAGEMENT_URL/dashboard/profile) —
no OIDC dance, just a server-side session cookie so the management app
knows who the user is.
"""

from __future__ import annotations

import logging
import random
import re
import secrets
import urllib.parse
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Form, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import User, Role, GoogleSetting
from redis_client import set_cache, get_cache, delete_cache
from security import (
    audit,
    issue_csrf,
    rate_limit_signup,
    rate_limit_otp,
    render_template,
    set_sso_cookie,
    validate_csrf,
)
from auth_utils import (
    generate_qr_code_data_uri,
    generate_totp_secret,
    get_password_hash,
    get_totp_uri,
    verify_totp_code,
)
from email_utils import EmailService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Auth Pages (Jinja2)"])

SIGNUP_FLOW_TTL = 30 * 60  # 30 minutes
OTP_TTL = 10 * 60           # 10 minutes
OTP_LEN = 6

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Same constant used by the management app (auth_management_app) so the
# "Sign in" link from the signup page goes to a valid OIDC client whose
# redirect_uri is registered. Using a generic default would 400 out with
# "redirect URI not registered" as we saw during testing.
DEFAULT_AUTH_CLIENT = "auth_management_app"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _new_flow() -> str:
    return secrets.token_urlsafe(24)


def _load_flow(flow_id: str) -> Optional[dict]:
    if not flow_id:
        return None
    return get_cache(f"signup_flow:{flow_id}")


def _save_flow(flow_id: str, data: dict) -> None:
    set_cache(f"signup_flow:{flow_id}", data, ttl=SIGNUP_FLOW_TTL)


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[:2]}***{local[-1]}@{domain}"


def _send_otp(email: str, name: str) -> str:
    code = "".join(str(random.randint(0, 9)) for _ in range(OTP_LEN))
    set_cache(f"signup_code:{email.lower()}", code, ttl=OTP_TTL)
    EmailService.send_signup_verification_code(email, name, code)
    return code


def _signin_href() -> str:
    """The "Sign in" link rendered in the signup footer.

    Sends the user back to the OIDC login page using the central
    `auth_management_app` client so the redirect_uri is always registered.
    """
    params = {
        "client_id": DEFAULT_AUTH_CLIENT,
        "redirect_uri": f"{settings.MANAGEMENT_URL.rstrip('/')}/auth/callback",
    }
    return f"/authorize?{urllib.parse.urlencode(params)}"


def _google_href() -> str:
    enc = urllib.parse.quote(f"{settings.MANAGEMENT_URL.rstrip('/')}/auth/callback")
    return f"/auth/google?client_id={DEFAULT_AUTH_CLIENT}&redirect_uri={enc}"


def _get_google_enabled(db: Session) -> bool:
    g = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    return bool(g and g.is_enabled)


def _signup_context(
    request: Request,
    response: Response,
    *,
    step: int,
    flow_id: str,
    form: Optional[dict] = None,
    errors: Optional[dict] = None,
    error: Optional[str] = None,
    notice: Optional[str] = None,
    two_fa: Optional[dict] = None,
    masked_email: str = "",
) -> dict:
    """Build the template context for the signup wizard."""
    return {
        "step": step,
        "flow_id": flow_id,
        "form": form or {},
        "errors": errors or {},
        "error": error,
        "notice": notice,
        "two_fa": two_fa,
        "masked_email": masked_email,
        "google_enabled": _get_google_enabled(request.state.db) if hasattr(request.state, "db") else False,
        "google_href": _google_href(),
        "signin_href": _signin_href(),
    }


# ---------------------------------------------------------------------------
# Signup wizard entry
# ---------------------------------------------------------------------------
@router.get("/signup")
async def signup_get(
    request: Request,
    response: Response,
    flow_id: Optional[str] = None,
    resend: Optional[int] = None,
    db: Session = Depends(get_db),
):
    request.state.db = db
    flow = _load_flow(flow_id) if flow_id else None
    if not flow:
        flow = {"step": 1, "data": {}}
        flow_id = _new_flow()
        _save_flow(flow_id, flow)

    # Resend code if user is on step 2 and clicks "resend"
    if resend and flow.get("step") == 2 and flow.get("data", {}).get("email"):
        try:
            rate_limit_otp(request, flow["data"]["email"])
            _send_otp(flow["data"]["email"], flow["data"].get("name", ""))
            audit("signup_otp_resent", request, email=flow["data"]["email"])
            return render_template(
                request, "auth/signup.html", status_code=200,
                step=2, flow_id=flow_id, form=flow.get("data", {}),
                masked_email=_mask_email(flow["data"]["email"]),
                notice=f"A new code was sent to {_mask_email(flow['data']['email'])}.",
                google_enabled=_get_google_enabled(db), google_href=_google_href(),
                signin_href=_signin_href(),
            )
        except Exception as e:
            logger.exception("Resend OTP failed: %s", e)

    step = int(flow.get("step", 1))
    ctx = {
        "step": step,
        "flow_id": flow_id,
        "form": flow.get("data", {}),
        "errors": {},
        "google_enabled": _get_google_enabled(db),
        "google_href": _google_href(),
        "signin_href": _signin_href(),
    }
    if step == 2:
        ctx["masked_email"] = _mask_email(flow.get("data", {}).get("email", ""))
    if step == 4:
        email = flow.get("data", {}).get("email", "")
        secret = flow.get("totp_secret")
        if not secret:
            secret = generate_totp_secret()
            flow["totp_secret"] = secret
            _save_flow(flow_id, flow)
        uri = get_totp_uri(secret, email)
        ctx["two_fa"] = {
            "qr_code": generate_qr_code_data_uri(uri),
            "totp_secret": secret,
            "service_name": "IAM Auth Server",
            "account_name": email,
        }
    return render_template(request, "auth/signup.html", **ctx)


# ---------------------------------------------------------------------------
# Step 1: name + email → request code
# ---------------------------------------------------------------------------
@router.post("/signup/step/1")
async def signup_step1(
    request: Request,
    response: Response,
    flow_id: str = Form(...),
    name: str = Form(...),
    email: str = Form(...),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    await validate_csrf(request, form_token=csrf_token)
    flow = _load_flow(flow_id) or {"step": 1, "data": {}}

    name_clean = (name or "").strip()
    email_clean = (email or "").strip().lower()

    errors = {}
    if not name_clean or len(name_clean) < 2:
        errors["name"] = "Please enter your full name."
    if not EMAIL_RE.match(email_clean):
        errors["email"] = "Please enter a valid email address."

    if errors:
        return render_template(
            request, "auth/signup.html", status_code=400,
            step=1, flow_id=flow_id,
            form={"name": name_clean, "email": email_clean},
            errors=errors,
            google_enabled=_get_google_enabled(db), google_href=_google_href(),
            signin_href=_signin_href(),
        )

    try:
        rate_limit_signup(request, email_clean)
    except Exception:
        return render_template(
            request, "auth/signup.html", status_code=429,
            step=1, flow_id=flow_id,
            form={"name": name_clean, "email": email_clean},
            errors={"email": "Too many attempts. Please wait a few minutes."},
            google_enabled=_get_google_enabled(db), google_href=_google_href(),
            signin_href=_signin_href(),
        )

    if db.query(User).filter(User.email == email_clean).first():
        return render_template(
            request, "auth/signup.html", status_code=409,
            step=1, flow_id=flow_id,
            form={"name": name_clean, "email": email_clean},
            errors={"email": "An account with this email already exists. Try signing in instead."},
            google_enabled=_get_google_enabled(db), google_href=_google_href(),
            signin_href=_signin_href(),
        )

    flow["data"] = {"name": name_clean, "email": email_clean}
    flow["step"] = 2
    _save_flow(flow_id, flow)

    try:
        rate_limit_otp(request, email_clean)
        _send_otp(email_clean, name_clean)
    except Exception as e:
        logger.exception("Failed to send signup OTP: %s", e)
        return render_template(
            request, "auth/signup.html", status_code=500,
            step=1, flow_id=flow_id,
            form={"name": name_clean, "email": email_clean},
            errors={"email": "We couldn't send the verification email. Please try again later."},
            google_enabled=_get_google_enabled(db), google_href=_google_href(),
            signin_href=_signin_href(),
        )

    audit("signup_otp_sent", request, email=email_clean)
    return render_template(
        request, "auth/signup.html",
        step=2, flow_id=flow_id, form=flow["data"],
        masked_email=_mask_email(email_clean),
        notice=f"A 6-digit code was sent to {_mask_email(email_clean)}. It expires in 10 minutes.",
        google_enabled=_get_google_enabled(db), google_href=_google_href(),
        signin_href=_signin_href(),
    )


# ---------------------------------------------------------------------------
# Step 2: verify 6-digit code
# ---------------------------------------------------------------------------
@router.post("/signup/step/2")
async def signup_step2(
    request: Request,
    response: Response,
    flow_id: str = Form(...),
    code: str = Form(...),
    csrf_token: str = Form(...),
):
    await validate_csrf(request, form_token=csrf_token)
    flow = _load_flow(flow_id)
    if not flow or flow.get("step") != 2:
        return RedirectResponse(url="/signup", status_code=303)

    email = flow.get("data", {}).get("email", "").lower()
    expected = get_cache(f"signup_code:{email}")
    submitted = (code or "").strip()

    if not expected or submitted != str(expected):
        try:
            rate_limit_otp(request, email)
        except Exception:
            pass
        return render_template(
            request, "auth/signup.html", status_code=400,
            step=2, flow_id=flow_id, form=flow.get("data", {}),
            masked_email=_mask_email(email),
            errors={"code": "Invalid or expired verification code. Please try again."},
            signin_href=_signin_href(),
        )

    delete_cache(f"signup_code:{email}")
    flow["step"] = 3
    flow["email_verified"] = True
    _save_flow(flow_id, flow)

    audit("signup_email_verified", request, email=email)
    return render_template(
        request, "auth/signup.html",
        step=3, flow_id=flow_id, form=flow.get("data", {}),
        notice="Email verified. Now create a secure password.",
        signin_href=_signin_href(),
    )


# ---------------------------------------------------------------------------
# Step 3: set password → create user
# ---------------------------------------------------------------------------
@router.post("/signup/step/3")
async def signup_step3(
    request: Request,
    response: Response,
    flow_id: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    await validate_csrf(request, form_token=csrf_token)
    flow = _load_flow(flow_id)
    if not flow or flow.get("step") != 3 or not flow.get("email_verified"):
        return RedirectResponse(url="/signup", status_code=303)

    email = flow["data"]["email"].lower()
    name = flow["data"]["name"]

    errors = {}
    if len(password or "") < 8:
        errors["password"] = "Password must be at least 8 characters."
    elif not re.search(r"[A-Za-z]", password):
        errors["password"] = "Password must include at least one letter."
    elif not re.search(r"\d", password):
        errors["password"] = "Password must include at least one number."

    if errors:
        return render_template(
            request, "auth/signup.html", status_code=400,
            step=3, flow_id=flow_id, form=flow.get("data", {}),
            errors=errors, signin_href=_signin_href(),
        )

    if db.query(User).filter(User.email == email).first():
        # Reset flow and send them to step 1
        new_flow_id = _new_flow()
        return render_template(
            request, "auth/signup.html", status_code=409,
            step=1, flow_id=new_flow_id, form={},
            errors={"email": "An account with this email already exists. Try signing in instead."},
            google_enabled=_get_google_enabled(db), google_href=_google_href(),
            signin_href=_signin_href(),
        )

    normal_role = db.query(Role).filter(Role.name == "normal-user").first()
    user = User(
        email=email,
        name=name,
        hashed_password=get_password_hash(password),
        role="normal-user",
        role_id=normal_role.id if normal_role else None,
        is_admin=False,
        is_active=True,
        provider="local",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    audit("signup_completed", request, user_id=user.id, email=email)

    # Stage the TOTP secret for optional 2FA setup in step 4
    flow["user_id"] = user.id
    flow["email"] = email
    flow["step"] = 4
    flow["totp_secret"] = flow.get("totp_secret") or generate_totp_secret()
    _save_flow(flow_id, flow)

    # Render step 4 (2FA setup) by redirecting to the wizard
    return RedirectResponse(url=f"/signup?flow_id={flow_id}", status_code=303)


# ---------------------------------------------------------------------------
# Step 4: optional 2FA activation
# ---------------------------------------------------------------------------
@router.post("/signup/step/4")
async def signup_step4(
    request: Request,
    response: Response,
    flow_id: str = Form(...),
    totp_code: str = Form(...),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    await validate_csrf(request, form_token=csrf_token)
    flow = _load_flow(flow_id)
    if not flow or flow.get("step") != 4 or not flow.get("user_id"):
        return RedirectResponse(url="/signup", status_code=303)

    secret = flow.get("totp_secret")
    email = flow.get("data", {}).get("email", "")

    if not secret or not verify_totp_code(secret, totp_code.strip()):
        return render_template(
            request, "auth/signup.html", status_code=400,
            step=4, flow_id=flow_id, form=flow.get("data", {}),
            two_fa={
                "qr_code": generate_qr_code_data_uri(get_totp_uri(secret, email)),
                "totp_secret": secret,
            },
            errors={"totp_code": "Invalid 2FA code. Please try again."},
            signin_href=_signin_href(),
        )

    user = db.query(User).filter(User.id == flow["user_id"]).first()
    if not user:
        return RedirectResponse(url="/signup", status_code=303)

    user.totp_secret = secret
    user.is_2fa_enabled = True
    db.commit()
    db.refresh(user)

    audit("signup_2fa_enabled", request, user_id=user.id, email=user.email)
    return _finalize_signup(request, response, flow, flow_id, db, user)


@router.get("/signup/step/skip-2fa")
async def signup_skip_2fa(
    request: Request,
    response: Response,
    flow_id: str,
    db: Session = Depends(get_db),
):
    flow = _load_flow(flow_id)
    if not flow or not flow.get("user_id"):
        return RedirectResponse(url="/signup", status_code=303)
    user = db.query(User).filter(User.id == flow["user_id"]).first()
    if not user:
        return RedirectResponse(url="/signup", status_code=303)
    audit("signup_2fa_skipped", request, user_id=user.id, email=user.email)
    return _finalize_signup(request, response, flow, flow_id, db, user)


def _finalize_signup(
    request: Request, response: Response, flow: dict, flow_id: str,
    db: Session, user: User,
):
    """Hand off to the management app's profile page.

    Strictly redirects to MANAGEMENT_URL/dashboard/profile?welcome=1 — no
    OIDC dance. We set the sso_session cookie so the management app can
    identify the user immediately, and clear the signup flow from Redis.
    """
    delete_cache(f"signup_flow:{flow_id}")

    sso_session_id = str(uuid.uuid4())
    set_cache(
        f"sso_session:{sso_session_id}",
        {"user_id": user.id, "email": user.email, "name": user.name, "role": user.role},
        ttl=86400,
    )
    set_sso_cookie(response, sso_session_id, max_age=86400)
    # Rotate CSRF on privilege change
    issue_csrf(response, f"post-signup:{user.id}")

    target = f"{settings.MANAGEMENT_URL.rstrip('/')}/dashboard/profile?welcome=1"
    audit("signup_redirect_to_mgmt", request, user_id=user.id, email=user.email,
          extra={"target": target})
    return RedirectResponse(url=target, status_code=303)
