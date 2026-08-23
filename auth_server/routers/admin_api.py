from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db
from models import User, Role, ClientApp, GoogleSetting
from auth_utils import (
    decode_token, create_admin_token, verify_password, get_password_hash,
    generate_totp_secret, get_totp_uri, generate_qr_code_data_uri, verify_totp_code
)
import uuid
import random
from email_utils import EmailService
from redis_client import set_cache, get_cache, delete_cache

router = APIRouter(prefix="/api/v1", tags=["IAM Management API"])

def verify_token(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token required")
    token = authorization.split(" ")[1]
    payload = decode_token(token, is_admin=True)
    if not payload:
        # Try decoding as standard user token
        payload = decode_token(token, is_admin=False)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload

def verify_admin(authorization: Optional[str] = Header(None)):
    payload = verify_token(authorization)
    if payload.get("role") != "admin" and not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return payload

class LoginSchema(BaseModel):
    email: str
    password: str

class SignupRequestCodeSchema(BaseModel):
    email: str
    name: Optional[str] = None

class SignupVerifyCodeSchema(BaseModel):
    email: str
    code: str

class SignupCompleteSchema(BaseModel):
    email: str
    name: Optional[str] = None
    password: str
    code: str

class Signup2FAEnableSchema(BaseModel):
    user_id: str
    totp_code: str

class Reset2FAConfirmSchema(BaseModel):
    otp_code: str

class UserCreateSchema(BaseModel):
    email: str
    name: Optional[str] = None
    password: str
    role: str = "normal-user"
    is_admin: bool = False
    is_2fa_enabled: bool = False

class UserUpdateSchema(BaseModel):
    name: Optional[str] = None
    picture: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    is_2fa_enabled: Optional[bool] = None
    password: Optional[str] = None
    reset_2fa: Optional[bool] = False

class RoleCreateSchema(BaseModel):
    name: str
    label: str
    description: Optional[str] = None
    sort_order: int = 0

class RoleUpdateSchema(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None

class ClientCreateSchema(BaseModel):
    client_name: str
    redirect_uris: str
    is_sso_enabled: bool = True

class GoogleSettingSchema(BaseModel):
    client_id: str
    client_secret: str
    redirect_uri: str
    is_enabled: bool
    enforce_2fa_all: Optional[bool] = False

class ChangePasswordSchema(BaseModel):
    old_password: str
    new_password: str

class Verify2FASchema(BaseModel):
    totp_code: str

# Unified Login Endpoint for IAM App (Supports Admin and Normal Users)
@router.post("/auth/login")
@router.post("/admin/login")
def iam_login(data: LoginSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Check 2FA
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    enforce_2fa = g_setting.enforce_2fa_all if g_setting else False

    requires_2fa = user.is_2fa_enabled or enforce_2fa
    if requires_2fa:
        if not user.totp_secret:
            secret = generate_totp_secret()
            user.totp_secret = secret
            db.commit()
            uri = get_totp_uri(secret, user.email)
            qr_uri = generate_qr_code_data_uri(uri)
            return {
                "requires_2fa_setup": True,
                "user_id": user.id,
                "totp_secret": secret,
                "qr_code": qr_uri,
                "message": "2FA setup required"
            }
        else:
            return {
                "requires_2fa_verify": True,
                "user_id": user.id,
                "message": "2FA code required"
            }
    
    token = create_admin_token(user.id, user.email, role=user.role or ("admin" if user.is_admin else "normal-user"))
    return {
        "access_token": token,
        "token_type": "Bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "is_admin": user.is_admin,
            "is_2fa_enabled": user.is_2fa_enabled,
            "provider": user.provider
        }
    }

# 2FA Verification for IAM Login
class IAMLogin2FAVerifySchema(BaseModel):
    user_id: str
    totp_code: str

@router.post("/auth/login/2fa-verify")
def iam_login_2fa_verify(data: IAMLogin2FAVerifySchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="User 2FA not configured")

    if not verify_totp_code(user.totp_secret, data.totp_code):
        raise HTTPException(status_code=400, detail="Invalid 2FA verification code")

    token = create_admin_token(user.id, user.email, role=user.role or ("admin" if user.is_admin else "normal-user"))
    return {
        "access_token": token,
        "token_type": "Bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "is_admin": user.is_admin,
            "is_2fa_enabled": user.is_2fa_enabled,
            "provider": user.provider
        }
    }

# --- CUSTOM EMAIL SIGNUP ENDPOINTS ---

@router.post("/auth/signup/request-code")
def signup_request_code(data: SignupRequestCodeSchema, db: Session = Depends(get_db)):
    email_clean = data.email.strip().lower()
    existing = db.query(User).filter(User.email == email_clean).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    code = f"{random.randint(100000, 999999)}"
    cache_data = {"code": code, "name": data.name or "", "email": email_clean}
    set_cache(f"signup_code:{email_clean}", cache_data, ttl=600)  # 10 minutes

    EmailService.send_signup_verification_code(email_clean, data.name or "User", code)

    return {
        "message": f"Verification code sent to {email_clean}",
        "email": email_clean
    }

@router.post("/auth/signup/verify-code")
def signup_verify_code(data: SignupVerifyCodeSchema):
    email_clean = data.email.strip().lower()
    cached = get_cache(f"signup_code:{email_clean}")
    if not cached or str(cached.get("code")) != data.code.strip():
        raise HTTPException(status_code=400, detail="Invalid or expired verification code.")

    set_cache(f"signup_verified:{email_clean}", {"verified": True}, ttl=600)
    return {"verified": True, "message": "Email verified successfully"}

@router.post("/auth/signup/complete")
def signup_complete(data: SignupCompleteSchema, db: Session = Depends(get_db)):
    email_clean = data.email.strip().lower()
    
    # Check verification
    verified_cache = get_cache(f"signup_verified:{email_clean}")
    code_cache = get_cache(f"signup_code:{email_clean}")
    
    if not verified_cache and (not code_cache or str(code_cache.get("code")) != data.code.strip()):
        raise HTTPException(status_code=400, detail="Email verification required before completing signup.")

    if db.query(User).filter(User.email == email_clean).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    # Get normal-user role (default for custom self-signup)
    role_obj = db.query(Role).filter(Role.name == "normal-user").first()

    # Pre-generate 2FA secret & QR code for optional 2FA setup step
    secret = generate_totp_secret()
    totp_uri = get_totp_uri(secret, email_clean)
    qr_code = generate_qr_code_data_uri(totp_uri)

    user = User(
        email=email_clean,
        name=data.name,
        hashed_password=get_password_hash(data.password),
        role="normal-user",  # Default role
        role_id=role_obj.id if role_obj else None,
        is_admin=False,
        is_active=True,
        provider="local",
        is_2fa_enabled=False,
        totp_secret=secret
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Clean cache
    delete_cache(f"signup_code:{email_clean}")
    delete_cache(f"signup_verified:{email_clean}")

    token = create_admin_token(user.id, user.email, role=user.role)

    return {
        "access_token": token,
        "token_type": "Bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "is_admin": user.is_admin,
            "is_2fa_enabled": False
        },
        "two_fa_setup": {
            "totp_secret": secret,
            "qr_code": qr_code,
            "service_name": "IAM Auth Server",
            "account_name": user.email
        }
    }

@router.post("/auth/signup/2fa-enable")
def signup_enable_2fa(data: Signup2FAEnableSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA secret not found for user")

    if not verify_totp_code(user.totp_secret, data.totp_code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user.is_2fa_enabled = True
    db.commit()
    return {"message": "2FA successfully activated for your account!"}

# User Self-Profile APIs
@router.get("/user/profile")
def get_profile(db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    role_obj = db.query(Role).filter(Role.id == user.role_id).first() if user.role_id else None

    # Check global 2FA requirement
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    enforce_2fa = g_setting.enforce_2fa_all if g_setting else False

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "role": user.role,
        "role_label": role_obj.label if role_obj else user.role,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
        "provider": user.provider,
        "is_2fa_enabled": user.is_2fa_enabled,
        "enforce_2fa_all": enforce_2fa,
        "has_2fa_configured": bool(user.totp_secret),
        "created_at": user.created_at
    }

@router.post("/user/change-password")
def change_password(data: ChangePasswordSchema, db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.hashed_password and not verify_password(data.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    user.hashed_password = get_password_hash(data.new_password)
    db.commit()
    return {"message": "Password changed successfully"}

@router.post("/user/unlink-google")
def unlink_google(db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not user.hashed_password:
        raise HTTPException(status_code=400, detail="Cannot unlink Google without setting a local password first")
    
    user.provider = "local"
    db.commit()
    return {"message": "Google account unlinked successfully"}

@router.post("/user/2fa/setup-qr")
def get_2fa_setup_qr(db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not user.totp_secret:
        user.totp_secret = generate_totp_secret()
        db.commit()
    
    totp_uri = get_totp_uri(user.totp_secret, user.email)
    qr_data_uri = generate_qr_code_data_uri(totp_uri)
    return {
        "totp_secret": user.totp_secret,
        "qr_code": qr_data_uri
    }

@router.post("/user/2fa/verify-and-enable")
def verify_and_enable_2fa(data: Verify2FASchema, db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA setup not initiated")

    if not verify_totp_code(user.totp_secret, data.totp_code):
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    user.is_2fa_enabled = True
    db.commit()
    return {"message": "2FA successfully enabled"}

@router.post("/user/2fa/disable")
def disable_2fa(db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_2fa_enabled = False
    user.totp_secret = None
    db.commit()
    return {"message": "2FA disabled successfully"}

# 2FA Reset via Email OTP
@router.post("/user/2fa/reset-request-otp")
def user_2fa_reset_request_otp(db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    otp = f"{random.randint(100000, 999999)}"
    set_cache(f"reset_2fa_otp:{user.id}", {"otp": otp}, ttl=600)

    EmailService.send_2fa_reset_otp(user.email, user.name or "User", otp)

    return {"message": f"Security OTP code sent to your registered email ({user.email})."}

@router.post("/user/2fa/reset-confirm-otp")
def user_2fa_reset_confirm_otp(data: Reset2FAConfirmSchema, db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user = db.query(User).filter(User.id == current_user["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    cached = get_cache(f"reset_2fa_otp:{user.id}")
    if not cached or str(cached.get("otp")) != data.otp_code.strip():
        raise HTTPException(status_code=400, detail="Invalid or expired OTP verification code.")

    # Generate brand new 2FA TOTP secret & QR code
    new_secret = generate_totp_secret()
    totp_uri = get_totp_uri(new_secret, user.email)
    new_qr = generate_qr_code_data_uri(totp_uri)

    user.totp_secret = new_secret
    user.is_2fa_enabled = False # User can verify and enable with new QR code
    db.commit()

    delete_cache(f"reset_2fa_otp:{user.id}")

    return {
        "message": "2FA secret key reset successfully. Please scan your new QR code to re-enable.",
        "totp_secret": new_secret,
        "qr_code": new_qr,
        "service_name": "IAM Auth Server",
        "account_name": user.email
    }

# --- ADMIN APIs ---

# Role Management
@router.get("/admin/roles")
def list_roles(db: Session = Depends(get_db), admin=Depends(verify_admin)):
    roles = db.query(Role).order_by(Role.sort_order.asc()).all()
    result = []
    for r in roles:
        active_count = db.query(User).filter(
            or_(User.role == r.name, User.role_id == r.id),
            User.is_active == True
        ).count()
        total_count = db.query(User).filter(
            or_(User.role == r.name, User.role_id == r.id)
        ).count()
        result.append({
            "id": r.id,
            "name": r.name,
            "label": r.label,
            "description": r.description,
            "sort_order": r.sort_order,
            "created_at": r.created_at,
            "active_user_count": active_count,
            "total_user_count": total_count
        })
    return result

@router.post("/admin/roles")
def create_role(data: RoleCreateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    if db.query(Role).filter(Role.name == data.name).first():
        raise HTTPException(status_code=400, detail="Role already exists")
    
    role = Role(
        name=data.name,
        label=data.label,
        description=data.description,
        sort_order=data.sort_order
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role

@router.put("/admin/roles/{role_id}")
def update_role(role_id: int, data: RoleUpdateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if data.label is not None:
        role.label = data.label
    if data.description is not None:
        role.description = data.description
    if data.sort_order is not None:
        role.sort_order = data.sort_order
    
    db.commit()
    return role

@router.delete("/admin/roles/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    # Disable all users assigned to this role when deleting
    associated_users = db.query(User).filter(
        or_(User.role == role.name, User.role_id == role.id)
    ).all()
    disabled_count = len(associated_users)
    for u in associated_users:
        u.is_active = False

    db.delete(role)
    db.commit()
    return {"message": "Role deleted", "disabled_users_count": disabled_count}

# Dynamic User Management (Real-time filtering from Backend)
@router.get("/admin/users")
def list_users(
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    admin=Depends(verify_admin)
):
    query = db.query(User)

    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                User.email.ilike(search_pattern),
                User.name.ilike(search_pattern)
            )
        )
    if role:
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    users = query.order_by(User.created_at.desc()).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "picture": u.picture,
            "role": u.role,
            "role_id": u.role_id,
            "is_admin": u.is_admin,
            "is_active": u.is_active,
            "provider": u.provider,
            "is_2fa_enabled": u.is_2fa_enabled,
            "has_2fa_configured": bool(u.totp_secret),
            "created_at": u.created_at
        }
        for u in users
    ]

@router.post("/admin/users")
def create_user(data: UserCreateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="User already exists")
    
    role_obj = db.query(Role).filter(Role.name == data.role).first()
    role_id = role_obj.id if role_obj else None

    user = User(
        email=data.email,
        name=data.name,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        role_id=role_id,
        is_admin=data.is_admin or (data.role == "admin"),
        is_active=True,
        is_2fa_enabled=data.is_2fa_enabled,
        provider="local"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "User created", "user_id": user.id}

@router.put("/admin/users/{user_id}")
def update_user(user_id: str, data: UserUpdateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if data.name is not None:
        user.name = data.name
    if data.picture is not None:
        user.picture = data.picture
    if data.role is not None:
        user.role = data.role
        role_obj = db.query(Role).filter(Role.name == data.role).first()
        user.role_id = role_obj.id if role_obj else None
        if data.role == "admin":
            user.is_admin = True
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.is_2fa_enabled is not None:
        user.is_2fa_enabled = data.is_2fa_enabled
    if data.reset_2fa:
        user.is_2fa_enabled = False
        user.totp_secret = None
    if data.password:
        user.hashed_password = get_password_hash(data.password)
    
    db.commit()
    return {"message": "User updated"}

# Client Application Management
@router.get("/admin/clients")
def list_clients(db: Session = Depends(get_db), admin=Depends(verify_admin)):
    clients = db.query(ClientApp).all()
    return clients

@router.post("/admin/clients")
def create_client(data: ClientCreateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    client_id = f"client_{uuid.uuid4().hex[:12]}"
    client_secret = f"secret_{uuid.uuid4().hex[:24]}"
    
    client = ClientApp(
        client_id=client_id,
        client_secret=client_secret,
        client_name=data.client_name,
        redirect_uris=data.redirect_uris,
        is_sso_enabled=data.is_sso_enabled
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return client

@router.delete("/admin/clients/{client_id}")
def delete_client(client_id: str, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client application not found")
    db.delete(client)
    db.commit()
    return {"message": "Client deleted"}

# Google Setting & Global 2FA Management
@router.get("/admin/google-settings")
def get_google_settings(db: Session = Depends(get_db)):
    setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not setting:
        return {
            "client_id": "",
            "client_secret": "",
            "redirect_uri": "http://localhost:8000/auth/google/callback",
            "is_enabled": False,
            "enforce_2fa_all": False
        }
    return {
        "client_id": setting.client_id or "",
        "client_secret": setting.client_secret or "",
        "redirect_uri": setting.redirect_uri or "http://localhost:8000/auth/google/callback",
        "is_enabled": setting.is_enabled,
        "enforce_2fa_all": setting.enforce_2fa_all
    }

@router.post("/admin/google-settings")
def update_google_settings(data: GoogleSettingSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    if data.is_enabled and (not data.client_id.strip() or not data.client_secret.strip() or not data.redirect_uri.strip()):
        raise HTTPException(status_code=400, detail="Client ID, Client Secret, and Redirect URI are required when Google SSO is enabled")

    setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not setting:
        setting = GoogleSetting(id=1)
        db.add(setting)
    
    setting.client_id = data.client_id.strip()
    setting.client_secret = data.client_secret.strip()
    setting.redirect_uri = data.redirect_uri.strip()
    setting.is_enabled = data.is_enabled
    if data.enforce_2fa_all is not None:
        setting.enforce_2fa_all = data.enforce_2fa_all
    db.commit()
    return {"message": "OAuth and 2FA settings updated"}

@router.get("/admin/google-test/url")
def get_google_test_url(redirect_uri: str, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not setting or not setting.client_id or not setting.client_secret:
        raise HTTPException(status_code=400, detail="Google OAuth settings are incomplete")
    
    import urllib.parse
    params = {
        "client_id": setting.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent"
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return {"auth_url": url}

class GoogleTestTokenExchangeSchema(BaseModel):
    code: str
    redirect_uri: str

@router.post("/admin/google-test/exchange")
async def exchange_google_test_code(data: GoogleTestTokenExchangeSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not setting or not setting.client_id or not setting.client_secret:
        raise HTTPException(status_code=400, detail="Google OAuth settings are incomplete")

    import httpx
    token_url = "https://oauth2.googleapis.com/token"
    payload = {
        "code": data.code,
        "client_id": setting.client_id,
        "client_secret": setting.client_secret,
        "redirect_uri": data.redirect_uri,
        "grant_type": "authorization_code"
    }

    async with httpx.AsyncClient() as client:
        res = await client.post(token_url, data=payload)
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=f"Google Token exchange failed: {res.text}")
        token_data = res.json()

        id_token_jwt = token_data.get("id_token")
        id_token_payload = None
        if id_token_jwt:
            from jose import jwt
            id_token_payload = jwt.get_unverified_claims(id_token_jwt)

        return {
            "success": True,
            "tokens": token_data,
            "decoded_id_token": id_token_payload
        }

