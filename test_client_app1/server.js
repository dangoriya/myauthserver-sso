const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:8000';
const CLIENT_ID       = process.env.CLIENT_ID       || 'test_client_id_1';
const CLIENT_SECRET   = process.env.CLIENT_SECRET   || 'test_client_secret_1';
const REDIRECT_URI    = process.env.REDIRECT_URI    || 'http://localhost:3001/callback';

// ---------------------------------------------------------------------------
// Inline CSS — dark premium design
// ---------------------------------------------------------------------------
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #070d18;
    --card: rgba(12,20,38,0.92);
    --border: rgba(99,102,241,0.18);
    --accent: #6366f1;
    --green: #10b981;
    --red: #ef4444;
    --text: #f1f5f9;
    --muted: #94a3b8;
    --dim: #475569;
    --font: 'Inter', system-ui, sans-serif;
  }
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  html, body {
    min-height: 100vh;
    background:
      radial-gradient(ellipse 70% 55% at 15% -5%, rgba(99,102,241,0.15) 0%, transparent 55%),
      radial-gradient(ellipse 55% 45% at 85% 105%, rgba(16,185,129,0.1) 0%, transparent 50%),
      var(--bg);
    color: var(--text);
    font-family: var(--font);
    -webkit-font-smoothing: antialiased;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
  .wrapper { width: 100%; max-width: 480px; }
  .card {
    background: var(--card);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 2.25rem 2rem;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.03) inset,
      0 24px 60px -12px rgba(0,0,0,0.55),
      0 0 60px -20px rgba(99,102,241,0.12);
    animation: cardIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes cardIn {
    from { opacity:0; transform: translateY(18px) scale(0.97); }
    to   { opacity:1; transform: translateY(0) scale(1); }
  }
  /* Header */
  .app-header { text-align: center; margin-bottom: 2rem; }
  .app-logo {
    width: 60px; height: 60px; border-radius: 18px;
    background: linear-gradient(135deg, #6366f1, #10b981);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.6rem; margin: 0 auto 1rem;
    box-shadow: 0 8px 28px rgba(99,102,241,0.35);
  }
  .app-title {
    font-size: 1.45rem; font-weight: 700; letter-spacing: -0.4px;
    background: linear-gradient(135deg, #a5b4fc 0%, #e0f2fe 50%, #6ee7b7 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    margin-bottom: 0.3rem;
  }
  .app-sub { font-size: 0.82rem; color: var(--muted); }
  /* Profile card */
  .profile-grid {
    background: rgba(8,14,26,0.7);
    border: 1px solid rgba(30,41,59,0.8);
    border-radius: 16px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.9rem 1.25rem;
  }
  .profile-item {}
  .profile-label { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--dim); margin-bottom: 0.2rem; }
  .profile-value { font-size: 0.88rem; color: var(--text); word-break: break-all; }
  .profile-item.full { grid-column: 1 / -1; }
  /* Badges */
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 0.18rem 0.6rem;
    border-radius: 100px; font-size: 0.72rem; font-weight: 600;
  }
  .badge-green { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #6ee7b7; }
  .badge-indigo { background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3); color: #a5b4fc; }
  .badge-amber  { background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.3); color: #fcd34d; }
  .badge-rose   { background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.3); color: #fb7185; }
  /* Success icon */
  .success-icon {
    width: 64px; height: 64px; border-radius: 50%;
    background: rgba(16,185,129,0.1);
    border: 2px solid rgba(16,185,129,0.25);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.8rem; margin: 0 auto 1rem;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.2); }
    50%      { box-shadow: 0 0 0 12px rgba(16,185,129,0); }
  }
  /* Buttons */
  .btn {
    display: block; width: 100%; padding: 0.9rem 1.5rem;
    border: none; border-radius: 14px; cursor: pointer;
    font-family: var(--font); font-size: 0.92rem; font-weight: 600;
    text-align: center; text-decoration: none;
    transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
  }
  .btn-primary {
    background: linear-gradient(135deg, #6366f1, #4f46e5 50%, #7c3aed);
    color: #fff;
    box-shadow: 0 4px 20px rgba(99,102,241,0.35);
  }
  .btn-primary:hover { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 6px 28px rgba(99,102,241,0.45); }
  .btn-danger {
    background: rgba(244,63,94,0.1);
    border: 1px solid rgba(244,63,94,0.3);
    color: #fb7185;
  }
  .btn-danger:hover { background: rgba(244,63,94,0.18); transform: translateY(-1px); }
  /* Error banner */
  .banner-error {
    padding: 0.8rem 1rem; border-radius: 12px; margin-bottom: 1.25rem;
    background: rgba(244,63,94,0.08); border: 1px solid rgba(244,63,94,0.3);
    color: #fb7185; font-size: 0.82rem; display: flex; gap: 0.5rem; align-items: flex-start;
  }
  /* Footer */
  .footer { text-align: center; margin-top: 1.25rem; font-size: 0.72rem; color: var(--dim); }
  .footer a { color: var(--dim); text-decoration: none; }
  .footer a:hover { color: var(--muted); }
  hr { border: none; border-top: 1px solid rgba(30,41,59,0.7); margin: 1.25rem 0; }
  /* Token info */
  .token-summary {
    background: rgba(8,14,26,0.5); border: 1px solid rgba(30,41,59,0.6);
    border-radius: 12px; padding: 0.9rem 1rem; margin-bottom: 1.25rem;
  }
  .token-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; margin-bottom: 0.35rem; }
  .token-row:last-child { margin-bottom: 0; }
  .token-key { color: var(--dim); font-weight: 500; }
  .token-val { color: var(--text); font-weight: 500; text-align: right; }
`;

// ---------------------------------------------------------------------------
// Helper: parse JWT payload without verification (for display)
// ---------------------------------------------------------------------------
function parseJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// GET / — landing or authenticated profile
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const user = req.cookies.app_user ? (() => { try { return JSON.parse(req.cookies.app_user); } catch { return null; } })() : null;
  const errMsg = req.query.error || '';

  if (user) {
    // Determine role badge colour
    const roleBadge = user.is_admin || user.role === 'admin'
      ? '<span class="badge badge-amber">👑 Admin</span>'
      : user.role === 'normal-user'
        ? '<span class="badge badge-indigo">👤 User</span>'
        : `<span class="badge badge-indigo">${user.role || 'user'}</span>`;

    const providerBadge = user.provider === 'google'
      ? '<span class="badge badge-rose">🔵 Google</span>'
      : '<span class="badge badge-green">🏠 Local</span>';

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test App 1 — Authenticated</title>
  <style>${CSS}</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="app-header">
      <div class="success-icon">✓</div>
      <h1 class="app-title">Authenticated via SSO</h1>
      <p class="app-sub">Successfully signed in through IAM Central Auth</p>
    </div>

    <div class="profile-grid">
      <div class="profile-item full">
        <div class="profile-label">Subject ID</div>
        <div class="profile-value" style="font-family:monospace;font-size:0.78rem;color:#94a3b8;">${user.sub || user.id || '—'}</div>
      </div>
      <div class="profile-item">
        <div class="profile-label">Email</div>
        <div class="profile-value">${user.email || '—'}</div>
      </div>
      <div class="profile-item">
        <div class="profile-label">Name</div>
        <div class="profile-value">${user.name || '—'}</div>
      </div>
      <div class="profile-item">
        <div class="profile-label">Role</div>
        <div class="profile-value">${roleBadge}</div>
      </div>
      <div class="profile-item">
        <div class="profile-label">Identity Provider</div>
        <div class="profile-value">${providerBadge}</div>
      </div>
    </div>

    <div class="token-summary">
      <div class="token-row">
        <span class="token-key">SSO Status</span>
        <span class="token-val"><span class="badge badge-green">● Active Session</span></span>
      </div>
      <div class="token-row">
        <span class="token-key">Auth Method</span>
        <span class="token-val">OIDC Authorization Code Flow</span>
      </div>
      <div class="token-row">
        <span class="token-key">Token Type</span>
        <span class="token-val">RS256 JWT</span>
      </div>
    </div>

    <a href="/logout" class="btn btn-danger">Sign Out (Single Logout)</a>
  </div>

  <div class="footer">
    <p>Test Client App 1 · <a href="${AUTH_SERVER_URL}">IAM Auth Server</a></p>
  </div>
</div>
</body>
</html>`);
  } else {
    const errorBanner = errMsg
      ? `<div class="banner-error"><span>⚠️</span><span>${decodeURIComponent(errMsg)}</span></div>`
      : '';

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test App 1 — Login</title>
  <style>${CSS}</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="app-header">
      <div class="app-logo">🚀</div>
      <h1 class="app-title">Test Application 1</h1>
      <p class="app-sub">Demonstrating OIDC Single Sign-On via IAM Central Auth</p>
    </div>

    ${errorBanner}

    <div class="token-summary" style="margin-bottom:1.5rem;">
      <div class="token-row">
        <span class="token-key">Protocol</span>
        <span class="token-val">OpenID Connect 1.0</span>
      </div>
      <div class="token-row">
        <span class="token-key">Flow</span>
        <span class="token-val">Authorization Code</span>
      </div>
      <div class="token-row">
        <span class="token-key">Identity Provider</span>
        <span class="token-val">IAM Central Auth</span>
      </div>
    </div>

    <a href="/login" class="btn btn-primary">Continue with IAM Login →</a>
  </div>

  <div class="footer">
    <p style="margin-bottom:0.4rem;">Clicking the button will redirect you to the IAM Auth Server login page.</p>
    <p>Test Client App 1 · <a href="${AUTH_SERVER_URL}">IAM Auth Server</a></p>
  </div>
</div>
</body>
</html>`);
  }
});

// ---------------------------------------------------------------------------
// GET /login — Step 1: redirect to IAM auth server with CSRF state
// ---------------------------------------------------------------------------
app.get('/login', (req, res) => {
  // Generate a random state value for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  // Store state in a short-lived cookie
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 5 * 60 * 1000 });

  const authUrl =
    `${AUTH_SERVER_URL}/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('openid profile email')}` +
    `&state=${state}`;

  res.redirect(authUrl);
});

// ---------------------------------------------------------------------------
// GET /callback — Step 2: exchange code for tokens
// ---------------------------------------------------------------------------
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Handle auth server errors
  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect('/?error=Authorization+code+missing');
  }

  // CSRF state validation
  const savedState = req.cookies.oauth_state;
  if (state && savedState && state !== savedState) {
    return res.redirect('/?error=Invalid+state+parameter+(possible+CSRF+attack)');
  }

  // Clear state cookie
  res.clearCookie('oauth_state');

  try {
    // Exchange authorization code for tokens
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const tokenRes = await axios.post(`${AUTH_SERVER_URL}/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, id_token } = tokenRes.data;

    // Fetch user profile from /userinfo
    const userRes = await axios.get(`${AUTH_SERVER_URL}/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const profile = userRes.data;

    // Also parse id_token for extra claims (role, is_admin)
    const idPayload = id_token ? parseJwtPayload(id_token) : {};

    const userObj = {
      sub:      profile.sub || idPayload.sub,
      email:    profile.email || idPayload.email,
      name:     profile.name  || idPayload.name,
      role:     profile.role  || idPayload.role || 'normal-user',
      is_admin: profile.is_admin || idPayload.is_admin || false,
      provider: profile.provider || idPayload.provider || 'local',
      picture:  profile.picture || idPayload.picture || '',
    };

    res.cookie('app_session', access_token, { httpOnly: true, maxAge: 3600 * 1000 });
    res.cookie('app_user', JSON.stringify(userObj), { httpOnly: true, maxAge: 3600 * 1000 });
    res.redirect('/');
  } catch (err) {
    console.error('Code exchange error:', err.response?.data || err.message);
    const detail = err.response?.data?.detail || 'Authentication failed. Please try again.';
    res.redirect(`/?error=${encodeURIComponent(detail)}`);
  }
});

// ---------------------------------------------------------------------------
// GET /logout — Step 3: clear session and trigger IAM Single Logout
// ---------------------------------------------------------------------------
app.get('/logout', (req, res) => {
  res.clearCookie('app_session');
  res.clearCookie('app_user');
  res.clearCookie('oauth_state');
  const postLogoutUri = encodeURIComponent('http://localhost:3001');
  res.redirect(`${AUTH_SERVER_URL}/logout?post_logout_redirect_uri=${postLogoutUri}`);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Test Client App 1] Running on http://localhost:${PORT}`);
  console.log(`[Test Client App 1] Auth Server: ${AUTH_SERVER_URL}`);
  console.log(`[Test Client App 1] Client ID:   ${CLIENT_ID}`);
  console.log(`[Test Client App 1] Redirect URI: ${REDIRECT_URI}`);
});
