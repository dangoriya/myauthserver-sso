'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function TwoFAVerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const userId = searchParams.get('user_id') || '';
  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const state = searchParams.get('state') || '';

  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  useEffect(() => {
    if (!userId) {
      setError('Invalid session. Please sign in again.');
    }
  }, [userId]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // For auth_management_app client: use IAM direct login 2FA verify (returns token directly)
      if (clientId === 'auth_management_app') {
        const res = await fetch(`${authServerUrl}/api/v1/auth/login/2fa-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, totp_code: totpCode })
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || 'Invalid verification code');
        }

        const data = await res.json();
        localStorage.setItem('admin_token', data.access_token);
        localStorage.setItem('admin_user', JSON.stringify(data.user));

        setSuccess(true);
        const isAdmin = data.user?.is_admin || data.user?.role === 'admin';
        setTimeout(() => {
          router.replace(isAdmin ? '/dashboard' : '/dashboard/profile');
        }, 600);
        return;
      }

      // For other OIDC clients: complete the OIDC authorization code flow via 2FA stepup
      const res = await fetch(`${authServerUrl}/api/v1/auth/oidc-2fa-stepup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          client_id: clientId,
          redirect_uri: redirectUri,
          totp_code: totpCode,
          state: state,
          is_setup: false
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid verification code');
      }

      const data = await res.json();
      setSuccess(true);
      // Set SSO session cookie and redirect to client app
      document.cookie = `sso_session=${data.sso_session_id}; path=/; max-age=86400`;
      setTimeout(() => {
        window.location.href = data.redirect_url;
      }, 600);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-emerald-950">
      <div className="max-w-md w-full">
        {/* Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl">
          {/* Icon & Header */}
          <div className="text-center mb-8">
            <div className="relative inline-block">
              <div className="w-16 h-16 bg-gradient-to-tr from-amber-400 via-orange-400 to-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/20">
                <span className="text-2xl">🛡️</span>
              </div>
              {success && (
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center animate-bounce">
                  <span className="text-xs">✓</span>
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-300 via-orange-200 to-rose-300 bg-clip-text text-transparent">
              2FA Verification
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>

          {/* Info Banner */}
          <div className="mb-6 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
            <span className="text-amber-400 text-lg leading-none">📱</span>
            <p className="text-xs text-amber-200 leading-relaxed">
              Open <strong>Google Authenticator</strong> or <strong>Authy</strong> on your phone and enter the current 6-digit code shown for <em>IAM Auth Server</em>.
            </p>
          </div>

          {error && (
            <div className="mb-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm text-center animate-pulse">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm text-center">
              ✓ Verified! Redirecting...
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-2 tracking-wider">
                Authentication Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                maxLength={6}
                autoFocus
                value={totpCode}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setTotpCode(v);
                  setError('');
                }}
                placeholder="• • • • • •"
                className={`w-full px-4 py-4 rounded-2xl bg-slate-800/60 border text-center font-mono text-3xl tracking-[0.5em] placeholder-slate-600 text-emerald-400 focus:outline-none transition-all duration-200 ${
                  error
                    ? 'border-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.3)]'
                    : totpCode.length === 6
                    ? 'border-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.2)]'
                    : 'border-slate-700 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20'
                }`}
              />
              {totpCode.length > 0 && totpCode.length < 6 && (
                <p className="text-[11px] text-slate-400 mt-1.5 text-center">
                  {6 - totpCode.length} more digit{6 - totpCode.length !== 1 ? 's' : ''} needed
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || totpCode.length < 6 || success}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 font-bold text-white rounded-2xl hover:opacity-95 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Verifying...
                </span>
              ) : success ? '✓ Verified!' : 'Verify & Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800">
            <a
              href="/"
              className="block text-center text-xs text-slate-400 hover:text-slate-200 transition"
            >
              ← Back to Sign In
            </a>
          </div>
        </div>

        {/* Help Text */}
        <p className="text-center text-xs text-slate-500 mt-4">
          Lost access to your authenticator app?{' '}
          <a href="/" className="text-amber-400 hover:underline">Contact support</a>
        </p>
      </div>
    </div>
  );
}

export default function TwoFAVerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-slate-400">Loading...</div>
      </div>
    }>
      <TwoFAVerifyContent />
    </Suspense>
  );
}
