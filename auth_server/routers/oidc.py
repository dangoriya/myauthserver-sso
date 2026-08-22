import uuid
import urllib.parse
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Form
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from database import get_db
from models import User, Role, ClientApp, GoogleSetting
from redis_client import set_cache, get_cache, delete_cache
from auth_utils import (
    create_id_token, create_access_token, get_jwks, verify_password, get_password_hash,
    generate_totp_secret, get_totp_uri, generate_qr_code_data_uri, verify_totp_code
)
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

# --- Signup Page & Submit ---
@router.get("/signup")
def signup_page(redirect_uri: str = None, db: Session = Depends(get_db)):
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    google_enabled = g_setting.is_enabled if g_setting else False

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>IAM - Create Account</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            .input-field {{
                transition: all 0.2s ease-in-out;
            }}
            .input-field:invalid:not(:placeholder-shown) {{
                border-color: #ef4444 !important;
                box-shadow: 0 0 12px rgba(239, 68, 68, 0.4) !important;
            }}
        </style>
    </head>
    <body class="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-xl p-8 rounded-3xl border border-slate-800 shadow-2xl">
            <div class="text-center mb-8">
                <div class="w-14 h-14 bg-gradient-to-tr from-emerald-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg font-bold text-xl">
                    IAM
                </div>
                <h1 class="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-indigo-200 to-purple-300 bg-clip-text text-transparent">Create your IAM Account</h1>
                <p class="text-slate-400 text-sm mt-1">Register for central identity access</p>
            </div>

            <form action="/signup-submit" method="POST" class="space-y-4">
                <input type="hidden" name="redirect_uri" value="{redirect_uri or ''}">

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Full Name</label>
                    <input type="text" name="name" required placeholder="John Doe" class="input-field w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Email Address</label>
                    <input type="email" name="email" required placeholder="user@company.com" class="input-field w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Password</label>
                    <div class="relative">
                        <input id="pwd-signup" type="password" name="password" required minlength="6" placeholder="••••••••" class="input-field w-full px-4 py-3 pr-12 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                        <button type="button" onclick="togglePassword('pwd-signup', 'eye-icon')" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1">
                            <svg id="eye-icon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                        </button>
                    </div>
                </div>

                <button type="submit" class="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 mt-2">Create Account</button>
            </form>

            <div class="mt-6 text-center text-sm text-slate-400">
                Already have an account? <a href="/authorize" class="text-emerald-400 hover:underline font-medium">Sign In</a>
            </div>

            {"<div class='relative my-6 text-center text-xs text-slate-400 border-b border-slate-800 leading-none'><span class='bg-slate-900 px-3 absolute -top-2 left-1/2 -translate-x-1/2'>OR</span></div>" if google_enabled else ""}

            {"<a href='/auth/google?redirect_uri=" + urllib.parse.quote(redirect_uri or "") + "' class='w-full flex items-center justify-center gap-3 py-3 bg-white text-slate-900 font-medium rounded-xl hover:bg-slate-100 transition shadow-md'><svg class='w-5 h-5' viewBox='0 0 24 24'><path fill='#4285F4' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'/><path fill='#34A853' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'/><path fill='#FBBC05' d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z'/><path fill='#EA4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z'/></svg> Continue with Google</a>" if google_enabled else ""}
        </div>

        <script>
            function togglePassword(inputId, iconId) {{
                const input = document.getElementById(inputId);
                if (input.type === 'password') {{
                    input.type = 'text';
                }} else {{
                    input.type = 'password';
                }}
            }}
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@router.post("/signup-submit")
def signup_submit(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    redirect_uri: str = Form(""),
    db: Session = Depends(get_db)
):
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Get normal-user role id
    normal_role = db.query(Role).filter(Role.name == "normal-user").first()
    role_id = normal_role.id if normal_role else None

    user = User(
        email=email,
        name=name,
        hashed_password=get_password_hash(password),
        role="normal-user",
        role_id=role_id,
        is_admin=False,
        is_active=True,
        provider="local"
    )
    db.add(user)
    db.commit()

    # Target redirection url (configurable from env)
    target_redirect = redirect_uri if redirect_uri.strip() else settings.SUCCESSFUL_SIGNUP_REDIRECT_URL
    return RedirectResponse(url=target_redirect, status_code=303)


# --- Authorization Endpoint ---
@router.get("/authorize")
def authorize_get(
    request: Request,
    response: Response,
    client_id: str = None,
    redirect_uri: str = None,
    response_type: str = "code",
    scope: str = "openid profile email",
    state: str = None,
    db: Session = Depends(get_db)
):
    # Default to test_client_id_1 if not specified for convenience
    if not client_id:
        client_id = "test_client_id_1"
        redirect_uri = settings.CENTRAL_DASHBOARD_URL

    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()
    if client and redirect_uri:
        valid_uris = [uri.strip() for uri in client.redirect_uris.split(",")]
        # Allow default redirect uri if valid
    
    client_name = client.client_name if client else "IAM Central Auth"

    # Check SSO Session Cookie
    sso_session_id = request.cookies.get("sso_session")
    session_data = get_cache(f"sso_session:{sso_session_id}") if sso_session_id else None

    if session_data and client and client.is_sso_enabled:
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

    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    google_enabled = g_setting.is_enabled if g_setting else False

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>IAM - Sign In</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            .input-field {{
                transition: all 0.2s ease-in-out;
            }}
            .input-field:invalid:not(:placeholder-shown) {{
                border-color: #ef4444 !important;
                box-shadow: 0 0 12px rgba(239, 68, 68, 0.4) !important;
            }}
        </style>
    </head>
    <body class="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-xl p-8 rounded-3xl border border-slate-800 shadow-2xl">
            <div class="text-center mb-8">
                <div class="w-14 h-14 bg-gradient-to-tr from-emerald-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg font-bold text-xl">
                    IAM
                </div>
                <h1 class="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-indigo-200 to-purple-300 bg-clip-text text-transparent">IAM Identity Access</h1>
                <p class="text-slate-400 text-sm mt-1">Authenticating for <span class="font-semibold text-emerald-400">{client_name}</span></p>
            </div>

            <form action="/login-submit" method="POST" class="space-y-4">
                <input type="hidden" name="client_id" value="{client_id}">
                <input type="hidden" name="redirect_uri" value="{redirect_uri or ''}">
                <input type="hidden" name="state" value="{state or ''}">

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Email Address</label>
                    <input type="email" name="email" required placeholder="user@company.com" class="input-field w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Password</label>
                    <div class="relative">
                        <input id="pwd-login" type="password" name="password" required placeholder="••••••••" class="input-field w-full px-4 py-3 pr-12 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                        <button type="button" onclick="togglePassword('pwd-login')" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                        </button>
                    </div>
                </div>

                <button type="submit" class="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 mt-2">Sign In</button>
            </form>

            <div class="mt-4 flex items-center justify-between text-sm">
                <a href="/signup?redirect_uri={urllib.parse.quote(redirect_uri or '')}" class="text-emerald-400 hover:text-emerald-300 font-semibold hover:underline">Sign up →</a>
                <a href="{settings.MANAGEMENT_URL}" class="text-slate-400 hover:text-slate-200">IAM Portal</a>
            </div>

            {"<div class='relative my-6 text-center text-xs text-slate-400 border-b border-slate-800 leading-none'><span class='bg-slate-900 px-3 absolute -top-2 left-1/2 -translate-x-1/2'>OR</span></div>" if google_enabled else ""}

            {"<a href='/auth/google?client_id=" + client_id + "&redirect_uri=" + urllib.parse.quote(redirect_uri or "") + "&state=" + (state or "") + "' class='w-full flex items-center justify-center gap-3 py-3 bg-white text-slate-900 font-medium rounded-xl hover:bg-slate-100 transition shadow-md'><svg class='w-5 h-5' viewBox='0 0 24 24'><path fill='#4285F4' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'/><path fill='#34A853' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'/><path fill='#FBBC05' d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z'/><path fill='#EA4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z'/></svg> Continue with Google</a>" if google_enabled else ""}
        </div>

        <script>
            function togglePassword(inputId) {{
                const input = document.getElementById(inputId);
                input.type = input.type === 'password' ? 'text' : 'password';
            }}
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


# --- Google Auth Initiator & Callback ---
@router.get("/auth/google")
def google_auth_init(client_id: str = None, redirect_uri: str = None, state: str = "", db: Session = Depends(get_db)):
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not g_setting or not g_setting.is_enabled or not g_setting.client_id:
        raise HTTPException(status_code=400, detail="Google Login is not configured or disabled")

    target_client_id = client_id or "test_client_id_1"
    target_redirect_uri = redirect_uri or settings.CENTRAL_DASHBOARD_URL
    oauth_state = f"{target_client_id}|{target_redirect_uri}|{state}"
    params = {
        "client_id": g_setting.client_id,
        "redirect_uri": g_setting.redirect_uri or f"{settings.AUTH_SERVER_URL}/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": oauth_state,
        "access_type": "offline",
        "prompt": "consent"
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url)

@router.get("/auth/google/callback")
async def google_auth_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    if not g_setting or not g_setting.is_enabled or not g_setting.client_id or not g_setting.client_secret:
        # If Google settings are not configured in DB, parse target redirect_uri to report failure back to frontend client
        state_parts = state.split("|") if state else []
        redirect_uri = state_parts[1] if len(state_parts) > 1 and state_parts[1] else settings.CENTRAL_DASHBOARD_URL
        err_url = f"{redirect_uri}?error=Google+OAuth+is+not+fully+configured+in+IAM+Admin+settings"
        return RedirectResponse(err_url)

    token_url = "https://oauth2.googleapis.com/token"
    callback_uri = g_setting.redirect_uri or f"{settings.AUTH_SERVER_URL}/auth/google/callback"
    payload = {
        "code": code,
        "client_id": g_setting.client_id,
        "client_secret": g_setting.client_secret,
        "redirect_uri": callback_uri,
        "grant_type": "authorization_code"
    }

    async with httpx.AsyncClient() as client:
        res = await client.post(token_url, data=payload)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Google token exchange failed")
        token_data = res.json()

        # Fetch Google user profile
        userinfo_res = await client.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": f"Bearer {token_data['access_token']}"})
        if userinfo_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch Google user info")
        google_user = userinfo_res.json()

    google_email = google_user.get("email")
    google_name = google_user.get("name")
    google_picture = google_user.get("picture")

    if not google_email:
        raise HTTPException(status_code=400, detail="Google account email not provided")

    # Find or auto-register user in main user table with default role normal-user
    user = db.query(User).filter(User.email == google_email).first()
    if not user:
        normal_role = db.query(Role).filter(Role.name == "normal-user").first()
        role_id = normal_role.id if normal_role else None
        user = User(
            email=google_email,
            name=google_name,
            picture=google_picture,
            role="normal-user",
            role_id=role_id,
            is_admin=False,
            is_active=True,
            provider="google"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Parse state for client redirection
    state_parts = state.split("|") if state else []
    client_id = state_parts[0] if len(state_parts) > 0 and state_parts[0] else "test_client_id_1"
    redirect_uri = state_parts[1] if len(state_parts) > 1 and state_parts[1] else settings.CENTRAL_DASHBOARD_URL
    app_state = state_parts[2] if len(state_parts) > 2 else ""

    # Check 2FA Step-Up requirement
    enforce_2fa = g_setting.enforce_2fa_all if g_setting else False
    if user.is_2fa_enabled or enforce_2fa:
        # Determine 2FA target host (serve via management frontend if client is management app)
        base_2fa_url = settings.MANAGEMENT_URL.rstrip('/') if (client_id == "auth_management_app" or settings.MANAGEMENT_URL in redirect_uri) else ""
        if not user.totp_secret:
            # Step up to 2FA Setup
            return RedirectResponse(f"{base_2fa_url}/2fa-setup-page?user_id={user.id}&client_id={client_id}&redirect_uri={urllib.parse.quote(redirect_uri)}&state={app_state}")
        else:
            # Step up to 2FA Verification
            return RedirectResponse(f"{base_2fa_url}/2fa-verify-page?user_id={user.id}&client_id={client_id}&redirect_uri={urllib.parse.quote(redirect_uri)}&state={app_state}")

    # Set SSO session in Redis
    sso_session_id = str(uuid.uuid4())
    set_cache(f"sso_session:{sso_session_id}", {"user_id": user.id, "email": user.email}, ttl=86400)

    auth_code = str(uuid.uuid4())
    set_cache(f"auth_code:{auth_code}", {"user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri}, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if app_state:
        target_url += f"&state={app_state}"

    response = RedirectResponse(target_url, status_code=303)
    response.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return response


# --- 2FA Setup & Verification Pages ---
@router.get("/2fa-setup-page")
def two_fa_setup_page(user_id: str, client_id: str, redirect_uri: str, state: str = "", db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.totp_secret:
        user.totp_secret = generate_totp_secret()
        db.commit()

    totp_uri = get_totp_uri(user.totp_secret, user.email)
    qr_code_uri = generate_qr_code_data_uri(totp_uri)

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>IAM - 2FA Setup Required</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-xl p-8 rounded-3xl border border-slate-800 shadow-2xl text-center">
            <div class="w-14 h-14 bg-gradient-to-tr from-amber-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg font-bold text-xl">
                🔐
            </div>
            <h1 class="text-2xl font-bold bg-gradient-to-r from-amber-300 via-indigo-200 to-purple-300 bg-clip-text text-transparent">Configure Two-Factor Auth</h1>
            <p class="text-slate-400 text-sm mt-1 mb-6">Scan the QR code below with your mobile authenticator app (Google Authenticator, Authy, Microsoft Authenticator).</p>

            <div class="bg-white p-4 rounded-2xl inline-block mb-4 shadow-xl border border-slate-700">
                <img src="{qr_code_uri}" alt="2FA QR Code" class="w-48 h-48 mx-auto" />
            </div>

            <p class="text-xs text-slate-400 mb-6">Manual secret key: <span class="font-mono text-emerald-400 select-all font-semibold">{user.totp_secret}</span></p>

            <form action="/2fa-stepup-submit" method="POST" class="space-y-4">
                <input type="hidden" name="user_id" value="{user_id}">
                <input type="hidden" name="client_id" value="{client_id}">
                <input type="hidden" name="redirect_uri" value="{redirect_uri}">
                <input type="hidden" name="state" value="{state}">
                <input type="hidden" name="is_setup" value="true">

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Enter 6-digit Code</label>
                    <input type="text" name="totp_code" required maxlength="6" placeholder="123456" class="w-full text-center tracking-widest font-mono text-2xl px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-emerald-400 placeholder-slate-600 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                </div>

                <button type="submit" class="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold rounded-xl hover:opacity-95 transition shadow-lg mt-2">Verify & Save 2FA</button>
            </form>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@router.get("/2fa-verify-page")
def two_fa_verify_page(user_id: str, client_id: str, redirect_uri: str, state: str = "", db: Session = Depends(get_db)):
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>IAM - 2FA Verification</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-xl p-8 rounded-3xl border border-slate-800 shadow-2xl text-center">
            <div class="w-14 h-14 bg-gradient-to-tr from-emerald-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg font-bold text-xl">
                🛡️
            </div>
            <h1 class="text-2xl font-bold bg-gradient-to-r from-emerald-300 via-indigo-200 to-purple-300 bg-clip-text text-transparent">Two-Factor Security</h1>
            <p class="text-slate-400 text-sm mt-1 mb-6">Enter the verification code from your authenticator app.</p>

            <form action="/2fa-stepup-submit" method="POST" class="space-y-4">
                <input type="hidden" name="user_id" value="{user_id}">
                <input type="hidden" name="client_id" value="{client_id}">
                <input type="hidden" name="redirect_uri" value="{redirect_uri}">
                <input type="hidden" name="state" value="{state}">
                <input type="hidden" name="is_setup" value="false">

                <div>
                    <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">6-Digit Code</label>
                    <input type="text" name="totp_code" required maxlength="6" placeholder="123456" class="w-full text-center tracking-widest font-mono text-2xl px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-emerald-400 placeholder-slate-600 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40">
                </div>

                <button type="submit" class="w-full py-3 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold rounded-xl hover:opacity-95 transition shadow-lg mt-2">Verify Code</button>
            </form>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@router.post("/2fa-stepup-submit")
def two_fa_stepup_submit(
    user_id: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    totp_code: str = Form(...),
    state: str = Form(""),
    is_setup: str = Form("false"),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA invalid state")

    if not verify_totp_code(user.totp_secret, totp_code):
        raise HTTPException(status_code=400, detail="Invalid 2FA verification code")

    if is_setup == "true":
        user.is_2fa_enabled = True
        db.commit()

    sso_session_id = str(uuid.uuid4())
    set_cache(f"sso_session:{sso_session_id}", {"user_id": user.id, "email": user.email}, ttl=86400)

    auth_code = str(uuid.uuid4())
    set_cache(f"auth_code:{auth_code}", {"user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri}, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if state:
        target_url += f"&state={state}"

    response = RedirectResponse(target_url, status_code=303)
    response.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return response


# --- Login Submit (Local Credentials) ---
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

    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    enforce_2fa = g_setting.enforce_2fa_all if g_setting else False

    if user.is_2fa_enabled or enforce_2fa:
        base_2fa_url = settings.MANAGEMENT_URL.rstrip('/') if (client_id == "auth_management_app" or settings.MANAGEMENT_URL in redirect_uri) else ""
        if not user.totp_secret:
            return RedirectResponse(f"{base_2fa_url}/2fa-setup-page?user_id={user.id}&client_id={client_id}&redirect_uri={urllib.parse.quote(redirect_uri)}&state={state}", status_code=303)
        else:
            return RedirectResponse(f"{base_2fa_url}/2fa-verify-page?user_id={user.id}&client_id={client_id}&redirect_uri={urllib.parse.quote(redirect_uri)}&state={state}", status_code=303)

    sso_session_id = str(uuid.uuid4())
    set_cache(f"sso_session:{sso_session_id}", {"user_id": user.id, "email": user.email}, ttl=86400)

    auth_code = str(uuid.uuid4())
    set_cache(f"auth_code:{auth_code}", {"user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri}, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if state:
        target_url += f"&state={state}"

    response = RedirectResponse(target_url, status_code=303)
    response.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return response


# --- OIDC Token & Userinfo Endpoints ---
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
    
    delete_cache(f"auth_code:{code}")

    user = db.query(User).filter(User.id == code_data["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_role = user.role or ("admin" if user.is_admin else "normal-user")
    id_token = create_id_token(user.id, user.email, user.name, client_id, user.picture, role=user_role, is_admin=user.is_admin)
    access_token = create_access_token(user.id, client_id, role=user_role, is_admin=user.is_admin)

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

    user_role = user.role or ("admin" if user.is_admin else "normal-user")
    return {
        "sub": user.id,
        "email": user.email,
        "name": user.name or user.email,
        "picture": user.picture or "",
        "provider": user.provider,
        "role": user_role,
        "roles": [user_role],
        "is_admin": user.is_admin
    }

@router.get("/logout")
def logout(request: Request, post_logout_redirect_uri: str = None):
    sso_session_id = request.cookies.get("sso_session")
    if sso_session_id:
        delete_cache(f"sso_session:{sso_session_id}")
    
    redirect_target = post_logout_redirect_uri or settings.LOGOUT_REDIRECT_URL or settings.AUTH_SERVER_URL
    response = RedirectResponse(redirect_target)
    response.delete_cookie("sso_session")
    return response
