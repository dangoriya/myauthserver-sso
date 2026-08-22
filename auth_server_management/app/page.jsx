'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // 2FA state
  const [step2FA, setStep2FA] = useState(null); // 'setup' or 'verify'
  const [twoFAData, setTwoFAData] = useState(null);
  const [totpCode, setTotpCode] = useState('');

  // Google OAuth state
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const router = useRouter();
  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  useEffect(() => {
    async function checkGoogleSettings() {
      try {
        const res = await fetch(`${authServerUrl}/api/v1/admin/google-settings`);
        if (res.ok) {
          const data = await res.json();
          setGoogleEnabled(!!data.is_enabled);
        }
      } catch (e) {
        // ignore
      }
    }
    checkGoogleSettings();
  }, [authServerUrl]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Invalid credentials');
      }

      const data = await res.json();
      
      if (data.requires_2fa_setup) {
        setStep2FA('setup');
        setTwoFAData(data);
        setLoading(false);
        return;
      }

      if (data.requires_2fa_verify) {
        setStep2FA('verify');
        setTwoFAData(data);
        setLoading(false);
        return;
      }

      localStorage.setItem('admin_token', data.access_token);
      localStorage.setItem('admin_user', JSON.stringify(data.user));

      const isAdmin = data.user?.is_admin || data.user?.role === 'admin';
      if (isAdmin) {
        router.push('/dashboard');
      } else {
        router.push('/dashboard/profile');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handle2FAVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/auth/login/2fa-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: twoFAData.user_id,
          totp_code: totpCode
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Invalid 2FA code');
      }

      const data = await res.json();
      localStorage.setItem('admin_token', data.access_token);
      localStorage.setItem('admin_user', JSON.stringify(data.user));

      const isAdmin = data.user?.is_admin || data.user?.role === 'admin';
      if (isAdmin) {
        router.push('/dashboard');
      } else {
        router.push('/dashboard/profile');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-emerald-950">
      <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-emerald-400 via-sky-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20 font-bold text-2xl text-white">
            IAM
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-indigo-200 to-purple-400 bg-clip-text text-transparent">
            {step2FA ? 'Two-Factor Authentication' : 'IAM Portal Sign In'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">Identity & Access Management Central Portal</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm text-center">
            {error}
          </div>
        )}

        {!step2FA ? (
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Email Address</label>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 invalid:border-rose-500/80 focus:invalid:border-rose-500 focus:invalid:ring-rose-500/30 transition shadow-sm"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Password</label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 invalid:border-rose-500/80 focus:invalid:border-rose-500 focus:invalid:ring-rose-500/30 transition shadow-sm"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                >
                  <span className="text-sm">{showPassword ? '👁️' : '🙈'}</span>
                </button>
              </div>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-semibold text-white rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Sign In to IAM'}
            </button>

            {googleEnabled && (
              <>
                <div className="relative my-4 text-center text-xs text-slate-400 border-b border-slate-800 leading-none">
                  <span className="bg-slate-900 px-3 absolute -top-2 left-1/2 -translate-x-1/2">OR</span>
                </div>

                <a
                  href={`${authServerUrl}/auth/google?client_id=auth_management_app&redirect_uri=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : 'http://localhost:3005/auth/callback')}`}
                  className="w-full flex items-center justify-center gap-3 py-3 bg-white text-slate-900 font-semibold text-sm rounded-xl hover:bg-slate-100 transition shadow-md"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  Sign In with Google
                </a>
              </>
            )}

            <div className="text-center pt-4 border-t border-slate-800/80 mt-2">
              <p className="text-xs text-slate-400">
                Don't have an account?{' '}
                <a href="/signup" className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 hover:underline">
                  Sign up →
                </a>
              </p>
            </div>
          </form>
        ) : (
          <form onSubmit={handle2FAVerify} className="space-y-5">
            {step2FA === 'setup' && twoFAData?.qr_code && (
              <div className="text-center bg-slate-800/80 p-4 rounded-2xl border border-slate-700 mb-4">
                <p className="text-xs text-slate-300 mb-3">Scan this QR Code using Google Authenticator / Authy app:</p>
                <img src={twoFAData.qr_code} alt="2FA QR Code" className="w-40 h-40 mx-auto bg-white p-2 rounded-xl" />
                <p className="text-[10px] text-slate-400 font-mono mt-2 select-all">Secret: {twoFAData.totp_secret}</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Enter 6-digit FA Code</label>
              <input 
                type="text" 
                required
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="123456"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-emerald-400 tracking-widest text-center font-mono text-xl placeholder-slate-600 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 transition"
              />
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-semibold text-white rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {loading ? 'Verifying Code...' : 'Verify 2FA Code'}
            </button>
            <button 
              type="button" 
              onClick={() => { setStep2FA(null); setTwoFAData(null); }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 mt-2"
            >
              ← Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
