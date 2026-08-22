import time
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Generate RSA keypair in memory for signing OIDC tokens
_private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048
)

_private_pem = _private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption()
).decode("utf-8")

_public_pem = _private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo
).decode("utf-8")

# Extract numbers for JWKS
pub_numbers = _private_key.public_key().public_numbers()

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password[:72])

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    return pwd_context.verify(plain_password[:72], hashed_password)

def get_jwks():
    import base64
    def int_to_base64(n):
        byte_size = (n.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(n.to_bytes(byte_size, 'big')).rstrip(b'=').decode('utf-8')

    return {
        "keys": [
            {
                "kty": "RSA",
                "alg": "RS256",
                "use": "sig",
                "kid": "myauth-key-1",
                "n": int_to_base64(pub_numbers.n),
                "e": int_to_base64(pub_numbers.e)
            }
        ]
    }

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

def create_id_token(user_id: str, email: str, name: str, client_id: str, picture: str = None, role: str = "normal-user", is_admin: bool = False) -> str:
    now = int(time.time())
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "sub": user_id,
        "aud": client_id,
        "exp": now + 3600,
        "iat": now,
        "email": email,
        "name": name or email,
        "picture": picture or "",
        "role": role,
        "roles": [role],
        "is_admin": is_admin
    }
    return jwt.encode(payload, _private_pem, algorithm="RS256", headers={"kid": "myauth-key-1"})

def create_access_token(user_id: str, client_id: str, scope: str = "openid profile email", role: str = "normal-user", is_admin: bool = False) -> str:
    now = int(time.time())
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "sub": user_id,
        "client_id": client_id,
        "scope": scope,
        "role": role,
        "roles": [role],
        "is_admin": is_admin,
        "exp": now + 3600,
        "iat": now
    }
    return jwt.encode(payload, _private_pem, algorithm="RS256", headers={"kid": "myauth-key-1"})

def create_admin_token(user_id: str, email: str, role: str = "admin") -> str:
    now = int(time.time())
    payload = {
        "iss": settings.AUTH_SERVER_URL,
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": now + (3600 * 24), # 24 hours
        "iat": now
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")

def decode_token(token: str, is_admin: bool = False):
    try:
        key = settings.SECRET_KEY if is_admin else _public_pem
        alg = "HS256" if is_admin else "RS256"
        return jwt.decode(token, key, algorithms=[alg], options={"verify_aud": False})
    except JWTError:
        return None
