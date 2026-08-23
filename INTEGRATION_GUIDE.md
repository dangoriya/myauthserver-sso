# IAM Central Auth Server — Developer Integration Guide

> **Auth Server base URL:** `http://localhost:8000`  
> **Management Portal:** `http://localhost:3005`  
> **Protocol:** OpenID Connect 1.0 (Authorization Code Flow)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How SSO Works — The Complete Flow](#2-how-sso-works)
3. [Registering a Client Application](#3-registering-a-client-application)
4. [OIDC Endpoints Reference](#4-oidc-endpoints-reference)
5. [Integration — Step-by-Step](#5-integration-step-by-step)
6. [Token Structure & Claims](#6-token-structure--claims)
7. [Two-Factor Authentication (2FA/OTP)](#7-two-factor-authentication-2faotp)
8. [Google OAuth Integration](#8-google-oauth-integration)
9. [Single Sign-On (SSO) Session](#9-single-sign-on-sso-session)
10. [Single Logout (SLO)](#10-single-logout-slo)
11. [Environment Configuration](#11-environment-configuration)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Architecture Overview

```
+------------------------------------------------------------------+
|                          Your System                             |
|                                                                  |
|  +------------------+     +-------------------------+           |
|  |  Client App(s)   |     |  Auth Server Mgmt       |           |
|  |  (port 3001+)    |     |  (port 3005)            |           |
|  |                  |     |  * Admin portal          |           |
|  |  Any web app     |     |  * User management       |           |
|  |  that needs      |     |  * Client app config     |           |
|  |  authentication  |     |  * Google settings       |           |
|  +--------+---------+     +-------------------------+           |
|           |  OIDC redirect                                       |
|           v                                                      |
|  +----------------------------------------------------------+   |
|  |         IAM Central Auth Server (port 8000)              |   |
|  |                                                          |   |
|  |  /authorize   - SSO login page (your SSO portal)        |   |
|  |  /token       - Token exchange endpoint                  |   |
|  |  /userinfo    - User profile & roles                     |   |
|  |  /logout      - Single Logout                            |   |
|  |  /jwks.json   - Public keys for JWT verification         |   |
|  |  /auth/google - Google OAuth2 initiation                 |   |
|  |                                                          |   |
|  |  Identity Sources:                                       |   |
|  |    1. Local accounts (email + password)                  |   |
|  |    2. Google OAuth2 (if configured)                      |   |
|  |    3. Optional: TOTP-based 2FA                           |   |
|  +----------------------------------------------------------+   |
|           |                                                      |
|  +------------------------------------------------------------+  |
|  |  PostgreSQL (users, roles, client apps, settings)         |  |
|  |  Redis       (SSO sessions, auth codes, OTP cache)        |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

---

## 2. How SSO Works

### Standard OIDC Authorization Code Flow

```
User Browser         Client App          IAM Auth Server       Google (optional)
     |                    |                     |                     |
     | Visit /dashboard   |                     |                     |
     |------------------->|                     |                     |
     |                    | Not authenticated   |                     |
     |                    | Redirect to         |                     |
     |<-------------------| /authorize?...      |                     |
     |                                          |                     |
     | GET /authorize?client_id=...             |                     |
     |----------------------------------------->                     |
     |                                          | Show SSO login page |
     |<-----------------------------------------|                     |
     |                                          |                     |
     | User enters email + password             |                     |
     | (or clicks "Continue with Google")       |                     |
     |----------------------------------------->                     |
     |                                          | [if Google]         |
     |                                          |-------------------->|
     |                                          |  Google OAuth       |
     |                                          |<--------------------|
     |                                          |                     |
     |                                          | [if 2FA required]   |
     |<-----------------------------------------| Show 2FA page       |
     | User enters TOTP code                    |                     |
     |----------------------------------------->                     |
     |                                          |                     |
     | Redirect to redirect_uri?code=<code>     |                     |
     |<-----------------------------------------|                     |
     |                                          |                     |
     | GET /callback?code=...&state=...         |                     |
     |------------------->|                     |                     |
     |                    | POST /token         |                     |
     |                    | (server-to-server)  |                     |
     |                    |-------------------->|                     |
     |                    | {access_token,      |                     |
     |                    |  id_token}          |                     |
     |                    |<--------------------|                     |
     |                    |                     |                     |
     |                    | GET /userinfo       |                     |
     |                    |-------------------->|                     |
     |                    | {sub,email,role...} |                     |
     |                    |<--------------------|                     |
     |                    |                     |                     |
     | User is authenticated!                   |                     |
     |<-------------------|                     |                     |
```

### SSO Session (Re-Login Skip)

Once a user is authenticated, the IAM server stores an **SSO session cookie** (`sso_session`, httpOnly, 24h TTL) in the browser backed by Redis. If the same user opens another client app that redirects to `/authorize`, the auth server detects the existing session and **automatically issues a new auth code without showing the login page**. This is true Single Sign-On.

---

## 3. Registering a Client Application

Client applications must be registered in the IAM Management Portal before they can use the auth server.

### Via Management Portal UI

1. Open `http://localhost:3005` and sign in as admin (`admin@example.com` / `admin123`)
2. Navigate to **Dashboard → Client Apps**
3. Click **Register New Client**
4. Fill in:
   - **Client Name**: Human-readable name (e.g. "My Sales App")
   - **Redirect URIs**: Comma-separated list of allowed callback URLs
   - **SSO Enabled**: Toggle on/off
5. Copy the generated **Client ID** and **Client Secret**

### Pre-registered Clients (Seeded)

| Client ID             | Secret                   | App                     | Redirect URIs                         |
|-----------------------|--------------------------|-------------------------|---------------------------------------|
| `test_client_id_1`    | `test_client_secret_1`   | Test Client App 1       | `http://localhost:3001/callback`      |
| `auth_management_app` | `auth_management_secret` | Auth Server Management  | `http://localhost:3005/auth/callback` |

> **WARNING:** Never expose your `client_secret` in frontend JavaScript. The `/token` endpoint must always be called server-to-server.

---

## 4. OIDC Endpoints Reference

### Discovery Endpoint
```
GET http://localhost:8000/.well-known/openid-configuration
```
Returns all endpoint URLs. Use this to auto-configure standard OIDC libraries.

### Authorization Endpoint (SSO Login Page)
```
GET http://localhost:8000/authorize
  ?client_id=your_client_id
  &redirect_uri=http://localhost:3001/callback
  &response_type=code
  &scope=openid%20profile%20email
  &state=random_csrf_token
```

| Parameter       | Required    | Description                                           |
|-----------------|-------------|-------------------------------------------------------|
| `client_id`     | Yes         | Your registered client ID                             |
| `redirect_uri`  | Yes         | Must exactly match a registered redirect URI          |
| `response_type` | Yes         | Always `code`                                         |
| `scope`         | Yes         | `openid profile email`                                |
| `state`         | Recommended | Random CSRF token; echoed back in callback            |

### Token Endpoint
```
POST http://localhost:8000/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<auth_code>
&redirect_uri=http://localhost:3001/callback
&client_id=your_client_id
&client_secret=your_client_secret
```

**Response:**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJhbGci..."
}
```

### Userinfo Endpoint
```
GET http://localhost:8000/userinfo
Authorization: Bearer <access_token>
```
**Response:**
```json
{
  "sub": "user-uuid",
  "email": "user@company.com",
  "name": "Jane Smith",
  "picture": "https://...",
  "provider": "local",
  "role": "normal-user",
  "roles": ["normal-user"],
  "is_admin": false
}
```

### JWKS Endpoint
```
GET http://localhost:8000/jwks.json
```

### Logout Endpoint
```
GET http://localhost:8000/logout?post_logout_redirect_uri=http://localhost:3001
```

---

## 5. Integration — Step-by-Step

### Node.js / Express

```javascript
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(cookieParser());

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:8000';
const CLIENT_ID       = process.env.CLIENT_ID       || 'your_client_id';
const CLIENT_SECRET   = process.env.CLIENT_SECRET   || 'your_client_secret';
const REDIRECT_URI    = process.env.REDIRECT_URI    || 'http://localhost:3001/callback';

// Step 1: Redirect user to IAM SSO login page
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex'); // CSRF protection
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 5 * 60 * 1000 });

  const authUrl = `${AUTH_SERVER_URL}/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: 'code', scope: 'openid profile email', state,
  });
  res.redirect(authUrl);
});

// Step 2: Callback - exchange code for tokens
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/?error=${error}`);

  // CSRF validation
  if (state !== req.cookies.oauth_state) return res.status(400).send('Invalid state');
  res.clearCookie('oauth_state');

  // Token exchange (server-to-server)
  const tokenRes = await axios.post(`${AUTH_SERVER_URL}/token`,
    new URLSearchParams({ grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }));
  const { access_token } = tokenRes.data;

  // Fetch user info
  const userRes = await axios.get(`${AUTH_SERVER_URL}/userinfo`,
    { headers: { Authorization: `Bearer ${access_token}` } });

  // user.role = "admin" | "normal-user" | custom
  // user.is_admin = true | false
  res.cookie('session', access_token, { httpOnly: true });
  res.cookie('user', JSON.stringify(userRes.data), { httpOnly: true });
  res.redirect('/dashboard');
});

// Step 3: Logout
app.get('/logout', (req, res) => {
  res.clearCookie('session');
  res.clearCookie('user');
  res.redirect(`${AUTH_SERVER_URL}/logout?post_logout_redirect_uri=http://localhost:3001`);
});
```

### Python / FastAPI

```python
import secrets, httpx
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse

app = FastAPI()
AUTH_SERVER_URL = "http://localhost:8000"
CLIENT_ID       = "your_client_id"
CLIENT_SECRET   = "your_client_secret"
REDIRECT_URI    = "http://localhost:8080/callback"

@app.get("/login")
def login():
    state = secrets.token_hex(16)
    from urllib.parse import urlencode
    params = urlencode({"client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI,
                        "response_type": "code", "scope": "openid profile email", "state": state})
    response = RedirectResponse(f"{AUTH_SERVER_URL}/authorize?{params}")
    response.set_cookie("oauth_state", state, httponly=True, max_age=300)
    return response

@app.get("/callback")
async def callback(request: Request, code: str = None, state: str = None):
    async with httpx.AsyncClient() as client:
        token_res = await client.post(f"{AUTH_SERVER_URL}/token", data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": REDIRECT_URI, "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET})
        user_res = await client.get(f"{AUTH_SERVER_URL}/userinfo",
            headers={"Authorization": f"Bearer {token_res.json()['access_token']}"})
    user = user_res.json()
    # user["role"] and user["is_admin"] contain role information
    return RedirectResponse("/dashboard")
```

### Next.js (App Router)

```typescript
// app/auth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=${error}`);

  // Server-side token exchange
  const tokenRes = await fetch(`${process.env.AUTH_SERVER_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code!,
      redirect_uri: process.env.REDIRECT_URI!,
      client_id: process.env.CLIENT_ID!, client_secret: process.env.CLIENT_SECRET!,
    }),
  });
  const { access_token } = await tokenRes.json();

  const userRes = await fetch(`${process.env.AUTH_SERVER_URL}/userinfo`,
    { headers: { Authorization: `Bearer ${access_token}` } });
  const user = await userRes.json();

  const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`);
  response.cookies.set('session', access_token, { httpOnly: true, maxAge: 3600 });
  response.cookies.set('user', JSON.stringify(user), { httpOnly: true, maxAge: 3600 });
  return response;
}
```

---

## 6. Token Structure & Claims

The IAM auth server issues **RS256 JWT tokens**. Verify them with the public key from `/jwks.json`.

### id_token Payload
```json
{
  "iss":      "http://localhost:8000",
  "sub":      "user-uuid",
  "aud":      "your_client_id",
  "exp":      1700000000,
  "iat":      1699996400,
  "email":    "jane@company.com",
  "name":     "Jane Smith",
  "picture":  "https://...",
  "role":     "normal-user",
  "is_admin": false
}
```

### access_token Payload
```json
{
  "sub":      "user-uuid",
  "aud":      "your_client_id",
  "exp":      1700000000,
  "role":     "admin",
  "is_admin": true
}
```

### Default Roles

| Role name     | Description                                    |
|---------------|------------------------------------------------|
| `admin`       | Full system access, includes admin features    |
| `normal-user` | Standard authenticated user                    |
| *(custom)*    | Any additional roles created in the portal     |

---

## 7. Two-Factor Authentication (2FA/OTP)

Supports **TOTP** (Google Authenticator, Authy, Microsoft Authenticator).

### When 2FA is triggered

1. User has enabled 2FA on their own account (via management portal)
2. Admin has enabled "Enforce 2FA for All Users" in Google Settings

### Flow (completely transparent to your client app)

```
POST /login-submit (password OK)
        |
        +-- 2FA required?
        |        |
        |   YES  v
        |   /2fa-setup-page  <- first time: scan QR code
        |        or
        |   /2fa-verify-page <- enter 6-digit TOTP code
        |        |
        |        v
        |   /2fa-stepup-submit -> issues auth_code
        |
        +-- NO -> issues auth_code immediately
        |
        v
GET /callback?code=<auth_code>  <-- your app always receives this
```

Your `/callback` endpoint receives the authorization code only after all authentication steps are complete, regardless of whether 2FA was required.

---

## 8. Google OAuth Integration

### Setup

1. Create OAuth 2.0 credentials at [console.cloud.google.com](https://console.cloud.google.com/)
2. Set Authorized Redirect URI: `http://localhost:8000/auth/google/callback`
3. In Management Portal: **Dashboard → Google Settings**
   - Enter Google **Client ID** and **Client Secret**
   - Redirect URI: `http://localhost:8000/auth/google/callback`
   - Toggle **Enable Google Login**

When enabled, a "Continue with Google" button appears on the SSO login page automatically.

### Behavior

- New Google users → auto-registered with `provider=google`, role `normal-user`
- Existing email → linked to existing account
- 2FA still applies if enabled

---

## 9. Single Sign-On (SSO) Session

The `sso_session` cookie (httpOnly, 24h TTL) enables true SSO:

1. User signs into Client App A → SSO session created
2. User opens Client App B → session detected → **auto-issued auth code** → logged in without re-entering credentials

Configure per-client in Management Portal: **Client Apps → Edit → SSO Enabled**.

---

## 10. Single Logout (SLO)

```
GET http://localhost:8000/logout?post_logout_redirect_uri=http://localhost:3001
```

Clears SSO session from Redis + browser cookie, then redirects to your app.

Always also clear your own app's session cookies before redirecting to the IAM logout endpoint.

---

## 11. Environment Configuration

### Auth Server (`auth_server/.env`)

| Variable                          | Description                          |
|-----------------------------------|--------------------------------------|
| `AUTH_SERVER_URL`                | Public base URL of auth server        |
| `MANAGEMENT_URL`                 | URL of management portal              |
| `DATABASE_URL`                   | PostgreSQL connection string          |
| `REDIS_URL`                      | Redis connection string               |
| `SUCCESSFUL_SIGNUP_REDIRECT_URL` | Redirect after new user signup        |
| `LOGOUT_REDIRECT_URL`            | Default redirect after logout         |

### Client App Minimum Variables

```env
AUTH_SERVER_URL=http://auth_server:8000  # container-to-container
# OR
AUTH_SERVER_URL=http://localhost:8000    # if running locally

CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:PORT/callback
```

> **Note:** Inside Docker, use `http://auth_server:8000` for server-to-server calls (token exchange, userinfo). The `REDIRECT_URI` and browser-facing URLs must use `http://localhost:PORT`.

---

## 12. Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| `Invalid redirect_uri` on login | redirect_uri not registered | Exact match required in Client Apps |
| `Code client_id/redirect_uri mismatch` on token exchange | redirect_uri differs between /authorize and /token | Use identical string in both |
| `Invalid or expired code` | Code used twice or expired (10min) | Check for double-submission (React StrictMode) |
| No Google button on login page | Google login disabled | Enable in Management Portal → Google Settings |
| 2FA page not appearing | 2FA not enabled for user or globally | Enable in user settings or Google Settings |
| SSO session not working | SSO disabled for client | Enable in Client Apps → Edit → SSO Enabled |
| Token verification fails | RSA key rotated | Refresh JWKS from /jwks.json |

---

## Quick Start Checklist

```
[ ] 1. Register client app in Management Portal
[ ] 2. Save client_id and client_secret (keep secret server-side!)
[ ] 3. Set redirect_uri to match your /callback route exactly
[ ] 4. Implement /login — redirect to /authorize with state param
[ ] 5. Implement /callback — exchange code via /token (server-side)
[ ] 6. Call /userinfo for role + profile (or parse id_token)
[ ] 7. Implement /logout — call IAM /logout + clear local cookies
[ ] 8. Use role/is_admin from token for access control in your app
```

---

*IAM Central Auth Server v1.0.0 — Generated 2026-08-23*
