'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setSession, setStoredUser } from '@/app/lib/auth';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const exchangedRef = useRef(false);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(searchParams.get('error_description') || errorParam);
      return;
    }

    const code = searchParams.get('code');
    if (!code) {
      // If no code but user is already logged in, send to dashboard
      const stored = getStoredUser();
      if (stored) {
        window.location.replace(stored.is_admin || stored.role === 'admin' ? '/dashboard' : '/dashboard/profile');
        return;
      }
      setError('No authorization code provided.');
      return;
    }

    // Check if this exact code was already exchanged in this tab
    if (exchangedRef.current || window._exchangedCode === code) {
      return;
    }
    exchangedRef.current = true;
    window._exchangedCode = code;

    async function exchangeCode() {
      try {
        const redirectUri = `${window.location.origin}/auth/callback`;
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('client_id', 'auth_management_app');
        params.append('client_secret', 'auth_management_secret');

        const res = await fetch('/api/proxy/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // If code was already consumed but we already have an active session, navigate to dashboard
          const stored = getStoredUser();
          if (stored) {
            window.location.replace(stored.is_admin || stored.role === 'admin' ? '/dashboard' : '/dashboard/profile');
            return;
          }
          throw new Error(data.detail || data.error || 'Token exchange failed');
        }

        const data = await res.json();
        const accessToken = data.access_token;
        const idToken = data.id_token;
        const refreshToken = data.refresh_token;
        const expiresIn = data.expires_in || 900;

        // Parse JWT payload to extract user info & role
        let userPayload = {};
        try {
          const rawToken = idToken || accessToken;
          const payloadBase64 = rawToken.split('.')[1];
          const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
          userPayload = JSON.parse(atob(normalized));
        } catch (e) {
          console.error('Failed to parse JWT payload', e);
        }

        const isAdmin = !!userPayload.is_admin;
        const userRole = userPayload.role || (isAdmin ? 'admin' : 'normal-user');
        const userObj = {
          id: userPayload.sub,
          email: userPayload.email,
          name: userPayload.name,
          picture: userPayload.picture,
          role: userRole,
          is_admin: isAdmin,
          provider: 'local',
        };

        // 1. Store session cookies on the server via /api/auth/session
        await setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
        });

        // 2. Store non-sensitive user display data in localStorage for UI
        setStoredUser(userObj);

        // 3. Hard navigate to dashboard to replace callback URL in browser history
        const dest = (isAdmin || userRole === 'admin') ? '/dashboard' : '/dashboard/profile';
        window.location.replace(dest);
      } catch (err) {
        console.error('Callback error:', err);
        setError(err.message || 'Authentication error');
      }
    }

    exchangeCode();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
      {error ? (
        <div className="max-w-md w-full p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center">
          <p className="text-rose-400 font-semibold mb-2">Authentication Failed</p>
          <p className="text-xs text-slate-300 mb-4">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-white"
          >
            Return to Sign In
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-300">Completing Sign In...</p>
        </div>
      )}
    </div>
  );
}
