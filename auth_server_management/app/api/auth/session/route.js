import { NextResponse } from 'next/server';

/**
 * POST /api/auth/session
 * Sets HttpOnly cookies for access_token and refresh_token.
 * Non-sensitive user display data (name, email, role) is returned
 * in the response body for the client to store in localStorage.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { access_token, refresh_token, expires_in } = body;

    const response = NextResponse.json({ success: true });
    const maxAge = expires_in || 86400 * 7;
    const isSecure = process.env.NODE_ENV === 'production';

    if (access_token) {
      response.cookies.set('mgmt_access_token', access_token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: maxAge,
      });
    }

    if (refresh_token) {
      response.cookies.set('mgmt_refresh_token', refresh_token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 86400 * 7,
      });
    }

    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

/**
 * DELETE /api/auth/session
 * Clears all session cookies on the server side.
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('mgmt_access_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('mgmt_refresh_token', '', { maxAge: 0, path: '/' });
  // Also clear legacy mgmt_user cookie in case it exists from older sessions
  response.cookies.set('mgmt_user', '', { maxAge: 0, path: '/' });
  return response;
}
