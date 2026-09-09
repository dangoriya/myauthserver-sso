import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/logout
 *
 * Dynamic Server-Side Logout Route.
 *
 * Reads the mgmt_id_token HttpOnly cookie (set during login) and sends it as
 * the `id_token_hint` to the central auth server's /logout endpoint — the
 * standard OIDC RP-Initiated Logout identification method. The server decodes
 * the token's `aud` claim to identify the client and its `sub` claim to
 * identify the user.
 *
 * Also clears all session cookies on the response.
 */
export async function GET() {
  const authServerUrl = (
    process.env.AUTH_SERVER_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
    'https://auth.example.com'
  ).replace(/\/+$/, '');

  const managementUrl = (
    process.env.MANAGEMENT_URL ||
    process.env.NEXT_PUBLIC_MANAGEMENT_URL ||
    'https://iam.example.com'
  ).replace(/\/+$/, '');

  const postLogoutUri = `${managementUrl}/logged-out`;
  const cookieStore = await cookies();
  const idToken = cookieStore.get('mgmt_id_token')?.value;

  let targetUrl = `${authServerUrl}/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`;
  if (idToken) {
    targetUrl += `&id_token_hint=${encodeURIComponent(idToken)}`;
  }
  // Also pass client_id for cases where id_token_hint is missing or invalid
  targetUrl += `&client_id=auth_management_app`;

  const response = NextResponse.redirect(targetUrl);

  // Clear all session cookies on the server response
  response.cookies.set('mgmt_access_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('mgmt_refresh_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('mgmt_id_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('mgmt_user', '', { maxAge: 0, path: '/' });

  return response;
}
