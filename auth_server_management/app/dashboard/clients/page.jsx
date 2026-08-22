'use client';
import { useEffect, useState } from 'react';

export default function ClientAppsPage() {
  const [clients, setClients] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [clientName, setClientName] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [isSsoEnabled, setIsSsoEnabled] = useState(true);

  const fetchClients = async () => {
    const token = localStorage.getItem('admin_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/clients`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setClients(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleCreateClient = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('admin_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

    await fetch(`${authServerUrl}/api/v1/admin/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: redirectUris,
        is_sso_enabled: isSsoEnabled
      })
    });

    setShowModal(false);
    setClientName('');
    setRedirectUris('');
    setIsSsoEnabled(true);
    fetchClients();
  };

  const handleDeleteClient = async (clientId) => {
    if (!confirm('Are you sure you want to delete this app registration?')) return;
    const token = localStorage.getItem('admin_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

    await fetch(`${authServerUrl}/api/v1/admin/clients/${clientId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchClients();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Registered Client Applications</h1>
          <p className="text-slate-400 text-sm">Configure internal apps that trust this Central SSO Auth Server</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-gradient-to-r from-indigo-400 to-purple-500 font-semibold text-white rounded-xl hover:opacity-90 transition shadow-lg shadow-indigo-500/20"
        >
          + Register New App
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {clients.map((c) => (
          <div key={c.id} className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-xl font-bold text-slate-100">{c.client_name}</h3>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${c.is_sso_enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
                  {c.is_sso_enabled ? 'SSO Enabled' : 'SSO Disabled'}
                </span>
              </div>

              <div className="space-y-2 text-xs font-mono bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-300 my-4">
                <div>
                  <span className="text-slate-500 block">Client ID:</span>
                  <span className="text-emerald-400">{c.client_id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Client Secret:</span>
                  <span className="text-indigo-400">{c.client_secret}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Redirect URIs:</span>
                  <span className="text-purple-400">{c.redirect_uris}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleDeleteClient(c.client_id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition"
              >
                Delete Client
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Register Client App</h2>
            <form onSubmit={handleCreateClient} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Application Name</label>
                <input type="text" required value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="App 1 (app1.xyz.com)" className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Redirect URIs (comma separated)</label>
                <input type="text" required value={redirectUris} onChange={(e) => setRedirectUris(e.target.value)} placeholder="http://localhost:3001/callback" className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="ssoCheck" checked={isSsoEnabled} onChange={(e) => setIsSsoEnabled(e.target.checked)} className="rounded border-slate-700 text-indigo-400" />
                <label htmlFor="ssoCheck" className="text-sm text-slate-300">Enable Single Sign-On (SSO)</label>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-xl font-medium">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-gradient-to-r from-indigo-400 to-purple-500 text-white font-semibold rounded-xl">Register App</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
