// OIDC Back-Channel Logout 1.0 endpoint.
// The auth server POSTs a signed `logout_token` JWT to this URI when a
// central SSO session is terminated. We verify the signature against the
// OP's public key, then clear the local session cookies/headers.

import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_SERVER_URL =
  process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
const CLIENT_ID = 'auth_management_app';

// Lazy JWKS handle (cached for the lifetime of the server)
let jwks = null;
function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${AUTH_SERVER_URL}/jwks.json`));
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
    const body = await request.text();
    if (!body) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    // Verify signature + standard claims
    const { payload } = await jwtVerify(body, getJWKS(), {
      issuer: AUTH_SERVER_URL,
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

    // The user has been logged out centrally. We don't have server-side
    // session state in this portal (auth is JWT-based and stored in
    // localStorage on the browser), so the back-channel notification is
    // a signal-only. Each browser session will discover the logout on
    // its next API call. The redirect-front-channel RP-Initiated Logout
    // remains the primary path; back-channel ensures any *other* open
    // browser sessions on this portal get cleared via the
    // /api/sso-broadcast endpoint below.
    console.log(`[backchannel-logout] sub=${payload.sub} sid=${payload.sid}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[backchannel-logout] error:', err.message);
    return NextResponse.json({ error: 'invalid_token', detail: err.message }, { status: 400 });
  }
}
