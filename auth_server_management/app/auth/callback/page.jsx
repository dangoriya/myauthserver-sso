'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  const exchangedRef = useState(false);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(errorParam);
      return;
    }

    const code = searchParams.get('code');

    if (!code) {
      setError('No authorization code provided.');
      return;
    }

    // Prevent double execution in React Strict Mode
    if (window._exchangedCode === code) return;
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

        const res = await fetch(`${authServerUrl}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || 'Token exchange failed');
        }

        const data = await res.json();
        const accessToken = data.access_token;
        const idToken = data.id_token;

        // Parse JWT payload to extract role & attributes
        let userPayload = {};
        try {
          const payloadBase64 = (idToken || accessToken).split('.')[1];
          userPayload = JSON.parse(atob(payloadBase64));
        } catch (e) {
          console.error('Failed to parse JWT payload', e);
        }

        const userObj = {
          id: userPayload.sub,
          email: userPayload.email,
          name: userPayload.name,
          picture: userPayload.picture,
          role: userPayload.role || (userPayload.is_admin ? 'admin' : 'normal-user'),
          is_admin: !!userPayload.is_admin,
          provider: 'google'
        };

        localStorage.setItem('admin_token', accessToken);
        if (idToken) localStorage.setItem('admin_id_token', idToken);
        localStorage.setItem('admin_user', JSON.stringify(userObj));

        // Admin users go to system overview dashboard; normal users go directly to their profile page
        if (userObj.is_admin || userObj.role === 'admin') {
          router.replace('/dashboard');
        } else {
          router.replace('/dashboard/profile');
        }
      } catch (err) {
        console.error('Callback error:', err);
        setError(err.message || 'Authentication error');
      }
    }

    exchangeCode();
  }, [searchParams, router, authServerUrl]);

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
          <p className="text-sm font-medium text-slate-300">Completing Sign In via Google OAuth...</p>
        </div>
      )}
    </div>
  );
}
