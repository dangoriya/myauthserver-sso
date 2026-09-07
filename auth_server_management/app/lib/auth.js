'use client';

/**
 * Authentication and Session Management Utility for Auth Server Management Portal
 *
 * Implements client-side helpers for Backend-for-Frontend (BFF) proxying,
 * HttpOnly session management, local user caching, and centralized SSO logout.
 */

/**
 * Persist user session tokens via HttpOnly cookies using the Next.js API route.
 */
export async function setSession({ access_token, refresh_token, expires_in }) {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token, refresh_token, expires_in }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to establish session');
  }
  return res.json();
}

/**
 * Clear session cookies on the server and remove cached user display info from localStorage.
 */
export async function clearSession() {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('mgmt_user');
      document.cookie = 'mgmt_user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    } catch {
      // ignore
    }
  }
  try {
    await fetch('/api/auth/session', { method: 'DELETE' });
  } catch (err) {
    console.error('Failed to clear session cookies', err);
  }
}

/**
 * Retrieve the current cached user object from localStorage or cookie.
 */
export function getStoredUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('mgmt_user');
    if (raw) return JSON.parse(raw);

    // Fallback: check document.cookie for mgmt_user if localStorage is empty
    const match = document.cookie.match(/(?:^|;\s*)mgmt_user=([^;]+)/);
    if (match) {
      const decoded = decodeURIComponent(match[1]);
      const user = JSON.parse(decoded);
      localStorage.setItem('mgmt_user', JSON.stringify(user));
      return user;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store non-sensitive user profile details in localStorage for UI rendering.
 */
export function setStoredUser(user) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('mgmt_user', JSON.stringify(user));
  } catch (err) {
    console.error('Failed to store user in localStorage', err);
  }
}

/**
 * Execute an authenticated API call through the Next.js BFF proxy (/api/proxy/...).
 * The BFF route automatically injects the HttpOnly access token as Authorization: Bearer <token>.
 */
export async function fetchAuthed(url, options = {}) {
  let targetPath = url;
  if (!targetPath.startsWith('/api/proxy')) {
    const normalized = targetPath.startsWith('/') ? targetPath.slice(1) : targetPath;
    targetPath = `/api/proxy/${normalized}`;
  }

  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(targetPath, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
}

/**
 * Initiate centralized SSO logout:
 * 1. Calls the central auth server /api/v1/sso/logout endpoint via the BFF proxy.
 * 2. Clears the local HttpOnly session cookies and localStorage user info.
 * 3. Redirects the browser to auth_server /logout to terminate the central SSO cookie,
 *    which safely redirects the browser to /logged-out.
 */
export async function centralLogout({ redirectTo } = {}) {
  const authServerUrl =
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:9000';
  const managementUrl =
    process.env.NEXT_PUBLIC_MANAGEMENT_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005');

  try {
    await fetchAuthed('/api/v1/sso/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  } catch {
    // Ignore network or logout failure; proceed to clear local state
  }

  await clearSession();

  const postLogoutUri = `${managementUrl.replace(/\/+$/, '')}/logged-out`;
  const logoutTarget =
    redirectTo ||
    `${authServerUrl.replace(/\/+$/, '')}/logout?client_id=auth_management_app&post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`;

  if (typeof window !== 'undefined') {
    window.location.href = logoutTarget;
  }
}
