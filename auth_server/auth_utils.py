import time
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from config import settings
import security
from security import get_private_pem, get_public_pem, get_kid
from token_store import ACCESS_TOKEN_TTL

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Use the persistent keypair for signing OIDC tokens (loaded from security.py)
_private_pem = get_private_pem()
_public_pem = get_public_pem()

def get_password_hash(password: str) -> str:
    # Safely encode password bytes for bcrypt (72-byte max for bcrypt)
    pwd_bytes = password.encode("utf-8")[:72]
    return pwd_context.hash(pwd_bytes)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    pwd_bytes = plain_password.encode("utf-8")[:72]
    return pwd_context.verify(pwd_bytes, hashed_password)

def get_jwks():
    return security.get_jwks()

import pyotp
import qrcode
import io
import base64

def generate_totp_secret() -> str:
    return pyotp.random_base32()

def get_totp_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name="IAM Auth Server")

def generate_qr_code_data_uri(totp_uri: str) -> str:
    try:
        import qrcode.image.svg
        factory = qrcode.image.svg.SvgImage
        img = qrcode.make(totp_uri, image_factory=factory)
        buf = io.BytesIO()
        img.save(buf)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/svg+xml;base64,{b64}"
    except Exception:
        img = qrcode.make(totp_uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"


def verify_totp_code(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(code.strip())

def create_id_token(user_id: str, email: str, name: str, client_id: str, picture: str = None, roles: list = None, sid: str = None) -> str:
    now = int(time.time())
    role_list = roles or ["normal-user"]
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "sub": user_id,
        "aud": client_id,
        "exp": now + ACCESS_TOKEN_TTL,
        "iat": now,
        "auth_time": now,
        "email": email,
        "name": name or email,
        "picture": picture or "",
        "roles": role_list,
    }
    if sid:
        payload["sid"] = sid
    return jwt.encode(payload, _private_pem, algorithm="RS256", headers={"kid": get_kid()})

def create_access_token(user_id: str, client_id: str, scope: str = "openid profile email", roles: list = None, sid: str = None) -> str:
    now = int(time.time())
    role_list = roles or ["normal-user"]
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "sub": user_id,
        "aud": client_id,
        "client_id": client_id,
        "scope": scope,
        "roles": role_list,
        "exp": now + ACCESS_TOKEN_TTL,
        "iat": now,
    }
    if sid:
        payload["sid"] = sid
    return jwt.encode(payload, _private_pem, algorithm="RS256", headers={"kid": get_kid()})

def create_admin_token(user_id: str, email: str, role: str = "admin") -> str:
    now = int(time.time())
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "sub": user_id,
        "email": email,
        "roles": [role] if role else ["admin"],
        "exp": now + (3600 * 24), # 24 hours
        "iat": now,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")

def decode_token(token: str, verify_exp: bool = True):
    """Decode a RS256-signed access/id token. Returns None on any failure.

    When verify_exp=False, expiration is not checked — useful for logout
    where a stale id_token_hint must still identify the client.
    """
    if not token:
        return None
    try:
        return jwt.decode(
            token, _public_pem, algorithms=["RS256"],
            options={"verify_exp": verify_exp},
        )
    except JWTError:
        return None

