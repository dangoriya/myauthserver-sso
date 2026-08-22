'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  // Wizard Step: 1 = Email/Name, 2 = Verify Code, 3 = Password Setup, 4 = Optional 2FA Setup
  const [step, setStep] = useState(1);

  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 2FA Setup state
  const [twoFADetails, setTwoFADetails] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [registeredUser, setRegisteredUser] = useState(null);
  const [userToken, setUserToken] = useState(null);

  // Google OAuth state
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Check Google OAuth Settings on mount
  useEffect(() => {
    async function checkGoogleSettings() {
      try {
        const res = await fetch(`${authServerUrl}/api/v1/admin/google-settings`);
        if (res.ok) {
          const data = await res.json();
          setGoogleEnabled(!!data.is_enabled);
        }
      } catch (e) {
        // ignore error
      }
    }
    checkGoogleSettings();
  }, [authServerUrl]);

  // Step 1: Request Verification Code
  const handleRequestCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/auth/signup/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to send verification code');
      }

      setSuccessMsg(`Verification code sent to ${email}. Please check your inbox.`);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify Code
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/auth/signup/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid verification code');
      }

      setSuccessMsg('Email verified successfully! Now set a secure password.');
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Password Setup & Complete Signup
  const handleCompleteSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/auth/signup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          password,
          code: verificationCode
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to complete signup');
      }

      const data = await res.json();
      setUserToken(data.access_token);
      setRegisteredUser(data.user);

      // Save token and user details in localStorage
      localStorage.setItem('admin_token', data.access_token);
      localStorage.setItem('admin_user', JSON.stringify(data.user));

      if (data.two_fa_setup) {
        setTwoFADetails(data.two_fa_setup);
        setStep(4); // Move to Optional 2FA setup step
      } else {
        const isAdmin = data.user?.is_admin || data.user?.role === 'admin';
        router.push(isAdmin ? '/dashboard' : '/dashboard/profile');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Optional 2FA Activation
  const handleEnable2FA = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/auth/signup/2fa-enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: registeredUser.id,
          totp_code: totpCode
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Invalid 2FA code');
      }

      // Update user 2FA state
      const updatedUser = { ...registeredUser, is_2fa_enabled: true };
      localStorage.setItem('admin_user', JSON.stringify(updatedUser));

      const isAdmin = updatedUser?.is_admin || updatedUser?.role === 'admin';
      router.push(isAdmin ? '/dashboard' : '/dashboard/profile');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip2FA = () => {
    const isAdmin = registeredUser?.is_admin || registeredUser?.role === 'admin';
    router.push(isAdmin ? '/dashboard' : '/dashboard/profile');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-emerald-950">
      <div className="max-w-lg w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 bg-gradient-to-tr from-emerald-400 via-teal-400 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/20 font-bold text-xl text-white">
            IAM
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-teal-200 to-indigo-300 bg-clip-text text-transparent">
            {step === 4 ? 'Setup 2FA Security' : 'Create IAM Account'}
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            {step === 1 && 'Step 1 of 3: Enter your details to receive an email verification code'}
            {step === 2 && 'Step 2 of 3: Verify your email address'}
            {step === 3 && 'Step 3 of 3: Create a secure password for your account'}
            {step === 4 && 'Optional: Secure your account with Two-Factor Authentication'}
          </p>
        </div>

        {/* Step Indicator Pills */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                step === i
                  ? 'w-8 bg-emerald-400 shadow-sm shadow-emerald-400/50'
                  : step > i
                  ? 'w-4 bg-emerald-500/50'
                  : 'w-4 bg-slate-800'
              }`}
            />
          ))}
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs text-center">
            {successMsg}
          </div>
        )}

        {/* STEP 1: Enter Name & Email */}
        {step === 1 && (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-semibold text-white text-sm rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {loading ? 'Sending Code...' : 'Send Email Verification Code →'}
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
                  Sign Up with Google
                </a>
              </>
            )}
          </form>
        )}

        {/* STEP 2: Verify Code */}
        {step === 2 && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Enter 6-Digit Email Verification Code</label>
              <input
                type="text"
                required
                maxLength={6}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="123456"
                className="w-full px-4 py-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-emerald-400 tracking-widest text-center font-mono text-2xl placeholder-slate-600 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-3 px-4 bg-slate-800 text-slate-300 text-sm rounded-xl hover:bg-slate-700 font-medium"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={loading || verificationCode.length < 6}
                className="flex-1 py-3.5 bg-gradient-to-r from-emerald-500 to-indigo-600 font-semibold text-white text-sm rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify Code & Proceed'}
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: Password Creation */}
        {step === 3 && (
          <form onSubmit={handleCompleteSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Create Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-slate-800/60 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPassword ? '👁️' : '🙈'}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400">
              ℹ️ Default Role: <strong className="text-emerald-400 font-mono">normal-user</strong> (role can be updated by administrators).
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-semibold text-white text-sm rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Complete Registration'}
            </button>
          </form>
        )}

        {/* STEP 4: Optional 2FA Step-by-Step Setup */}
        {step === 4 && twoFADetails && (
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-emerald-400 border-b border-slate-800 pb-2">
                📱 Step-by-Step Mobile 2FA Guide
              </h3>

              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                <li>Open <strong>Google Authenticator</strong>, <strong>Authy</strong>, or 1Password on your phone.</li>
                <li>Scan the QR code below OR manually add account details.</li>
              </ol>

              {/* QR Code */}
              <div className="text-center py-2">
                <div className="p-3 bg-white rounded-2xl inline-block shadow-md">
                  <img src={twoFADetails.qr_code} alt="2FA QR Code" className="w-36 h-36 mx-auto" />
                </div>
              </div>

              {/* Manual Setup Information */}
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5 font-mono">
                <p className="text-slate-400">Service Name: <span className="text-white font-bold">{twoFADetails.service_name}</span></p>
                <p className="text-slate-400">Account: <span className="text-white font-bold">{twoFADetails.account_name}</span></p>
                <p className="text-slate-400">Secret Key: <span className="text-amber-300 font-bold select-all">{twoFADetails.totp_secret}</span></p>
              </div>
            </div>

            <form onSubmit={handleEnable2FA} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Verify 6-Digit App Code</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-emerald-400 font-mono text-center tracking-widest text-xl focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSkip2FA}
                  className="py-3 px-4 bg-slate-800 text-slate-400 text-xs rounded-xl hover:text-white font-medium"
                >
                  Skip for Now
                </button>
                <button
                  type="submit"
                  disabled={loading || totpCode.length < 6}
                  className="flex-1 py-3 bg-emerald-500 text-slate-950 font-bold text-sm rounded-xl hover:opacity-95 transition disabled:opacity-50"
                >
                  {loading ? 'Activating...' : 'Activate 2FA & Go to Dashboard'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Footer Link */}
        <div className="text-center pt-2 border-t border-slate-800/80">
          <p className="text-xs text-slate-400">
            Already have an account?{' '}
            <Link href="/" className="text-emerald-400 hover:underline font-semibold">
              Sign In to IAM
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
}
