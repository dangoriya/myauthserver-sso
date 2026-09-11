import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/logout
 *
 * Dynamic Server-Side Logout Route.
 *
 * Flow:
 * 1. Clear local management app cookies (mgmt_access_token, mgmt_refresh_token, mgmt_id_token, mgmt_user)
 * 2. POST to auth server's /logout endpoint with id_token_hint to terminate SSO session
 * 3. Redirect to login page (management app home)
 *
 * This provides: clear local session -> SSO logout -> login page
 */
export async function GET(request) {
  const authServerUrl = (
    process.env.AUTH_SERVER_INTERNAL_URL ||
    process.env.AUTH_SERVER_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
    'http://auth_server:8000'
  ).replace(/\/+$/, '');

  const managementUrl = (
    process.env.MANAGEMENT_URL ||
    process.env.NEXT_PUBLIC_MANAGEMENT_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');

  const cookieStore = await cookies();
  const idToken = cookieStore.get('mgmt_id_token')?.value;

  const url = new URL(request.url || 'http://localhost/api/auth/logout');
  const redirectToParam = url.searchParams.get('redirectTo') || '/';

  // Build form data for POST request to auth server
  const formData = new URLSearchParams();

  if (idToken) {
    formData.append('id_token_hint', idToken);
  }

  // Also pass client_id for identification
  formData.append('client_id', 'auth_management_app');

  // Pass post_logout_redirect_uri to redirect to home page (login page)
  const targetRedirectUri = `${managementUrl}${redirectToParam.startsWith('/') ? redirectToParam : '/' + redirectToParam}`;
  formData.append('post_logout_redirect_uri', targetRedirectUri);

  // POST to auth server's /logout endpoint to terminate SSO session
  const logoutUrl = `${authServerUrl}/logout`;

  try {
    // Don't follow redirects automatically - we handle the response ourselves
    const logoutResponse = await fetch(logoutUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    // Check if logout was successful (303 redirect)
    if (!logoutResponse.ok && logoutResponse.status !== 303) {
      console.error(
        '[auth/logout] Auth server logout failed:',
        logoutResponse.status,
        await logoutResponse.text()
      );
    }
  } catch (error) {
    console.error('[auth/logout] Error calling auth server:', error);
  }

  const loginUrl = targetRedirectUri;

  // Create redirect response to target page
  const response = NextResponse.redirect(loginUrl);

  // Clear ALL management app session cookies & sso_session cookie on the redirect response
  response.cookies.delete('mgmt_access_token');
  response.cookies.delete('mgmt_refresh_token');
  response.cookies.delete('mgmt_id_token');
  response.cookies.delete('mgmt_user');
  response.cookies.delete('sso_session');

  console.log(`[auth/logout] Redirecting to: ${loginUrl}`);

  return response;
}
