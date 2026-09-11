# SSO Integration Guide

Quick-start reference for registering and integrating client applications with the IAM Auth Server (OIDC/OAuth2 SSO provider).

## Architecture Overview

```
    Browser                     ┌──────────────┐         ┌──────────────────┐
   ─────────                    │  auth_server  │         │ auth_server_     │
      · Auth redirect flow       │  :8000 (OP)   │◀────────│ management  :3000 │
      · SSO cookie               └──────────────┘         └──────────────────┘
                                      │  ▲
                                      │  │ server↔server
                                      │  │ (Docker network)
                                 ┌────┴──┐
                                 │ redis  │
                                 │ postgres│
                                 └────────┘
```

| Service | Port | Role |
|---|---|---|
| auth_server | `8000` | OIDC Provider (OP) — FastAPI, RS256 JWT signing |
| auth_server_management | `3005→3000` | Management portal (OIDC client) — Next.js |
| test_client_app1 | `3001` | Example client app (OIDC client) — Express |
| postgresdb | `5432` | User data, roles, client registrations |
| redis | `6379` | SSO sessions, auth codes, refresh tokens |
| pgadmin | `5050` | PostgreSQL UI |

## Start Up

```bash
docker-compose -f docker-compose.local.yml up --build
```

The auth server runs at `http://localhost:8005` (local) or `http://localhost:8000` (production).

## 1. Register Your Client App

**Endpoint:** `POST /api/v1/admin/clients` (requires admin Bearer token)

```bash
curl -X POST http://localhost:8005/api/v1/admin/clients \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Client App",
    "redirect_uris": "http://localhost:3001/callback",
    "is_sso_enabled": true,
    "post_logout_redirect_uris": "http://localhost:3001/logged-out",
    "backchannel_logout_uris": "",
    "backchannel_logout_enabled": false
  }'
```

**Response** (save `client_id` and `client_secret` — they are shown only once):

```json
{
  "id": "uuid",
  "client_id": "client_a1b2c3d4e5f6",
  "client_secret": "secret_x7y8z9...",
  "client_name": "My Client App",
  "redirect_uris": "http://localhost:3001/callback",
  "post_logout_redirect_uris": "http://localhost:3001/logged-out",
  "backchannel_logout_uris": "",
  "backchannel_logout_enabled": false,
  "is_sso_enabled": true,
  "created_at": "2024-..."
}
```

New clients are created with `backchannel_logout_enabled=false` and `post_logout_redirect_uris` left blank (falls back to the global `POST_LOGOUT_REDIRECT_URL`). Enable back-channel logout later if you register a back-channel logout endpoint (see [Back-Channel Logout](#back-channel-logout)).

### List / Delete Clients

```bash
curl http://localhost:8005/api/v1/admin/clients \
  -H "Authorization: Bearer <admin-access-token>"

curl -X DELETE http://localhost:8005/api/v1/admin/clients/client_a1b2c3d4e5f6 \
  -H "Authorization: Bearer <admin-access-token>"
```

## 2. OIDC Authorization Code Flow

### Step 1 — Browser Redirect to Auth Server

```
GET http://localhost:8005/authorize?
  client_id=client_a1b2c3d4e5f6
  &redirect_uri=http://localhost:3001/callback
  &response_type=code
  &scope=openid%20profile%20email
  &state=RANDOM_STRING
  &code_challenge=...      # optional PKCE
  &code_challenge_method=S256   # optional
```

Parameters:
| Parameter | Required | Description |
|---|---|---|
| `client_id` | Yes | From client registration |
| `redirect_uri` | Yes | Must match a registered URI exactly |
| `response_type` | Yes | Must be `code` |
| `scope` | Yes | `openid` required; `profile` and `email` recommended |
| `state` | Recommended | Opaque value for CSRF protection — must be verified on callback |
| `code_challenge` | Optional | PKCE code challenge |
| `code_challenge_method` | Optional | `S256` or `plain` (PKCE) |

If the user has no active SSO session, they are routed to the login page. If they have a valid `sso_session` cookie and the client has `is_sso_enabled=true`, they are silently issued a code without re-entering credentials.

### Step 2 — Callback with Auth Code

The browser is redirected to your `redirect_uri` with:

```
GET http://localhost:3001/callback?code=AUTH_CODE&state=YOUR_STATE
```

Verify `state` matches what you sent. Then exchange the code server-to-server.

### Step 3 — Exchange Code for Tokens (Server-to-Server)

```bash
curl -X POST http://localhost:8005/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=authorization_code' \
  -d 'code=AUTH_CODE' \
  -d 'redirect_uri=http://localhost:3001/callback' \
  -d 'client_id=client_a1b2c3d4e5f6' \
  -d 'client_secret=secret_x7y8z9...' \
  -d 'code_verifier=...'  # if PKCE was used
```

Response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 900,
  "id_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "opaque_refresh_token",
  "scope": "openid profile email"
}
```

Token lifetimes:
- **Access token (JWT):** 15 minutes
- **Refresh token:** 7 days
- **SSO session:** 24 hours

The access token and id_token are RS256-signed JWTs. Verify signatures via the JWKS endpoint (see below).

### Access Token Claims (NEW — includes user profile)

```json
{
  "iss": "http://localhost:8005",
  "sub": "user_id",
  "aud": "client_a1b2c3d4e5f6",
  "client_id": "client_a1b2c3d4e5f6",
  "scope": "openid profile email",
  "roles": ["normal-user"],
  "exp": 1234567890,
  "iat": 1234567890,
  "email": "user@example.com",
  "name": "User Name",
  "sid": "oidc_session_id"
}
```

### ID Token Claims

```json
{
  "iss": "http://localhost:8005",
  "sub": "user_id",
  "aud": "client_a1b2c3d4e5f6",
  "exp": 1234567890,
  "iat": 1234567890,
  "auth_time": 1234567890,
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://...",
  "roles": ["normal-user"],
  "sid": "oidc_session_id"
}
```

**Note:** Both tokens now include `email`, `name`, and `roles`. The access token additionally includes `client_id` and `scope`. This allows client apps to extract user identity from either token without a separate `/userinfo` call.

### Step 4 — Fetch User Info (Server-to-Server, Optional)

```bash
curl http://localhost:8005/userinfo \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://...",
  "provider": "local",
  "roles": ["normal-user"],
  "is_admin": false,
  "is_2fa_enabled": false
}
```

### Step 5 — Refresh Access Token (Server-to-Server)

When the access token expires (15 min), use the refresh token:

```bash
curl -X POST http://localhost:8005/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=AUTH_REFRESH_TOKEN' \
  -d 'client_id=client_a1b2c3d4e5f6' \
  -d 'client_secret=secret_x7y8z9...'
```

**New access token includes the same user profile claims** (`email`, `name`, `roles`) as the original.

Refresh tokens are single-use (rotated per RFC 6749 §6). The old refresh token is invalidated on each use.

### Detecting Centralized Logout (Real-Time SSO Session Check)

When a user logs out of the SSO session (via `/logout` or admin action), all their refresh tokens and Redis session entries are revoked. Client apps detect this within 15 minutes when their next token refresh fails.

For faster detection, poll the real-time session-active endpoint:

```bash
# Via Bearer header (supports access_token or id_token)
curl http://localhost:8005/oauth/session/active \
  -H "Authorization: Bearer <access_token_or_id_token>"

# Or via query parameter:
curl "http://localhost:8005/oauth/session/active?token=<access_token_or_id_token>"
```

- **Supported Tokens**: Accepts either `access_token` or `id_token` (via `Authorization: Bearer <token>`, `?token=...`, `?access_token=...`, or `?id_token=...`).
- **Validation**: Verifies cryptographic signature, user active status in the database, and real-time SSO session / refresh-token presence in Redis.
- **Status Responses**:
  - `200 OK` — SSO session is active, user is valid, returns user details (`sub`, `email`, `name`, `roles`, `token_type`, `exp`, `sid`).
  - `401 Unauthorized` — Token invalid/expired or central SSO session terminated.

Call on `window.focus` and periodically (e.g., every 30s) for real-time SSO logout detection.

## 3. JWKS / Token Verification

The OP publishes its public keys at:

```
GET http://localhost:8005/jwks.json
```

Verify tokens by:
1. Fetch JWKS from `/jwks.json`
2. Match `kid` in the JWT header to a key in JWKS
3. Verify `iss` equals `http://localhost:8005`
4. Verify `aud` equals your `client_id`
5. Check `exp`

## 4. Logout

### RP-Initiated Logout (Browser Redirect)

**⚠️ SECURITY UPDATE:** The `/logout` endpoint now **requires POST** and **compulsory `id_token_hint`** for security (CSRF protection).

Send a **POST request** with form data to:

```
POST http://localhost:8005/logout
Content-Type: application/x-www-form-urlencoded

id_token_hint=<id_token_from_step_3>&
post_logout_redirect_uri=http://localhost:3001/logged-out&
state=OPTIONAL_STATE&
client_id=client_a1b2c3d4e5f6  # optional fallback if id_token lacks aud
```

**`id_token_hint` is now REQUIRED.** The signed JWT provides:
- **CSRF protection** — cannot be forged by attackers
- **User identification** — `sub` claim identifies the user
- **Client identification** — `aud` or `client_id` claim identifies the client
- **Integrity verification** — JWT signature is validated

If `id_token_hint` is missing or invalid, the request will be **rejected with 401 Unauthorized**.

The `post_logout_redirect_uri` is validated against the client's registered `post_logout_redirect_uris`:

**Validation rules:**
1. If `post_logout_redirect_uri` matches a registered URI → browser redirected there
2. If client has **no** registered `post_logout_redirect_uris` → global fallback (`POST_LOGOUT_REDIRECT_URL`)
3. If client **has** registered URIs but provided URI does **not** match → **falls back to global `POST_LOGOUT_REDIRECT_URL`** (no error, no redirect to invalid URI)
4. If `post_logout_redirect_uri` is **not provided** → global fallback

**Global fallback chain:** `POST_LOGOUT_REDIRECT_URL` → `LOGOUT_REDIRECT_URL` → `AUTH_SERVER_URL`

The auth server will:
1. ✅ **Verify the id_token_hint JWT signature** (expiration not required)
2. ✅ **Validate client is registered** in the database
3. ✅ Identify the client from `id_token_hint.aud` or `client_id` parameter
4. ✅ Terminate the central SSO session
5. ✅ Revoke all refresh tokens for the user (forces re-auth on all clients)
6. ✅ Redirect the browser to the validated `post_logout_redirect_uri` or the global fallback

**JavaScript Example:**
```javascript
const idToken = localStorage.getItem('id_token');
const formData = new URLSearchParams();
formData.append('id_token_hint', idToken);
formData.append('post_logout_redirect_uri', 'https://myapp.com/logged-out');

fetch('https://auth.yourdomain.com/logout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: formData.toString(),
  credentials: 'include'
}).then(() => {
  window.location.href = '/logged-out';
});
```

Register `post_logout_redirect_uris` during client creation (or via the management UI / `PUT /api/v1/admin/clients/{client_id}`).

### API Logout (Server-Initiated)

For admin-forced logout or programmatic logout:

```bash
curl -X POST http://localhost:8005/api/v1/sso/logout \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "target_user_id"}'
```

The caller must be the target user or an admin. This endpoint revokes all refresh tokens and terminates the SSO session. Back-channel logout is dispatched only if `BACKCHANNEL_LOGOUT_ENABLED=true` and the client has `backchannel_logout_enabled=true`.

> **Note:** The `/api/v1/sso/logout` endpoint handles server-side revocation. For the browser-based OIDC RP-Initiated Logout (`/logout`), the client should send `id_token_hint` or `client_id` — see above.

### Token Revocation (RFC 7009)

```bash
curl -X POST http://localhost:8005/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'token=<refresh_token>' \
  -d 'token_type_hint=refresh_token' \
  -d 'client_id=client_a1b2c3d4e5f6' \
  -d 'client_secret=secret_x7y8z9...'
```

Returns `200` (idempotent — no error even if the token was unknown).

## 5. Discovery

The OIDC discovery document is available at:

```
GET http://localhost:8005/.well-known/openid-configuration
```

Auto-discovery libraries can consume this directly. Key fields:
- `issuer` = `http://localhost:8005`
- `authorization_endpoint` = `http://localhost:8005/authorize`
- `token_endpoint` = `http://localhost:8005/token`
- `userinfo_endpoint` = `http://localhost:8005/userinfo`
- `end_session_endpoint` = `http://localhost:8005/logout`
- `jwks_uri` = `http://localhost:8005/jwks.json`

## Configuration Reference (docker-compose / .env)

### auth_server

| Variable | Default | Description |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:8005` | Public URL of the auth server; used as JWT `iss` and for OIDC discovery. Must be browser-accessible. |
| `MANAGEMENT_URL` | `http://localhost:3005` | Management app public URL. `CENTRAL_DASHBOARD_URL`, `LOGOUT_REDIRECT_URL`, and `POST_LOGOUT_REDIRECT_URL` default to this value. |
| `BACKCHANNEL_LOGOUT_ENABLED` | `false` | Global toggle for OIDC Back-Channel Logout 1.0. When `false`, the server never POSTs logout tokens to clients. |
| `POST_LOGOUT_REDIRECT_URL` | (none — falls back to `LOGOUT_REDIRECT_URL`) | Global fallback URL used during RP-Initiated Logout when the client has no registered `post_logout_redirect_uris` or no `post_logout_redirect_uri` is provided. Example: `https://dilipdangoriya.com.np` |
| `REDIS_HOST` | `redis` | Redis service name (Docker network) |
| `REDIS_PORT` | `6379` | Redis port |
| `DATABASE_URL` | (see docker-compose) | PostgreSQL connection string |
| `RESET_DB` | `true` | Set `false` to preserve existing data on restart |
| `EMAIL_PROVIDER` | `smtp` | `"smtp"` or `"brevo_api"` |
| `SECRET_KEY` | (from .env) | Fallback JWT signing secret if no RSA keypair mounted |

### auth_server_management (Next.js)

| Variable | Default | Description |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:8005` | Browser-facing auth server URL (used by server-side code) |
| `AUTH_SERVER_INTERNAL_URL` | `http://auth_server:8000` | Server-side URL for internal calls (proxy). Uses Docker service name. |

### test_client_app1

| Variable | Default | Description |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:8005` | Public auth server URL (browser redirects) |
| `INTERNAL_AUTH_SERVER_URL` | `http://auth_server:8000` | Internal URL for server-to-server token/userinfo calls |
| `CLIENT_ID` | `test_client_id_1` | Registered client ID |
| `CLIENT_SECRET` | (from .env) | Client secret |
| `REDIRECT_URI` | `http://localhost:3001/callback` | Must match registered URI |
| `PUBLIC_BASE_URL` | `http://localhost:3001` | This app's public URL |

## Back-Channel Logout

The auth server supports OIDC Back-Channel Logout 1.0 for server-to-server session termination. This is **disabled by default** — no configuration is needed to get SSO login/logout working.

To enable:

1. Set `BACKCHANNEL_LOGOUT_ENABLED=true` in `docker-compose.yml` (global toggle)
2. Provide a back-channel logout endpoint in your client app:
   ```
   POST /backchannel-logout
   Content-Type: application/x-www-form-urlencoded
   Body: logout_token=<signed JWT>
   ```
3. Register the endpoint URI and enable back-channel logout for the client — either via the management UI (`Registered Apps → Edit → Back-Channel Logout`) or via the API:
   ```bash
   curl -X PUT http://localhost:8005/api/v1/admin/clients/client_a1b2c3d4e5f6 \
     -H "Authorization: Bearer <admin-access-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "backchannel_logout_uris": "http://localhost:3001/backchannel-logout",
       "backchannel_logout_enabled": true
     }'
   ```

The OP will POST a `logout_token` JWT (with `events` claim containing `http://schemas.openid.net/event/backchannel-logout`) to each registered URI when a user's SSO session is terminated. Verify the token signature via the JWKS endpoint.

See `auth_server/logout.py` for the dispatch implementation and `auth_server_management/app/api/backchannel-logout/route.js` for a reference implementation.

## Quick Reference: Essential URLs

```
# Auth server (issuer)
http://localhost:8005

# Management app
http://localhost:3005

# Client registration (admin)
POST http://localhost:8005/api/v1/admin/clients

# OIDC endpoints
http://localhost:8005/.well-known/openid-configuration
http://localhost:8005/jwks.json
http://localhost:8005/authorize
http://localhost:8005/token
http://localhost:8005/userinfo
POST http://localhost:8005/logout  # Changed to POST for CSRF protection
http://localhost:8005/oauth/session/active

# Management API
POST http://localhost:8005/api/v1/auth/login
GET  http://localhost:8005/api/v1/admin/clients
POST http://localhost:8005/api/v1/sso/logout
```

## Key Implementation Notes for Client Apps

### Token Storage
- Store `access_token` and `refresh_token` securely (HttpOnly cookies or secure storage)
- `id_token` is needed for logout — store it if using OIDC RP-Initiated Logout
- The access token contains user profile (`email`, `name`, `roles`) — you may not need `/userinfo`

### Logout Integration
**⚠️ Important:** The `/logout` endpoint now **requires POST** with `id_token_hint` for security.

```javascript
// POST with id_token_hint (required)
const formData = new URLSearchParams();
formData.append('id_token_hint', idToken);
formData.append('post_logout_redirect_uri', 'https://myapp.com/logged-out');

fetch('https://auth.example.com/logout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: formData.toString(),
  credentials: 'include'
}).then(response => {
  // Browser will follow redirect automatically
  window.location.href = response.url;
});

// Alternative: Via server-side proxy (recommended for SPAs)
// Your backend POSTs to auth server, then redirects the browser
window.location.href = '/api/auth/logout';
```

**Note:** `id_token_hint` is now **REQUIRED**. Client must have stored the `id_token` from the OIDC login response.

### Silent Re-auth (SSO)
If the user has a valid `sso_session` cookie and your client has `is_sso_enabled=true`, the `/authorize` endpoint will immediately redirect back with a code — no login form shown.

### Error Handling
| Endpoint | Error Response Format |
|---|---|
| `/token` | `{ "detail": "invalid_grant" }` (400) |
| `/logout` | `{ "detail": "Invalid or tampered id_token_hint" }` (401) or `{ "detail": "Unknown client_id" }` (401) |
| `/userinfo` | `{ "detail": "Invalid access token" }` (401) |