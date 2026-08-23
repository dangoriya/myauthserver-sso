'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function TwoFASetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const userId = searchParams.get('user_id') || '';
  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const state = searchParams.get('state') || '';

  const [qrData, setQrData] = useState(null);  // { qr_code, totp_secret, service_name, account_name }
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrLoading, setQrLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  // Fetch QR code from auth server on mount
  useEffect(() => {
    if (!userId) {
      setError('Invalid session. Please sign in again.');
      setQrLoading(false);
      return;
    }

    // Use the auth server's 2fa-setup-page endpoint to generate the secret and get QR data via API
    // We call the existing setup-qr endpoint by passing user_id. However that requires a session token.
    // Since this is a post-login OIDC flow, we use a dedicated endpoint.
    const fetchQr = async () => {
      try {
        const res = await fetch(`${authServerUrl}/api/v1/auth/oidc-2fa-setup-qr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || 'Failed to generate QR code');
        }
        const data = await res.json();
        setQrData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setQrLoading(false);
      }
    };

    fetchQr();
  }, [userId, authServerUrl]);

  const copySecret = () => {
    if (qrData?.totp_secret) {
      navigator.clipboard.writeText(qrData.totp_secret).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (clientId === 'auth_management_app') {
        // For IAM direct login: enable 2FA and get a session token in one step
        // First enable 2FA on the account
        const enableRes = await fetch(`${authServerUrl}/api/v1/auth/signup/2fa-enable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, totp_code: totpCode })
        });

        if (!enableRes.ok) {
          const data = await enableRes.json();
          throw new Error(data.detail || 'Invalid verification code');
        }

        // 2FA enabled — now get admin token. Generate a fresh code from the authenticator.
        // We re-use the same code since it's still valid in this time window.
        const tokenRes = await fetch(`${authServerUrl}/api/v1/auth/login/2fa-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, totp_code: totpCode })
        });

        if (!tokenRes.ok) {
          // The TOTP window may have rolled — prompt user to re-enter
          setSuccess(false);
          setError('2FA setup complete! Please sign in again with your authenticator code.');
          setLoading(false);
          setTimeout(() => router.replace('/'), 2500);
          return;
        }

        const tokenData = await tokenRes.json();
        localStorage.setItem('admin_token', tokenData.access_token);
        localStorage.setItem('admin_user', JSON.stringify(tokenData.user));

        setSuccess(true);
        const isAdmin = tokenData.user?.is_admin || tokenData.user?.role === 'admin';
        setTimeout(() => {
          router.replace(isAdmin ? '/dashboard' : '/dashboard/profile');
        }, 800);
        return;
      }


      // OIDC client: complete authorization code flow after enabling 2FA
      const res = await fetch(`${authServerUrl}/api/v1/auth/oidc-2fa-stepup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          client_id: clientId,
          redirect_uri: redirectUri,
          totp_code: totpCode,
          state: state,
          is_setup: true  // Mark this as initial setup so 2FA gets activated
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid verification code');
      }

      const data = await res.json();
      setSuccess(true);
      document.cookie = `sso_session=${data.sso_session_id}; path=/; max-age=86400`;
      setTimeout(() => {
        window.location.href = data.redirect_url;
      }, 800);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (qrLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-emerald-950">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Generating your 2FA setup...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-emerald-950">
      <div className="max-w-md w-full">
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-tr from-emerald-400 via-teal-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
              <span className="text-2xl">🔐</span>
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-teal-200 to-indigo-300 bg-clip-text text-transparent">
              Set Up Two-Factor Auth
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Your account requires 2FA. Scan the QR code to get started.
            </p>
          </div>

          {/* Steps */}
          <div className="flex items-center justify-between mb-6 px-2">
            {['Scan QR Code', 'Enter Code', 'Done'].map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? 'bg-emerald-500 text-slate-950' :
                  i === 1 && totpCode.length > 0 ? 'bg-emerald-500 text-slate-950' :
                  success && i === 2 ? 'bg-emerald-500 text-slate-950' :
                  'bg-slate-700 text-slate-400'
                }`}>{i + 1}</div>
                <span className="text-xs text-slate-400 hidden sm:block">{step}</span>
                {i < 2 && <div className="w-6 h-px bg-slate-700 mx-1" />}
              </div>
            ))}
          </div>

          {error && (
            <div className="mb-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm text-center">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm text-center">
              ✓ 2FA activated successfully! Redirecting...
            </div>
          )}

          {/* QR Code */}
          {qrData && (
            <div className="text-center mb-5">
              <div className="bg-white p-4 rounded-2xl inline-block shadow-xl border border-slate-200 mb-3">
                <img
                  src={qrData.qr_code}
                  alt="2FA QR Code"
                  className="w-44 h-44 mx-auto"
                />
              </div>
              <div className="text-xs text-slate-400 space-y-1 mb-3">
                <p>Scan with <strong className="text-emerald-400">Google Authenticator</strong> or <strong className="text-emerald-400">Authy</strong></p>
                {qrData.service_name && (
                  <p>Service: <span className="text-slate-300">{qrData.service_name}</span></p>
                )}
              </div>
              {/* Manual secret key */}
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-2">
                <p className="text-xs font-mono text-emerald-400 select-all break-all">{qrData.totp_secret}</p>
                <button
                  type="button"
                  onClick={copySecret}
                  className="flex-shrink-0 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-[10px] rounded-lg transition font-medium"
                >
                  {copied ? '✓' : 'Copy'}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                Can't scan? Enter this secret manually in your authenticator app.
              </p>
            </div>
          )}

          {/* Verify Form */}
          <form onSubmit={handleSetup} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-2 tracking-wider">
                Confirm Setup — Enter 6-digit Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                maxLength={6}
                autoFocus={!qrLoading}
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
                    : 'border-slate-700 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20'
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
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-bold text-white rounded-2xl hover:opacity-95 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Activating 2FA...
                </span>
              ) : success ? '✓ 2FA Activated!' : 'Verify & Activate 2FA'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800">
            <a href="/" className="block text-center text-xs text-slate-400 hover:text-slate-200 transition">
              ← Back to Sign In
            </a>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">
          Need help? <a href="/" className="text-emerald-400 hover:underline">Contact support</a>
        </p>
      </div>
    </div>
  );
}

export default function TwoFASetupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-slate-400">Loading...</div>
      </div>
    }>
      <TwoFASetupContent />
    </Suspense>
  );
}
