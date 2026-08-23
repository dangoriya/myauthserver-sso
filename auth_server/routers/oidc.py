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

# ---------------------------------------------------------------------------
# Shared CSS & head snippet used across all auth-server-served HTML pages
# ---------------------------------------------------------------------------
_SSO_HEAD = """
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg-base:       #080e1a;
    --bg-card:       rgba(15, 23, 42, 0.85);
    --border-subtle: rgba(99, 102, 241, 0.18);
    --border-glow:   rgba(99, 102, 241, 0.45);
    --accent-1:      #6366f1;
    --accent-2:      #10b981;
    --text-primary:  #f1f5f9;
    --text-muted:    #94a3b8;
    --text-dim:      #64748b;
    --error-bg:      rgba(244, 63, 94, 0.08);
    --error-border:  rgba(244, 63, 94, 0.35);
    --error-text:    #fb7185;
    --input-bg:      rgba(30, 41, 59, 0.7);
    --input-border:  rgba(71, 85, 105, 0.6);
    --input-focus:   #6366f1;
    --radius-card:   24px;
    --radius-input:  14px;
    --radius-btn:    14px;
    --font:          'Inter', system-ui, -apple-system, sans-serif;
  }

  html, body {
    min-height: 100%;
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font);
    -webkit-font-smoothing: antialiased;
  }

  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background:
      radial-gradient(ellipse 80% 60% at 20% -10%, rgba(99,102,241,0.18) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 80% 110%, rgba(16,185,129,0.12) 0%, transparent 55%),
      #080e1a;
  }

  /* Animated background particles */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      radial-gradient(circle at 15% 25%, rgba(99,102,241,0.06) 0 1px, transparent 1px),
      radial-gradient(circle at 85% 75%, rgba(16,185,129,0.05) 0 1px, transparent 1px),
      radial-gradient(circle at 55% 50%, rgba(139,92,246,0.04) 0 1px, transparent 1px);
    background-size: 60px 60px, 80px 80px, 100px 100px;
    pointer-events: none;
    z-index: 0;
  }

  .wrapper {
    width: 100%;
    max-width: 440px;
    position: relative;
    z-index: 1;
  }

  /* --- Card --- */
  .card {
    background: var(--bg-card);
    backdrop-filter: blur(24px) saturate(160%);
    -webkit-backdrop-filter: blur(24px) saturate(160%);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-card);
    padding: 2.25rem 2rem;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.03) inset,
      0 32px 64px -16px rgba(0,0,0,0.6),
      0 0 80px -20px rgba(99,102,241,0.15);
    animation: cardIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes cardIn {
    from { opacity: 0; transform: translateY(20px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* --- Logo / Icon --- */
  .logo-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 1.75rem;
    text-align: center;
  }

  .logo-icon {
    width: 60px; height: 60px;
    border-radius: 18px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 1.2rem; letter-spacing: -0.5px;
    color: #fff;
    background: linear-gradient(135deg, #6366f1 0%, #10b981 100%);
    box-shadow: 0 8px 32px rgba(99,102,241,0.4), 0 2px 8px rgba(0,0,0,0.3);
    margin-bottom: 1rem;
    position: relative;
    overflow: hidden;
  }

  .logo-icon::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 50%;
    background: rgba(255,255,255,0.12);
    border-radius: 18px 18px 50% 50%;
  }

  .logo-title {
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.4px;
    background: linear-gradient(135deg, #a5b4fc 0%, #e0f2fe 50%, #6ee7b7 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 0.35rem;
  }

  .logo-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 400;
  }

  .client-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 0.6rem;
    padding: 0.3rem 0.8rem;
    background: rgba(99,102,241,0.1);
    border: 1px solid rgba(99,102,241,0.25);
    border-radius: 100px;
    font-size: 0.72rem;
    font-weight: 600;
    color: #a5b4fc;
    letter-spacing: 0.2px;
  }

  .client-badge::before {
    content: '🔐';
    font-size: 0.7rem;
  }

  /* --- Form Elements --- */
  .field { margin-bottom: 1.1rem; }

  .field-label {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin-bottom: 0.45rem;
  }

  .input-wrap { position: relative; }

  .field-input {
    width: 100%;
    padding: 0.82rem 1rem;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-input);
    color: var(--text-primary);
    font-size: 0.92rem;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  }

  .field-input::placeholder { color: #475569; }

  .field-input:focus {
    border-color: var(--input-focus);
    background: rgba(30, 41, 59, 0.95);
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15), 0 0 20px rgba(99,102,241,0.08);
  }

  .field-input.has-icon { padding-right: 3rem; }

  .input-icon-btn {
    position: absolute;
    right: 0.75rem;
    top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    color: var(--text-dim);
    padding: 0.25rem;
    display: flex; align-items: center;
    transition: color 0.15s;
    line-height: 1;
  }
  .input-icon-btn:hover { color: var(--text-primary); }

  /* --- Primary Button --- */
  .btn-primary {
    width: 100%;
    padding: 0.9rem 1.5rem;
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 40%, #7c3aed 100%);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    font-family: var(--font);
    border: none;
    border-radius: var(--radius-btn);
    cursor: pointer;
    transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
    box-shadow: 0 4px 24px rgba(99,102,241,0.35), 0 1px 3px rgba(0,0,0,0.3);
    margin-top: 0.5rem;
    position: relative;
    overflow: hidden;
  }
  .btn-primary::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 40%;
    background: rgba(255,255,255,0.1);
    border-radius: var(--radius-btn) var(--radius-btn) 50% 50%;
  }
  .btn-primary:hover { opacity: 0.93; transform: translateY(-1px); box-shadow: 0 6px 32px rgba(99,102,241,0.45); }
  .btn-primary:active { transform: translateY(0); opacity: 1; }

  /* --- Google Button --- */
  .btn-google {
    width: 100%;
    padding: 0.82rem 1.5rem;
    background: #fff;
    color: #1e293b;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: var(--font);
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: var(--radius-btn);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 0.6rem;
    text-decoration: none;
    transition: background 0.15s, box-shadow 0.15s, transform 0.15s;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  }
  .btn-google:hover { background: #f8fafc; transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,0,0,0.25); }

  /* --- Divider --- */
  .divider {
    display: flex; align-items: center; gap: 0.75rem;
    margin: 1.1rem 0;
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .divider::before, .divider::after {
    content: ''; flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--border-subtle), transparent);
  }

  /* --- Error / Info Banners --- */
  .banner-error {
    padding: 0.75rem 1rem;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 12px;
    color: var(--error-text);
    font-size: 0.82rem;
    margin-bottom: 1.1rem;
    display: flex; align-items: flex-start; gap: 0.5rem;
    animation: shake 0.35s ease;
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-4px); }
    40%       { transform: translateX(4px); }
    60%       { transform: translateX(-3px); }
    80%       { transform: translateX(2px); }
  }

  .banner-info {
    padding: 0.75rem 1rem;
    background: rgba(16,185,129,0.07);
    border: 1px solid rgba(16,185,129,0.2);
    border-radius: 12px;
    color: #6ee7b7;
    font-size: 0.82rem;
    margin-bottom: 1.1rem;
    display: flex; align-items: center; gap: 0.5rem;
  }

  /* --- Footer Links --- */
  .footer-links {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 1.35rem;
    padding-top: 1.1rem;
    border-top: 1px solid rgba(30, 41, 59, 0.8);
    font-size: 0.8rem;
  }

  .link {
    color: var(--accent-2);
    text-decoration: none;
    font-weight: 600;
    transition: color 0.15s, text-decoration 0.15s;
  }
  .link:hover { color: #34d399; text-decoration: underline; }

  .link-muted {
    color: var(--text-dim);
    text-decoration: none;
    font-weight: 400;
    font-size: 0.75rem;
    transition: color 0.15s;
  }
  .link-muted:hover { color: var(--text-muted); }

  /* --- OTP / Code input --- */
  .otp-input {
    width: 100%;
    padding: 1rem;
    background: var(--input-bg);
    border: 1.5px solid var(--input-border);
    border-radius: var(--radius-input);
    color: #6ee7b7;
    font-family: 'Courier New', monospace;
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: 0.5em;
    text-align: center;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .otp-input::placeholder { color: #1e3a2e; letter-spacing: 0.3em; font-size: 1.5rem; }
  .otp-input:focus {
    border-color: #10b981;
    box-shadow: 0 0 0 3px rgba(16,185,129,0.15), 0 0 24px rgba(16,185,129,0.1);
  }

  /* --- QR Code container --- */
  .qr-wrap {
    display: flex; flex-direction: column; align-items: center;
    margin-bottom: 1.25rem;
  }
  .qr-box {
    background: #fff;
    border-radius: 16px;
    padding: 1rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    margin-bottom: 0.75rem;
  }
  .qr-box img { display: block; width: 180px; height: 180px; }

  .secret-box {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(16,185,129,0.2);
    border-radius: 10px;
    padding: 0.5rem 0.9rem;
    display: flex; align-items: center; gap: 0.6rem;
    width: 100%;
  }
  .secret-key {
    flex: 1;
    font-family: 'Courier New', monospace;
    font-size: 0.78rem;
    color: #6ee7b7;
    word-break: break-all;
    letter-spacing: 0.04em;
  }

  /* --- Steps bar --- */
  .steps {
    display: flex; align-items: center; justify-content: center;
    gap: 0.5rem; margin-bottom: 1.5rem;
  }
  .step-dot {
    width: 28px; height: 28px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.72rem; font-weight: 700;
    border: 1.5px solid #334155;
    color: #475569;
    background: rgba(30,41,59,0.5);
    transition: all 0.3s;
  }
  .step-dot.active { background: #6366f1; border-color: #6366f1; color: #fff; box-shadow: 0 0 12px rgba(99,102,241,0.4); }
  .step-dot.done   { background: #10b981; border-color: #10b981; color: #fff; }
  .step-line { height: 1.5px; width: 32px; background: #1e293b; }

  /* Progress hint */
  .digits-hint { font-size: 0.7rem; color: var(--text-dim); text-align: center; margin-top: 0.4rem; height: 1rem; }

  /* Security badge row */
  .security-row {
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    margin-top: 1.25rem;
    color: var(--text-dim); font-size: 0.7rem;
  }
  .security-dot { width: 5px; height: 5px; border-radius: 50%; background: #10b981; flex-shrink: 0; }
</style>
"""

_GOOGLE_ICON = """<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
</svg>"""

_EYE_ICON = """<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
</svg>"""

_EYE_OFF_ICON = """<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>"""

_TOGGLE_PW_SCRIPT = """
<script>
  function togglePw(inputId, iconId) {
    const inp = document.getElementById(inputId);
    const ico = document.getElementById(iconId);
    if (inp.type === 'password') {
      inp.type = 'text';
      ico.innerHTML = `""" + _EYE_OFF_ICON.replace("`", "\\`") + """`;
    } else {
      inp.type = 'password';
      ico.innerHTML = `""" + _EYE_ICON.replace("`", "\\`") + """`;
    }
  }
</script>
"""


# ---------------------------------------------------------------------------
# Helper: validate redirect_uri against registered client URIs
# ---------------------------------------------------------------------------
def _validate_redirect_uri(client: ClientApp, redirect_uri: str) -> bool:
    """Return True if redirect_uri is in the client's registered list."""
    if not client or not redirect_uri:
        return False
    valid_uris = [uri.strip() for uri in client.redirect_uris.split(",") if uri.strip()]
    return redirect_uri in valid_uris


# ---------------------------------------------------------------------------
# Helper: decide where to send 2FA step-up pages
# Returns the base URL prefix (empty string = auth_server itself)
# ---------------------------------------------------------------------------
def _2fa_base_url(client_id: str, redirect_uri: str) -> str:
    mgmt = settings.MANAGEMENT_URL.rstrip("/")
    if client_id == "auth_management_app" or (redirect_uri and mgmt in redirect_uri):
        return mgmt
    return ""  # serve from auth_server's own pages


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


# ===========================================================================
# Signup Page & Submit
# ===========================================================================

@router.get("/signup")
def signup_page(redirect_uri: str = None, db: Session = Depends(get_db)):
    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    google_enabled = g_setting.is_enabled if g_setting else False
    redirect_uri_enc = urllib.parse.quote(redirect_uri or "")

    google_btn = ""
    if google_enabled:
        google_btn = f"""
        <div class="divider">or continue with</div>
        <a href="/auth/google?redirect_uri={redirect_uri_enc}" class="btn-google">
          {_GOOGLE_ICON} Sign up with Google
        </a>"""

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <title>IAM — Create Account</title>
  {_SSO_HEAD}
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <!-- Logo -->
      <div class="logo-wrap">
        <div class="logo-icon">IAM</div>
        <h1 class="logo-title">Create your account</h1>
        <p class="logo-subtitle">Central Identity &amp; Access Management</p>
      </div>

      <form action="/signup-submit" method="POST" autocomplete="off" novalidate>
        <input type="hidden" name="redirect_uri" value="{redirect_uri or ''}">

        <div class="field">
          <label class="field-label" for="s-name">Full Name</label>
          <input id="s-name" class="field-input" type="text" name="name" required placeholder="Jane Smith" autocomplete="name">
        </div>

        <div class="field">
          <label class="field-label" for="s-email">Email Address</label>
          <input id="s-email" class="field-input" type="email" name="email" required placeholder="you@company.com" autocomplete="email">
        </div>

        <div class="field">
          <label class="field-label" for="s-pwd">Password</label>
          <div class="input-wrap">
            <input id="s-pwd" class="field-input has-icon" type="password" name="password" required minlength="6" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="input-icon-btn" onclick="togglePw('s-pwd','eye-s')" aria-label="Toggle password">
              <span id="eye-s">{_EYE_ICON}</span>
            </button>
          </div>
        </div>

        <button type="submit" class="btn-primary">Create Account →</button>
      </form>

      {google_btn}

      <div class="footer-links">
        <span style="color:var(--text-dim);font-size:0.78rem;">Already registered?</span>
        <a href="/authorize" class="link">Sign in →</a>
      </div>
    </div>

    <div class="security-row">
      <span class="security-dot"></span>
      Secured by IAM Central Auth
    </div>
  </div>

  {_TOGGLE_PW_SCRIPT}
</body>
</html>"""
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

    target_redirect = redirect_uri if redirect_uri.strip() else settings.SUCCESSFUL_SIGNUP_REDIRECT_URL
    return RedirectResponse(url=target_redirect, status_code=303)


# ===========================================================================
# Authorization Endpoint — The main SSO Login Page
# ===========================================================================

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
    # Default to management app if no client specified (direct portal access)
    if not client_id:
        client_id = "test_client_id_1"
        redirect_uri = settings.CENTRAL_DASHBOARD_URL

    client = db.query(ClientApp).filter(ClientApp.client_id == client_id).first()

    # Validate redirect_uri for known clients
    if client and redirect_uri:
        if not _validate_redirect_uri(client, redirect_uri):
            return HTMLResponse(
                content=_error_page("Invalid redirect_uri",
                    f"The redirect URI <code>{redirect_uri}</code> is not registered for this client application."),
                status_code=400
            )

    client_name = client.client_name if client else "IAM Central Auth"

    # --- SSO session check: skip login if already authenticated ---
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

    redirect_uri_enc = urllib.parse.quote(redirect_uri or "")
    signup_href = f"/signup?redirect_uri={redirect_uri_enc}"
    google_href = (
        f"/auth/google?client_id={client_id}&redirect_uri={redirect_uri_enc}&state={urllib.parse.quote(state or '')}"
        if google_enabled else ""
    )

    google_btn = ""
    if google_enabled:
        google_btn = f"""
        <div class="divider">or</div>
        <a href="{google_href}" class="btn-google" id="btn-google">
          {_GOOGLE_ICON} Continue with Google
        </a>"""

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <title>Sign in — IAM</title>
  {_SSO_HEAD}
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <!-- Logo -->
      <div class="logo-wrap">
        <div class="logo-icon">IAM</div>
        <h1 class="logo-title">Welcome back</h1>
        <p class="logo-subtitle">Sign in to continue to</p>
        <span class="client-badge">{client_name}</span>
      </div>

      <form id="login-form" action="/login-submit" method="POST" autocomplete="on" novalidate>
        <input type="hidden" name="client_id"    value="{client_id}">
        <input type="hidden" name="redirect_uri" value="{redirect_uri or ''}">
        <input type="hidden" name="state"        value="{state or ''}">

        <div class="field">
          <label class="field-label" for="l-email">Email address</label>
          <input id="l-email" class="field-input" type="email" name="email" required
                 placeholder="you@company.com" autocomplete="email" autofocus>
        </div>

        <div class="field">
          <label class="field-label" for="l-pwd">Password</label>
          <div class="input-wrap">
            <input id="l-pwd" class="field-input has-icon" type="password" name="password" required
                   placeholder="••••••••" autocomplete="current-password">
            <button type="button" class="input-icon-btn" onclick="togglePw('l-pwd','eye-l')" aria-label="Toggle password">
              <span id="eye-l">{_EYE_ICON}</span>
            </button>
          </div>
        </div>

        <button type="submit" class="btn-primary" id="btn-signin">Sign in</button>
      </form>

      {google_btn}

      <div class="footer-links">
        <a href="{signup_href}" class="link">Create account →</a>
        <a href="{settings.MANAGEMENT_URL}" class="link-muted">IAM Portal</a>
      </div>
    </div>

    <div class="security-row">
      <span class="security-dot"></span>
      256-bit encrypted · Secured by IAM
    </div>
  </div>

  {_TOGGLE_PW_SCRIPT}
</body>
</html>"""
    return HTMLResponse(content=html_content)


# ===========================================================================
# Google OAuth — Initiate & Callback
# ===========================================================================

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

        userinfo_res = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"}
        )
        if userinfo_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch Google user info")
        google_user = userinfo_res.json()

    google_email   = google_user.get("email")
    google_name    = google_user.get("name")
    google_picture = google_user.get("picture")

    if not google_email:
        raise HTTPException(status_code=400, detail="Google account email not provided")

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

    state_parts = state.split("|") if state else []
    client_id    = state_parts[0] if len(state_parts) > 0 and state_parts[0] else "test_client_id_1"
    redirect_uri = state_parts[1] if len(state_parts) > 1 and state_parts[1] else settings.CENTRAL_DASHBOARD_URL
    app_state    = state_parts[2] if len(state_parts) > 2 else ""

    # 2FA step-up check
    enforce_2fa = g_setting.enforce_2fa_all if g_setting else False
    if user.is_2fa_enabled or enforce_2fa:
        base = _2fa_base_url(client_id, redirect_uri)
        redirect_uri_enc = urllib.parse.quote(redirect_uri)
        if not user.totp_secret:
            return RedirectResponse(
                f"{base}/2fa-setup-page?user_id={user.id}&client_id={client_id}&redirect_uri={redirect_uri_enc}&state={app_state}"
            )
        else:
            return RedirectResponse(
                f"{base}/2fa-verify-page?user_id={user.id}&client_id={client_id}&redirect_uri={redirect_uri_enc}&state={app_state}"
            )

    sso_session_id = str(uuid.uuid4())
    set_cache(f"sso_session:{sso_session_id}", {"user_id": user.id, "email": user.email}, ttl=86400)

    auth_code = str(uuid.uuid4())
    set_cache(f"auth_code:{auth_code}", {
        "user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri
    }, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if app_state:
        target_url += f"&state={app_state}"

    resp = RedirectResponse(target_url, status_code=303)
    resp.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return resp


# ===========================================================================
# 2FA — Setup Page (served by auth_server for non-management OIDC clients)
# ===========================================================================

@router.get("/2fa-setup-page")
def two_fa_setup_page(user_id: str, client_id: str, redirect_uri: str, state: str = "", db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.totp_secret:
        user.totp_secret = generate_totp_secret()
        db.commit()

    totp_uri    = get_totp_uri(user.totp_secret, user.email)
    qr_code_uri = generate_qr_code_data_uri(totp_uri)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <title>Set Up 2FA — IAM</title>
  {_SSO_HEAD}
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-wrap">
        <div class="logo-icon" style="background:linear-gradient(135deg,#f59e0b,#10b981)">🔐</div>
        <h1 class="logo-title">Set Up Two-Factor Auth</h1>
        <p class="logo-subtitle">Your account requires 2FA. Scan the QR code below.</p>
      </div>

      <!-- Steps -->
      <div class="steps">
        <div class="step-dot active">1</div>
        <div class="step-line"></div>
        <div class="step-dot" id="step2">2</div>
        <div class="step-line"></div>
        <div class="step-dot" id="step3">3</div>
      </div>

      <!-- QR Code -->
      <div class="qr-wrap">
        <div class="qr-box">
          <img src="{qr_code_uri}" alt="2FA QR Code">
        </div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.6rem;">
          Scan with <strong style="color:#a5b4fc">Google Authenticator</strong> or <strong style="color:#a5b4fc">Authy</strong>
        </p>
        <div class="secret-box">
          <span class="secret-key" id="secret-key">{user.totp_secret}</span>
          <button type="button" onclick="copySecret()" id="copy-btn"
                  style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);color:#6ee7b7;
                         border-radius:8px;padding:0.25rem 0.6rem;font-size:0.7rem;cursor:pointer;font-weight:600;
                         transition:background 0.15s;white-space:nowrap;">
            Copy
          </button>
        </div>
        <p style="font-size:0.68rem;color:var(--text-dim);margin-top:0.4rem;">Can't scan? Enter the secret key manually.</p>
      </div>

      <form action="/2fa-stepup-submit" method="POST">
        <input type="hidden" name="user_id"      value="{user_id}">
        <input type="hidden" name="client_id"    value="{client_id}">
        <input type="hidden" name="redirect_uri" value="{redirect_uri}">
        <input type="hidden" name="state"        value="{state}">
        <input type="hidden" name="is_setup"     value="true">

        <div class="field">
          <label class="field-label">Enter 6-digit code from your app</label>
          <input class="otp-input" type="text" name="totp_code" id="otp-inp"
                 required maxlength="6" inputmode="numeric" pattern="[0-9]*"
                 placeholder="· · · · · ·" autocomplete="one-time-code" autofocus
                 oninput="onOtpInput(this)">
          <div class="digits-hint" id="hint"></div>
        </div>

        <button type="submit" class="btn-primary" id="btn-verify">Verify &amp; Activate 2FA</button>
      </form>

      <div style="margin-top:1.25rem;text-align:center;">
        <a href="/authorize?client_id={client_id}&redirect_uri={urllib.parse.quote(redirect_uri)}&state={state}"
           style="font-size:0.78rem;color:var(--text-dim);text-decoration:none;" onmouseover="this.style.color='#94a3b8'" onmouseout="this.style.color='var(--text-dim)'">
          ← Back to sign in
        </a>
      </div>
    </div>

    <div class="security-row">
      <span class="security-dot"></span>
      TOTP-based two-factor authentication
    </div>
  </div>

  <script>
    function copySecret() {{
      const key = document.getElementById('secret-key').textContent.trim();
      navigator.clipboard.writeText(key).then(() => {{
        const btn = document.getElementById('copy-btn');
        btn.textContent = '✓ Copied';
        setTimeout(() => btn.textContent = 'Copy', 2000);
      }});
    }}

    function onOtpInput(el) {{
      const val = el.value.replace(/\\D/g, '');
      el.value = val;
      const rem = 6 - val.length;
      const hint = document.getElementById('hint');
      hint.textContent = rem > 0 ? rem + ' digit' + (rem !== 1 ? 's' : '') + ' remaining' : '';
      if (val.length > 0) document.getElementById('step2').classList.add('active');
      if (val.length === 6) document.getElementById('step2').classList.replace('active', 'done');
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)


# ===========================================================================
# 2FA — Verify Page (served by auth_server for non-management OIDC clients)
# ===========================================================================

@router.get("/2fa-verify-page")
def two_fa_verify_page(user_id: str, client_id: str, redirect_uri: str, state: str = "", db: Session = Depends(get_db)):
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <title>2FA Verification — IAM</title>
  {_SSO_HEAD}
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-wrap">
        <div class="logo-icon" style="background:linear-gradient(135deg,#f59e0b,#ef4444)">🛡️</div>
        <h1 class="logo-title">Two-Factor Verification</h1>
        <p class="logo-subtitle">Enter the code from your authenticator app to continue.</p>
      </div>

      <div class="banner-info">
        <span>📱</span>
        Open <strong>Google Authenticator</strong> or <strong>Authy</strong> and enter the current 6-digit code shown for <em>IAM Auth Server</em>.
      </div>

      <form action="/2fa-stepup-submit" method="POST">
        <input type="hidden" name="user_id"      value="{user_id}">
        <input type="hidden" name="client_id"    value="{client_id}">
        <input type="hidden" name="redirect_uri" value="{redirect_uri}">
        <input type="hidden" name="state"        value="{state}">
        <input type="hidden" name="is_setup"     value="false">

        <div class="field">
          <label class="field-label">Authentication Code</label>
          <input class="otp-input" type="text" name="totp_code" id="otp-inp"
                 required maxlength="6" inputmode="numeric" pattern="[0-9]*"
                 placeholder="· · · · · ·" autocomplete="one-time-code" autofocus
                 oninput="onOtpInput(this)">
          <div class="digits-hint" id="hint"></div>
        </div>

        <button type="submit" class="btn-primary" id="btn-verify">Verify &amp; Sign In</button>
      </form>

      <div style="margin-top:1.25rem;text-align:center;">
        <a href="/authorize?client_id={client_id}&redirect_uri={urllib.parse.quote(redirect_uri)}&state={state}"
           style="font-size:0.78rem;color:var(--text-dim);text-decoration:none;" onmouseover="this.style.color='#94a3b8'" onmouseout="this.style.color='var(--text-dim)'">
          ← Back to sign in
        </a>
      </div>
    </div>

    <div class="security-row">
      <span class="security-dot"></span>
      TOTP-based two-factor authentication
    </div>
  </div>

  <script>
    function onOtpInput(el) {{
      const val = el.value.replace(/\\D/g, '');
      el.value = val;
      const rem = 6 - val.length;
      document.getElementById('hint').textContent = rem > 0 ? rem + ' digit' + (rem !== 1 ? 's' : '') + ' remaining' : '';
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)


# ===========================================================================
# 2FA Step-Up Submit (handles both setup completion and verification)
# ===========================================================================

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
    set_cache(f"auth_code:{auth_code}", {
        "user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri
    }, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if state:
        target_url += f"&state={state}"

    resp = RedirectResponse(target_url, status_code=303)
    resp.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return resp


# ===========================================================================
# Login Submit (Local Credentials)
# ===========================================================================

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
        # Return to login page with error banner
        return HTMLResponse(
            content=_login_error_page(client_id, redirect_uri, state, "Invalid email or password. Please try again."),
            status_code=401
        )

    if not user.is_active:
        return HTMLResponse(
            content=_login_error_page(client_id, redirect_uri, state, "Your account has been disabled. Please contact support."),
            status_code=403
        )

    g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
    enforce_2fa = g_setting.enforce_2fa_all if g_setting else False

    if user.is_2fa_enabled or enforce_2fa:
        base = _2fa_base_url(client_id, redirect_uri)
        redirect_uri_enc = urllib.parse.quote(redirect_uri)
        if not user.totp_secret:
            return RedirectResponse(
                f"{base}/2fa-setup-page?user_id={user.id}&client_id={client_id}&redirect_uri={redirect_uri_enc}&state={state}",
                status_code=303
            )
        else:
            return RedirectResponse(
                f"{base}/2fa-verify-page?user_id={user.id}&client_id={client_id}&redirect_uri={redirect_uri_enc}&state={state}",
                status_code=303
            )

    sso_session_id = str(uuid.uuid4())
    set_cache(f"sso_session:{sso_session_id}", {"user_id": user.id, "email": user.email}, ttl=86400)

    auth_code = str(uuid.uuid4())
    set_cache(f"auth_code:{auth_code}", {
        "user_id": user.id, "client_id": client_id, "redirect_uri": redirect_uri
    }, ttl=600)

    target_url = f"{redirect_uri}?code={auth_code}"
    if state:
        target_url += f"&state={state}"

    resp = RedirectResponse(target_url, status_code=303)
    resp.set_cookie(key="sso_session", value=sso_session_id, httponly=True, max_age=86400)
    return resp


# ===========================================================================
# OIDC Token & Userinfo Endpoints
# ===========================================================================

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

    user_role  = user.role or ("admin" if user.is_admin else "normal-user")
    id_token   = create_id_token(user.id, user.email, user.name, client_id, user.picture, role=user_role, is_admin=user.is_admin)
    access_tok = create_access_token(user.id, client_id, role=user_role, is_admin=user.is_admin)

    return {
        "access_token": access_tok,
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
        "sub":       user.id,
        "email":     user.email,
        "name":      user.name or user.email,
        "picture":   user.picture or "",
        "provider":  user.provider,
        "role":      user_role,
        "roles":     [user_role],
        "is_admin":  user.is_admin
    }


@router.get("/logout")
def logout(request: Request, post_logout_redirect_uri: str = None):
    sso_session_id = request.cookies.get("sso_session")
    if sso_session_id:
        delete_cache(f"sso_session:{sso_session_id}")

    redirect_target = post_logout_redirect_uri or settings.LOGOUT_REDIRECT_URL or settings.AUTH_SERVER_URL
    resp = RedirectResponse(redirect_target)
    resp.delete_cookie("sso_session")
    return resp


# ===========================================================================
# Internal helpers — error HTML pages
# ===========================================================================

def _error_page(title: str, message: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <title>Error — IAM</title>
  {_SSO_HEAD}
</head>
<body>
  <div class="wrapper">
    <div class="card" style="text-align:center;">
      <div class="logo-wrap">
        <div class="logo-icon" style="background:linear-gradient(135deg,#ef4444,#f59e0b)">⚠️</div>
        <h1 class="logo-title" style="background:linear-gradient(135deg,#fb7185,#fbbf24) -webkit-background-clip:text">{title}</h1>
      </div>
      <div class="banner-error"><span>⛔</span>{message}</div>
      <a href="/authorize" class="btn-primary" style="display:block;text-align:center;text-decoration:none;padding:0.85rem;">← Return to Sign In</a>
    </div>
  </div>
</body>
</html>"""


def _login_error_page(client_id: str, redirect_uri: str, state: str, error_msg: str) -> str:
    """Re-render the login page with an error banner (avoids plain 401 error page)."""
    redirect_uri_enc = urllib.parse.quote(redirect_uri or "")
    signup_href = f"/signup?redirect_uri={redirect_uri_enc}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <title>Sign in — IAM</title>
  {_SSO_HEAD}
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-wrap">
        <div class="logo-icon">IAM</div>
        <h1 class="logo-title">Welcome back</h1>
        <p class="logo-subtitle">Sign in to continue</p>
      </div>

      <div class="banner-error"><span>⚠️</span>{error_msg}</div>

      <form action="/login-submit" method="POST" autocomplete="on" novalidate>
        <input type="hidden" name="client_id"    value="{client_id}">
        <input type="hidden" name="redirect_uri" value="{redirect_uri or ''}">
        <input type="hidden" name="state"        value="{state or ''}">

        <div class="field">
          <label class="field-label" for="l-email">Email address</label>
          <input id="l-email" class="field-input" type="email" name="email" required
                 placeholder="you@company.com" autocomplete="email" autofocus>
        </div>

        <div class="field">
          <label class="field-label" for="l-pwd">Password</label>
          <div class="input-wrap">
            <input id="l-pwd" class="field-input has-icon" type="password" name="password" required
                   placeholder="••••••••" autocomplete="current-password">
            <button type="button" class="input-icon-btn" onclick="togglePw('l-pwd','eye-l')" aria-label="Toggle password">
              <span id="eye-l">{_EYE_ICON}</span>
            </button>
          </div>
        </div>

        <button type="submit" class="btn-primary">Sign in</button>
      </form>

      <div class="footer-links">
        <a href="{signup_href}" class="link">Create account →</a>
        <a href="{settings.MANAGEMENT_URL}" class="link-muted">IAM Portal</a>
      </div>
    </div>
    <div class="security-row">
      <span class="security-dot"></span>
      256-bit encrypted · Secured by IAM
    </div>
  </div>
  {_TOGGLE_PW_SCRIPT}
</body>
</html>"""
