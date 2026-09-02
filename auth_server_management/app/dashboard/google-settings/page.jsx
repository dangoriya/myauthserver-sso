'use client';
import { useEffect, useState } from 'react';
import TailwindCheckbox from '@/app/components/TailwindCheckbox';
import { fetchAuthed } from '@/app/lib/auth';

export default function GoogleSettingsPage() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [redirectUri, setRedirectUri] = useState('http://localhost:8000/auth/google/callback');
  const [isEnabled, setIsEnabled] = useState(false);
  const [enforce2FAAll, setEnforce2FAAll] = useState(false);
  
  const [message, setMessage] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');
  const [showTestModal, setShowTestModal] = useState(false);
  const [requiredRedirectUri, setRequiredRedirectUri] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetchAuthed('/api/v1/admin/google-settings');
        if (res.ok) {
          const data = await res.json();
          setClientId(data.client_id || '');
          setClientSecret(data.client_secret || '');
          setRedirectUri(data.redirect_uri || 'http://localhost:8000/auth/google/callback');
          setIsEnabled(!!data.is_enabled);
          setEnforce2FAAll(!!data.enforce_2fa_all);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setMessage('');

    const res = await fetchAuthed('/api/v1/admin/google-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        is_enabled: isEnabled,
        enforce_2fa_all: enforce2FAAll
      })
    });

    if (res.ok) {
      setMessage('OAuth and 2FA settings saved successfully!');
    }
  };

  const handleTestIntegration = async () => {
    setTestLoading(true);
    setTestError('');
    setTestResult(null);

    const postbackUrl = window.location.origin + window.location.pathname;

    try {
      const res = await fetchAuthed(
        `/api/v1/admin/google-test/url?redirect_uri=${encodeURIComponent(postbackUrl)}`
      );

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to initiate Google test');
      }

      const data = await res.json();
      if (data.required_redirect_uri) {
        setRequiredRedirectUri(data.required_redirect_uri);
      }
      window.location.href = data.auth_url;
    } catch (err) {
      setTestError(err.message);
      setTestLoading(false);
    }
  };

  const handleTestCodeExchange = async (code) => {
    setTestLoading(true);
    setTestError('');

    try {
      const res = await fetchAuthed('/api/v1/admin/google-test/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: window.location.origin + window.location.pathname,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Google test code exchange failed');
      }

      const data = await res.json();
      setTestResult(data);
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestLoading(false);
    }
  };

  // On mount, check for ?test_code=... (auth_server postback) or
  // ?test_error=... and run the exchange automatically.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const testCode = urlParams.get('test_code');
    const testError = urlParams.get('test_error');
    if (testError) {
      setTestError(decodeURIComponent(testError));
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    if (testCode) {
      handleTestCodeExchange(testCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Google OAuth & Global 2FA Configuration</h1>
        <p className="text-slate-400 text-sm">Configure Google OpenID Connect integration and global security policies for IAM Auth Server</p>
      </div>

      {message && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-medium">
          {message}
        </div>
      )}

      {testError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          Test Error: {testError}
        </div>
      )}

      <form onSubmit={handleSave} className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl shadow-xl space-y-6">
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-200 text-sm">Enable Google SSO Sign-In</h3>
            <p className="text-xs text-slate-400">Allow users to log in using their Google Workspace / Gmail account</p>
          </div>
          <TailwindCheckbox
            id="google-sso-enabled"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            color="emerald"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
            Google OAuth Client ID <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456789-abc.apps.googleusercontent.com"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
            Google OAuth Client Secret <span className="text-rose-400">*</span>
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              required
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-••••••••••••••••"
              className="w-full px-4 py-3 pr-10 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <button 
              type="button" 
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showSecret ? '👁️' : '🙈'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
            Authorized Redirect URI <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <p className="text-xs text-slate-500 mt-1">Copy this callback URI into your Google Cloud Console OAuth configuration.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <button
            type="submit"
            className="flex-1 py-3.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-semibold text-white rounded-xl hover:opacity-90 transition shadow-lg shadow-emerald-500/20 text-sm"
          >
            Save Configuration
          </button>

          <button
            type="button"
            onClick={handleTestIntegration}
            disabled={testLoading || !clientId || !clientSecret}
            className="py-3.5 px-6 bg-slate-800 border border-slate-700 font-semibold text-emerald-400 hover:bg-slate-700 rounded-xl transition text-sm disabled:opacity-40"
          >
            {testLoading ? 'Testing...' : '⚡ Test Google Integration'}
          </button>
        </div>

      </form>

      {/* Test Integration Result — persistent card, stays visible until cleared */}
      {testResult && (
        <div className="p-6 rounded-3xl bg-slate-900 border border-emerald-500/40 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-lg">✓</div>
              <div>
                <h3 className="font-bold text-emerald-400">Google OAuth Integration Test Result</h3>
                <p className="text-xs text-slate-400">Tokens & ID Claims successfully retrieved from Google endpoints</p>
              </div>
            </div>
            {/* Clear Results — removes the result card entirely */}
            <button
              onClick={() => setTestResult(null)}
              className="text-slate-400 hover:text-rose-300 text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-rose-500/30 transition"
            >
              Clear Results
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-400">Decoded ID Token Claims:</span>
              <pre className="mt-1 p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                {JSON.stringify(testResult?.decoded_id_token, null, 2)}
              </pre>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-slate-400">Raw Google Tokens:</span>
              <pre className="mt-1 p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-indigo-300 overflow-x-auto max-h-48">
                {JSON.stringify(testResult?.tokens, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


