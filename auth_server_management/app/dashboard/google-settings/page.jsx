'use client';
import { useEffect, useState } from 'react';

export default function GoogleSettingsPage() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('http://localhost:8000/auth/google/callback');
  const [isEnabled, setIsEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      const token = localStorage.getItem('admin_token');
      const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
      try {
        const res = await fetch(`${authServerUrl}/api/v1/admin/google-settings`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setClientId(data.client_id || '');
          setClientSecret(data.client_secret || '');
          setRedirectUri(data.redirect_uri || 'http://localhost:8000/auth/google/callback');
          setIsEnabled(!!data.is_enabled);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchSettings();

    // Check if returning from Google test callback
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (code) {
        handleTestCodeExchange(code);
      }
    }
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setMessage('');
    const token = localStorage.getItem('admin_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

    const res = await fetch(`${authServerUrl}/api/v1/admin/google-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        is_enabled: isEnabled
      })
    });

    if (res.ok) {
      setMessage('Google OAuth Settings saved successfully!');
    }
  };

  const handleTestIntegration = async () => {
    setTestLoading(true);
    setTestError('');
    setTestResult(null);

    const token = localStorage.getItem('admin_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
    const currentCallback = window.location.origin + window.location.pathname;

    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/google-test/url?redirect_uri=${encodeURIComponent(currentCallback)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to initiate Google test');
      }

      const data = await res.json();
      // Redirect admin to Google auth consent page
      window.location.href = data.auth_url;
    } catch (err) {
      setTestError(err.message);
      setTestLoading(false);
    }
  };

  const handleTestCodeExchange = async (code) => {
    setTestLoading(true);
    setTestError('');
    const token = localStorage.getItem('admin_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
    const currentCallback = window.location.origin + window.location.pathname;

    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/google-test/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          code: code,
          redirect_uri: currentCallback
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Google test code exchange failed');
      }

      const data = await res.json();
      setTestResult(data);
      // Clean query params from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Google OAuth Settings</h1>
        <p className="text-slate-400 text-sm">Configure Google OpenID Connect integration for Central Auth Server</p>
      </div>

      {message && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
          {message}
        </div>
      )}

      {testError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          Test Error: {testError}
        </div>
      )}

      {testResult && (
        <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/60 via-slate-900 to-indigo-950/60 border border-emerald-500/30 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">✓</div>
            <div>
              <h3 className="font-bold text-emerald-400">Google OAuth Test Successful!</h3>
              <p className="text-xs text-slate-300">Received OIDC Tokens directly from Google endpoint.</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-400">Decoded OIDC User Profile (ID Token Claims):</span>
              <pre className="mt-1 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                {JSON.stringify(testResult.decoded_id_token, null, 2)}
              </pre>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-slate-400">Full Raw Tokens Received:</span>
              <pre className="mt-1 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-indigo-300 overflow-x-auto max-h-48">
                {JSON.stringify(testResult.tokens, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl shadow-xl space-y-5">
        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
          <div>
            <h3 className="font-semibold text-slate-200">Enable Google SSO Sign-In</h3>
            <p className="text-xs text-slate-400">Allow users to log in using their Google Workspace / Gmail account</p>
          </div>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="w-5 h-5 rounded border-slate-700 text-purple-400 focus:ring-purple-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Google OAuth Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456789-abc.apps.googleusercontent.com"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Google OAuth Client Secret</label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="GOCSPX-••••••••••••••••"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Authorized Redirect URI</label>
          <input
            type="text"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <p className="text-xs text-slate-500 mt-1">Copy this callback URI into your Google Cloud Console OAuth configuration.</p>
        </div>

        <div className="flex gap-4 pt-2">
          <button
            type="submit"
            className="flex-1 py-3.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 font-semibold text-white rounded-xl hover:opacity-90 transition shadow-lg shadow-purple-500/20"
          >
            Save Configuration
          </button>

          <button
            type="button"
            onClick={handleTestIntegration}
            disabled={testLoading || !clientId || !clientSecret}
            className="py-3.5 px-6 bg-slate-800 border border-slate-700 font-semibold text-emerald-400 hover:bg-slate-700 rounded-xl transition disabled:opacity-40"
          >
            {testLoading ? 'Testing...' : '⚡ Test Google Integration'}
          </button>
        </div>
      </form>
    </div>
  );
}

