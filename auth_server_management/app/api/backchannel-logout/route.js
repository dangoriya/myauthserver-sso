// OIDC Back-Channel Logout 1.0 endpoint.
// The auth server POSTs a signed `logout_token` JWT to this URI when a
// central SSO session is terminated. We verify the signature against the
// OP's public key.

import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// ISSUER: the issuer URL the auth server puts in the `iss` claim. Must
// match exactly. From the browser this is `http://localhost:8000`, but
// Next.js renders server-side too so we use a dedicated env var.
const AUTH_SERVER_ISSUER =
  process.env.AUTH_SERVER_ISSUER ||
  process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
  'http://localhost:8000';
// INTERNAL base URL for the back-channel handler to reach the auth
// server (different from the public issuer URL when the auth server is
// inside Docker on a different hostname).
const AUTH_SERVER_INTERNAL_URL =
  process.env.AUTH_SERVER_INTERNAL_URL || AUTH_SERVER_ISSUER;
const CLIENT_ID = 'auth_management_app';

// Lazy JWKS handle (cached for the lifetime of the server)
let jwks = null;
function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${AUTH_SERVER_INTERNAL_URL}/jwks.json`));
  }
  return jwks;
}

// Replay protection cache
const recentJti = new Map();
function rememberJti(jti, exp) {
  recentJti.set(jti, exp);
  const now = Math.floor(Date.now() / 1000);
  for (const [k, e] of recentJti.entries()) {
    if (e <= now) recentJti.delete(k);
  }
}

export async function POST(request) {
  try {
    // OIDC Back-Channel Logout 1.0 §2.2: the body is
    // application/x-www-form-urlencoded with a `logout_token` field.
    const contentType = request.headers.get('content-type') || '';
    let logoutToken = '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await request.text();
      const params = new URLSearchParams(body);
      logoutToken = params.get('logout_token') || '';
    } else {
      // Fallback: assume raw body
      logoutToken = (await request.text()).trim();
    }
    if (!logoutToken) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    // Verify signature + standard claims
    const { payload } = await jwtVerify(logoutToken, getJWKS(), {
      issuer: AUTH_SERVER_ISSUER,
      audience: CLIENT_ID,
    });

    if (payload.jti) {
      if (recentJti.has(payload.jti)) {
        return NextResponse.json({ ok: true, replay: true });
      }
      rememberJti(payload.jti, payload.exp);
    }

    if (!payload.events || !payload.events['http://schemas.openid.net/event/backchannel-logout']) {
      return NextResponse.json({ error: 'invalid_token', reason: 'missing events claim' }, { status: 400 });
    }

    const sub = payload.sub;
    console.log(`[backchannel-logout] sub=${sub} sid=${payload.sid}`);

    // The auth server's perform_centralized_logout has already revoked
    // this user's refresh tokens before posting to us, so every
    // open browser tab will fail to refresh and re-auth on its next
    // API call. The portal's 30s /oauth/session/active ping detects
    // this within 30s. Nothing further to do server-side.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[backchannel-logout] error:', err.message);
    return NextResponse.json({ error: 'invalid_token', detail: err.message }, { status: 400 });
  }
}
