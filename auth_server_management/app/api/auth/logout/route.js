import { NextResponse } from 'next/server';

/**
 * GET /api/auth/logout
 *
 * Dynamic Server-Side Logout Route.
 *
 * Resolves the runtime AUTH_SERVER_URL and MANAGEMENT_URL directly from the server's
 * environment variables (configured via .env or Dokploy), clears all session cookies,
 * and redirects the browser to the central SSO logout endpoint on the auth server.
 */
export async function GET() {
  const authServerUrl = (
    process.env.AUTH_SERVER_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
    'http://localhost:9000'
  ).replace(/\/+$/, '');

  const managementUrl = (
    process.env.MANAGEMENT_URL ||
    process.env.NEXT_PUBLIC_MANAGEMENT_URL ||
    'http://localhost:3005'
  ).replace(/\/+$/, '');

  const postLogoutUri = `${managementUrl}/logged-out`;
  const targetUrl = `${authServerUrl}/logout?client_id=auth_management_app&post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`;

  const response = NextResponse.redirect(targetUrl);

  // Clear all session cookies on the server response
  response.cookies.set('mgmt_access_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('mgmt_refresh_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('mgmt_user', '', { maxAge: 0, path: '/' });

  return response;
}
