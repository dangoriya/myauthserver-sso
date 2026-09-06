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
docker-compose up --build
```

The auth server runs at `http://localhost:8000`.

## 1. Register Your Client App

**Endpoint:** `POST /api/v1/clients` (requires admin Bearer token or SSO session cookie)

```bash
curl -X POST http://localhost:8000/api/v1/clients \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Client App",
    "redirect_uris": "http://localhost:3001/callback",
    "is_sso_enabled": true
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
  "is_sso_enabled": true,
  "backchannel_logout_enabled": false,
  "created_at": "2024-..."
}
```

New clients are created with `backchannel_logout_enabled=false` by default. Enable it later if you register a back-channel logout endpoint (see [Back-Channel Logout](#back-channel-logout)).

### List / Delete Clients

```bash
curl http://localhost:8000/api/v1/clients \
  -H "Authorization: Bearer <admin-access-token>"

curl -X DELETE http://localhost:8000/api/v1/clients/client_a1b2c3d4e5f6 \
  -H "Authorization: Bearer <admin-access-token>"
```

## 2. OIDC Authorization Code Flow

### Step 1 — Browser Redirect to Auth Server

```
GET http://localhost:8000/authorize?
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
curl -X POST http://localhost:8000/token \
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

### Step 4 — Fetch User Info (Server-to-Server, Optional)

```bash
curl http://localhost:8000/userinfo \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://...",
  "provider": "local",
  "role": "normal-user",
  "roles": ["normal-user"],
  "is_admin": false,
  "is_2fa_enabled": false
}
```

### Step 5 — Refresh Access Token (Server-to-Server)

When the access token expires (15 min), use the refresh token:

```bash
curl -X POST http://localhost:8000/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=AUTH_REFRESH_TOKEN' \
  -d 'client_id=client_a1b2c3d4e5f6' \
  -d 'client_secret=secret_x7y8z9...'
```

Refresh tokens are single-use (rotated per RFC 6749 §6). The old refresh token is invalidated on each use.

### Detecting Centralized Logout

When a user logs out of the SSO session (via `/logout` or admin action), all their refresh tokens are revoked. Client apps detect this within 15 minutes when their next token refresh fails.

For faster detection, poll the session-active endpoint:

```bash
curl http://localhost:8000/oauth/session/active \
  -H "Authorization: Bearer <access_token>"
```

- `200` — session still active, token valid
- `401` — token invalid/expired or user logged out (refresh will fail)

Call on `window.focus` and every ~30s for near-real-time SSO logout detection.

## 3. JWKS / Token Verification

The OP publishes its public keys at:

```
GET http://localhost:8000/jwks.json
```

JWT claims in access tokens:
```json
{
  "iss": "http://localhost:8000",     // issuer
  "sub": "user_id",                   // user id
  "aud": "client_a1b2c3d4e5f6",       // client id
  "exp": 1234567890,
  "iat": 1234567890,
  "scope": "openid profile email",
  "role": "normal-user",
  "roles": ["normal-user"],
  "is_admin": false
}
```

JWT claims in id tokens:
```json
{
  "iss": "http://localhost:8000",
  "sub": "user_id",
  "aud": "client_a1b2c3d4e5f6",
  "exp": 1234567890,
  "iat": 1234567890,
  "auth_time": 1234567890,
  "email": "user@example.com",
  "name": "User Name",
  "picture": "https://...",
  "role": "normal-user",
  "roles": ["normal-user"],
  "is_admin": false,
  "sid": "oidc_session_id"
}
```

Verify tokens by:
1. Fetch JWKS from `/jwks.json`
2. Match `kid` in the JWT header to a key in JWKS
3. Verify `iss` equals `http://localhost:8000`
4. Verify `aud` equals your `client_id`
5. Check `exp`

## 4. Logout

### RP-Initiated Logout (Browser Redirect)

Redirect the browser to:

```
GET http://localhost:8000/logout?
  id_token_hint=<id_token_from_step_3>&
  post_logout_redirect_uri=http://localhost:3001/logged-out&
  state=OPTIONAL_STATE
```

The auth server will:
1. Verify the id_token (may be expired — this is allowed)
2. Terminate the central SSO session
3. Revoke all refresh tokens for the user (forces re-auth on all clients)
4. Redirect the browser to the registered `post_logout_redirect_uri`

The `post_logout_redirect_uri` must be registered during client creation by appending it to `post_logout_redirect_uris`. If not provided, the user is redirected to `MANAGEMENT_URL` (default `http://localhost:3005`).

### API Logout (Server-Initiated)

For admin-forced logout or programmatic logout:

```bash
curl -X POST http://localhost:8000/api/v1/sso/logout \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "target_user_id"}'
```

The caller must be the target user or an admin. This endpoint revokes all refresh tokens and terminates the SSO session. Back-channel logout is dispatched only if `BACKCHANNEL_LOGOUT_ENABLED=true` and the client has `backchannel_logout_enabled=true`.

### Token Revocation (RFC 7009)

```bash
curl -X POST http://localhost:8000/oauth/revoke \
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
GET http://localhost:8000/.well-known/openid-configuration
```

Auto-discovery libraries can consume this directly. Key fields:
- `issuer` = `http://localhost:8000`
- `authorization_endpoint` = `http://localhost:8000/authorize`
- `token_endpoint` = `http://localhost:8000/token`
- `userinfo_endpoint` = `http://localhost:8000/userinfo`
- `end_session_endpoint` = `http://localhost:8000/logout`
- `jwks_uri` = `http://localhost:8000/jwks.json`

## Configuration Reference (docker-compose / .env)

### auth_server

| Variable | Default | Description |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:8000` | Public URL of the auth server; used as JWT `iss` and for OIDC discovery. Must be browser-accessible. |
| `MANAGEMENT_URL` | `http://localhost:3005` | Management app public URL. `CENTRAL_DASHBOARD_URL` and `LOGOUT_REDIRECT_URL` default to this value. |
| `BACKCHANNEL_LOGOUT_ENABLED` | `false` | Global toggle for OIDC Back-Channel Logout 1.0. When `false`, the server never POSTs logout tokens to clients. |
| `REDIS_HOST` | `redis` | Redis service name (Docker network) |
| `REDIS_PORT` | `6379` | Redis port |
| `DATABASE_URL` | (see docker-compose) | PostgreSQL connection string |
| `RESET_DB` | `true` | Set `false` to preserve existing data on restart |
| `EMAIL_PROVIDER` | `smtp` | `"smtp"` or `"brevo_api"` |
| `SECRET_KEY` | (from .env) | Fallback JWT signing secret if no RSA keypair mounted |

### auth_server_management (Next.js)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_AUTH_SERVER_URL` | `http://localhost:8000` | Browser-facing auth server URL (exposed to client-side JS) |
| `AUTH_SERVER_INTERNAL_URL` | `http://auth_server:8000` | Server-side URL for internal calls (JWKS fetch, proxy). Uses Docker service name. |

### test_client_app1

| Variable | Default | Description |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:8000` | Public auth server URL (browser redirects) |
| `INTERNAL_AUTH_SERVER_URL` | `http://auth_server:8000` | Internal URL for server-to-server token/userinfo calls |
| `CLIENT_ID` | `test_client_id_1` | Registered client ID |
| `CLIENT_SECRET` | (from .env) | Client secret |
| `REDIRECT_URI` | `http://localhost:3001/callback` | Must match registered URI |
| `PUBLIC_BASE_URL` | `http://localhost:3001` | This app's public URL |

## Back-Channel Logout

The auth server supports OIDC Back-Channel Logout 1.0 for server-to-server session termination. This is **disabled by default** — no configuration is needed to get SSO login/logout working.

To enable:

1. Set `BACKCHANNEL_LOGOUT_ENABLED=true` in `docker-compose.yml`
2. Provide a back-channel logout endpoint in your client app:
   ```
   POST /backchannel-logout
   Content-Type: application/x-www-form-urlencoded
   Body: logout_token=<signed JWT>
   ```
3. Register the endpoint URI in the client's `backchannel_logout_uris` column in the database
4. Set `backchannel_logout_enabled=true` for the client

The OP will POST a `logout_token` JWT (with `events` claim containing `http://schemas.openid.net/event/backchannel-logout`) to each registered URI when a user's SSO session is terminated. Verify the token signature via the JWKS endpoint.

See `auth_server/logout.py` for the dispatch implementation and `auth_server_management/app/api/backchannel-logout/route.js` for a reference implementation.

## Quick Reference: Essential URLs

```
# Auth server (issuer)
http://localhost:8000

# Management app
http://localhost:3005

# Client registration (admin)
POST http://localhost:8000/api/v1/clients

# OIDC endpoints
http://localhost:8000/.well-known/openid-configuration
http://localhost:8000/jwks.json
http://localhost:8000/authorize
http://localhost:8000/token
http://localhost:8000/userinfo
http://localhost:8000/logout
http://localhost:8000/oauth/session/active

# Management API
POST http://localhost:8000/api/v1/auth/login
GET  http://localhost:8000/api/v1/clients
POST http://localhost:8000/api/v1/sso/logout
```
