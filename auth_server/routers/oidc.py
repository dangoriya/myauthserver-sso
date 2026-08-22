import uuid
import urllib.parse
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Form
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from database import get_db
from models import User, ClientApp, GoogleSetting
from redis_client import set_cache, get_cache, delete_cache
from auth_utils import create_id_token, create_access_token, get_jwks, verify_password, get_password_hash
from config import settings
import httpx

router = APIRouter(tags=["OIDC / OAuth2"])

@router.get("/.well-known/openid-configuration")
def openid_configuration():
    return {
        "issuer": settings.AUTH_SERVER_URL,
        "authorization_endpoint": f"{settings.AUTH_SERVER_URL}/authorize",
        "token_endpoint": f"{settings.AUTH_SERVER_URL}/token",
        "userinfo_endpoint": f"{settings.AUTH_SERVER_URL}/userinfo",
        "end_session_endpoint": f"{settings.AUTH_SERVER_URL}/logout",
        "jwks_uri": f"{settings.AUTH_SERVER_URL}/jwks.json",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": ["openid", "profile", "email"],
        "grant_types_supported": ["authorization_code"]
    }

@router.get("/jwks.json")
def jwks():
    return get_jwks()

@router.get("/authorize")
def authorize_get(
    request: Request,
    response: Response,
    client_id: str,
    redirect_uri: str,
    response_type: str = "code",
    scope: str = "openid profile email",
    state: str = None,
    db: Session = Depends(get_db)
):
    # Verify Client Application
    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client:
        raise HTTPException(status_code=400, detail="Invalid client_id")
    
    valid_uris = [uri.strip() for uri in client.redirect_uris.split(",")]
    if redirect_uri not in valid_uris:
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")

    # Check SSO Session Cookie
    sso_session_id = request.cookies.get("sso_session")
    session_data = get_cache(f"sso_session:{sso_session_id}") if sso_session_id else None

    if session_data and client.is_sso_enabled:
        # SSO User already authenticated! Generate authorization code directly
        auth_code = str(uuid.uuid4())
        code_payload = {
            "user_id": session_data["user_id"],
            "client_id": client_id,
            "redirect_uri": redirect_uri
        }
        set_cache(f"auth_code:{auth_code}", code_payload, ttl=600)
        
        target_url = f"{redirect_uri}?code={auth_code}"
        if state:
            target_url += f"&state={state}"
        return RedirectResponse(target_url)

    # Render simple Auth Login / Google SSO Page
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    google_enabled = g_setting.is_enabled if g_setting else False

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Central SSO Auth - Sign In</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-white/10 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl">
            <div class="text-center mb-8">
                <div class="w-16 h-16 bg-gradient-to-r from-emerald-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
                    <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <h1 class="text-2xl font-bold">Sign In to Continue</h1>
                <p class="text-slate-300 text-sm mt-1">Authenticating for <span class="font-semibold text-emerald-400">{client.client_name}</span></p>
            </div>

            <form action="/login-submit" method="POST" class="space-y-4">
                <input type="hidden" name="client_id" value="{client_id}">
                <input type="hidden" name="redirect_uri" value="{redirect_uri}">
                <input type="hidden" name="state" value="{state or ''}">

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-300 mb-1">Email Address</label>
                    <input type="email" name="email" required placeholder="user@company.com" class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400">
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-300 mb-1">Password</label>
                    <input type="password" name="password" required placeholder="••••••••" class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400">
                </div>
                <button type="submit" class="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold rounded-xl hover:opacity-90 transition shadow-lg mt-2">Sign In</button>
            </form>

            {"<div class='relative my-6 text-center text-xs text-slate-400 border-b border-white/10 leading-none'><span class='bg-slate-900 px-3 absolute -top-2 left-1/2 -translate-x-1/2'>OR</span></div>" if google_enabled else ""}

            {"<a href='/auth/google?client_id=" + client_id + "&redirect_uri=" + urllib.parse.quote(redirect_uri) + "&state=" + (state or "") + "' class='w-full flex items-center justify-center gap-3 py-3 bg-white text-slate-900 font-medium rounded-xl hover:bg-slate-100 transition shadow-md'><svg class='w-5 h-5' viewBox='0 0 24 24'><path fill='#4285F4' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'/><path fill='#34A853' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'/><path fill='#FBBC05' d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z'/><path fill='#EA4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z'/></svg> Continue with Google</a>" if google_enabled else ""}
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@router.post("/login-submit")
def login_submit(
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    state: str = Form(""),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Set SSO session in Redis
    sso_session_id = str(uuid.uuid4())
    set_cache(f"sso_session:{sso_session_id}", {"user_id": user.id, "email": user.email}, ttl=86400) # 24h

    # Create authorization code
    auth_code = str(uuid.uuid4())
    set_cache(f"auth_code:{auth_code}", {"user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri}, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if state:
        target_url += f"&state={state}"

    response = RedirectResponse(target_url, status_code=303)
    response.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return response

@router.post("/token")
def token_endpoint(
    grant_type: str = Form(...),
    code: str = Form(...),
    redirect_uri: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    db: Session = Depends(get_db)
):
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="Unsupported grant_type")
    
    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if not client or client.client_secret != client_secret:
        raise HTTPException(status_code=401, detail="Invalid client authentication")
    
    code_data = get_cache(f"auth_code:{code}")
    if not code_data:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    
    if code_data["client_id"] != client_id or code_data["redirect_uri"] != redirect_uri:
        raise HTTPException(status_code=400, detail="Code client_id/redirect_uri mismatch")
    
    # One-time use of auth code
    delete_cache(f"auth_code:{code}")

    user = db.query(User).filter(User.id == code_data["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    id_token = create_id_token(user.id, user.email, user.name, client_id, user.picture)
    access_token = create_access_token(user.id, client_id)

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "id_token": id_token
    }

@router.get("/userinfo")
def userinfo_endpoint(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    
    token = auth_header.split(" ")[1]
    from auth_utils import decode_token
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid access token")
    
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "sub": user.id,
        "email": user.email,
        "name": user.name or user.email,
        "picture": user.picture or "",
        "provider": user.provider
    }

@router.get("/logout")
def logout(request: Request, post_logout_redirect_uri: str = None):
    sso_session_id = request.cookies.get("sso_session")
    if sso_session_id:
        delete_cache(f"sso_session:{sso_session_id}")
    
    redirect_target = post_logout_redirect_uri or settings.AUTH_SERVER_URL
    response = RedirectResponse(redirect_target)
    response.delete_cookie("sso_session")
    return response
