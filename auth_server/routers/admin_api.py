from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from database import get_db
from models import User, ClientApp, GoogleSetting
from auth_utils import decode_token, create_admin_token, verify_password, get_password_hash
import uuid

router = APIRouter(prefix="/api/v1/admin", tags=["Management API"])

def verify_admin(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authorization required")
    token = authorization.split(" ")[1]
    payload = decode_token(token, is_admin=True)
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return payload

class AdminLoginSchema(BaseModel):
    email: str
    password: str

class UserCreateSchema(BaseModel):
    email: str
    name: Optional[str] = None
    password: str
    is_admin: bool = False

class UserUpdateSchema(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    password: Optional[str] = None

class ClientCreateSchema(BaseModel):
    client_name: str
    redirect_uris: str
    is_sso_enabled: bool = True

class GoogleSettingSchema(BaseModel):
    client_id: str
    client_secret: str
    redirect_uri: str
    is_enabled: bool

@router.post("/login")
def admin_login(data: AdminLoginSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not user.is_admin or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    
    token = create_admin_token(user.id, user.email)
    return {"access_token": token, "token_type": "Bearer", "user": {"email": user.email, "name": user.name}}

# User Management
@router.get("/users")
def list_users(db: Session = Depends(get_db), admin=Depends(verify_admin)):
    users = db.query(User).all()
    return [{"id": u.id, "email": u.email, "name": u.name, "is_admin": u.is_admin, "is_active": u.is_active, "provider": u.provider, "created_at": u.created_at} for u in users]

@router.post("/users")
def create_user(data: UserCreateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="User already exists")
    
    user = User(
        email=data.email,
        name=data.name,
        hashed_password=get_password_hash(data.password),
        is_admin=data.is_admin,
        is_active=True,
        provider="local"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "User created", "user_id": user.id}

@router.put("/users/{user_id}")
def update_user(user_id: str, data: UserUpdateSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if data.name is not None:
        user.name = data.name
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.password:
        user.hashed_password = get_password_hash(data.password)
    
    db.commit()
    return {"message": "User updated"}

# Client Application Management
@router.get("/clients")
def list_clients(db: Session = Depends(get_db), admin=Depends(verify_admin)):
    clients = db.query(ClientApp).all()
    return clients

@router.post("/clients")
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

@router.delete("/clients/{client_id}")
def delete_client(client_id: str, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client application not found")
    db.delete(client)
    db.commit()
    return {"message": "Client deleted"}

# Google Setting Management
@router.get("/google-settings")
def get_google_settings(db: Session = Depends(get_db), admin=Depends(verify_admin)):
    setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not setting:
        return {"client_id": "", "client_secret": "", "redirect_uri": "http://localhost:8000/auth/google/callback", "is_enabled": False}
    return setting

@router.post("/google-settings")
def update_google_settings(data: GoogleSettingSchema, db: Session = Depends(get_db), admin=Depends(verify_admin)):
    setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not setting:
        setting = GoogleSetting(id=1)
        db.add(setting)
    
    setting.client_id = data.client_id
    setting.client_secret = data.client_secret
    setting.redirect_uri = data.redirect_uri
    setting.is_enabled = data.is_enabled
    db.commit()
    return {"message": "Google OAuth settings updated"}

@router.get("/google-test/url")
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

@router.post("/google-test/exchange")
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

        # Parse ID Token payload if present for preview
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

