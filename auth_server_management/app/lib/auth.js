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
export async function setSession({ access_token, refresh_token, id_token, expires_in }) {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token, refresh_token, id_token, expires_in }),
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
 * 2. Clears local storage state.
 * 3. Navigates to /api/auth/logout which dynamically uses the runtime AUTH_SERVER_URL
 *    from server environment variables and redirects to the central auth server /logout.
 */
export async function centralLogout({ redirectTo } = {}) {
  try {
    await fetchAuthed('/api/v1/sso/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  } catch {
    // Ignore error
  }

  // Clear localStorage (but NOT cookies — the /api/auth/logout route needs
  // the mgmt_id_token cookie to pass as id_token_hint to the auth server)
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('mgmt_user');
    } catch {}
  }

  if (typeof window !== 'undefined') {
    if (redirectTo) {
      window.location.href = redirectTo;
    } else {
      // Use the dynamic server-side logout route that reads runtime AUTH_SERVER_URL
      // It reads mgmt_id_token cookie and passes it as id_token_hint
      window.location.href = '/api/auth/logout';
    }
  }
}
