'use client';
import { useEffect, useState } from 'react';
import { Edit, Trash2 } from 'lucide-react';
import TailwindCheckbox from '@/app/components/TailwindCheckbox';
import { fetchAuthed } from '@/app/lib/auth';

function renderUriList(uris, placeholder = 'None configured') {
  if (!uris) {
    return (
      <span className="text-slate-600 italic font-sans text-xs">{placeholder}</span>
    );
  }
  const items = uris.split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) {
    return (
      <span className="text-slate-600 italic font-sans text-xs">{placeholder}</span>
    );
  }
  return items.map((uri, idx) => (
    <div
      key={idx}
      className="text-purple-400 break-all select-all leading-relaxed"
    >
      {uri}
    </div>
  ));
}

export default function ClientAppsPage() {
  const [clients, setClients] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingClientId, setEditingClientId] = useState(null);

  // Form state
  const [clientName, setClientName] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [postLogoutUris, setPostLogoutUris] = useState('');
  const [enablePostLogout, setEnablePostLogout] = useState(false);
  const [backchannelUris, setBackchannelUris] = useState('');
  const [enableBackchannel, setEnableBackchannel] = useState(false);
  const [isSsoEnabled, setIsSsoEnabled] = useState(true);

  // Global settings
  const [globalBackchannelEnabled, setGlobalBackchannelEnabled] = useState(false);
  const [globalPostLogoutUrl, setGlobalPostLogoutUrl] = useState('');

  const fetchClients = async () => {
    try {
      const res = await fetchAuthed('/api/v1/admin/clients');
      if (res.ok) setClients(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchGlobalSettings = async () => {
    try {
      const res = await fetchAuthed('/api/v1/admin/global-settings');
      if (res.ok) {
        const data = await res.json();
        setGlobalBackchannelEnabled(!!data.backchannel_logout_enabled);
        setGlobalPostLogoutUrl(data.post_logout_redirect_url || '');
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchClients();
    fetchGlobalSettings();
  }, []);

  const resetForm = () => {
    setClientName('');
    setRedirectUris('');
    setPostLogoutUris('');
    setEnablePostLogout(false);
    setBackchannelUris('');
    setEnableBackchannel(false);
    setIsSsoEnabled(true);
  };

  const openCreateModal = () => {
    resetForm();
    setModalMode('create');
    setEditingClientId(null);
    setShowModal(true);
  };

  const openEditModal = (client) => {
    setClientName(client.client_name || '');
    setRedirectUris(client.redirect_uris || '');
    setPostLogoutUris(client.post_logout_redirect_uris || '');
    setEnablePostLogout(!!(client.post_logout_redirect_uris || '').trim());
    setBackchannelUris(client.backchannel_logout_uris || '');
    setEnableBackchannel(!!client.backchannel_logout_enabled);
    setIsSsoEnabled(!!client.is_sso_enabled);
    setModalMode('edit');
    setEditingClientId(client.client_id);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      client_name: clientName,
      redirect_uris: redirectUris,
      is_sso_enabled: isSsoEnabled,
      post_logout_redirect_uris: enablePostLogout
        ? postLogoutUris
        : null,
      backchannel_logout_uris: enableBackchannel
        ? backchannelUris
        : null,
      backchannel_logout_enabled: enableBackchannel && globalBackchannelEnabled,
    };

    if (modalMode === 'edit') {
      await fetchAuthed(`/api/v1/admin/clients/${editingClientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await fetchAuthed('/api/v1/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    setShowModal(false);
    resetForm();
    fetchClients();
  };

  const handleDeleteClient = async (clientId) => {
    if (!confirm('Are you sure you want to delete this app registration?')) return;
    await fetchAuthed(`/api/v1/admin/clients/${clientId}`, {
      method: 'DELETE',
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
          onClick={openCreateModal}
          className="px-4 py-2.5 bg-gradient-to-r from-indigo-400 to-purple-500 font-semibold text-white rounded-xl hover:opacity-90 transition shadow-lg shadow-indigo-500/20"
        >
          + Register New App
        </button>
      </div>

      {/* Global settings notice */}
      {!globalBackchannelEnabled && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
          <span className="font-medium">Back-channel logout is disabled globally</span> in the auth server.{' '}
          Per-client back-channel logout options are disabled.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {clients.map((c) => (
          <div
            key={c.id}
            className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl shadow-xl flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-xl font-bold text-slate-100">{c.client_name}</h3>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    c.is_sso_enabled
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {c.is_sso_enabled ? 'SSO Enabled' : 'SSO Disabled'}
                </span>
              </div>

              <div className="space-y-3 text-xs font-mono bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-300 my-4 overflow-hidden">
                <div>
                  <span className="text-slate-500 block font-sans text-[11px] uppercase tracking-wider mb-0.5">Client ID</span>
                  <span className="text-emerald-400 break-all font-semibold select-all">{c.client_id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block font-sans text-[11px] uppercase tracking-wider mb-0.5">Client Secret</span>
                  <span className="text-indigo-400 break-all select-all">{c.client_secret}</span>
                </div>
                <div>
                  <span className="text-slate-500 block font-sans text-[11px] uppercase tracking-wider mb-1">Redirect URIs</span>
                  <div className="space-y-1">{renderUriList(c.redirect_uris)}</div>
                </div>
                <div>
                  <span className="text-slate-500 block font-sans text-[11px] uppercase tracking-wider mb-1">Post-Logout Redirect URIs</span>
                  <div className="space-y-1">
                    {renderUriList(c.post_logout_redirect_uris, 'Uses global default')}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 block font-sans text-[11px] uppercase tracking-wider mb-1">Back-Channel Logout</span>
                  <div className="space-y-1">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                        c.backchannel_logout_enabled
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-slate-700/30 text-slate-500 border border-slate-700/30'
                      }`}
                    >
                      {c.backchannel_logout_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {c.backchannel_logout_uris && (
                      <div className="text-purple-400 break-all select-all leading-relaxed mt-1">
                        {c.backchannel_logout_uris}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => openEditModal(c)}
                className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 transition flex items-center gap-1.5"
              >
                <Edit size={12} />
                Edit
              </button>
              <button
                onClick={() => handleDeleteClient(c.client_id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition flex items-center gap-1.5"
              >
                <Trash2 size={12} />
                Delete Client
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-lg w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-white mb-4">
              {modalMode === 'edit' ? 'Edit Client App' : 'Register Client App'}
            </h2>

            {/* Global post-logout URL hint */}
            {globalPostLogoutUrl && (
              <div className="mb-4 p-2.5 bg-slate-800/50 border border-slate-700 rounded-xl">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-sans">
                  Global Post-Logout Redirect URL
                </span>
                <div className="text-xs text-slate-400 font-mono break-all mt-0.5">
                  {globalPostLogoutUrl}
                </div>
                <span className="text-[10px] text-slate-500 block mt-1">
                  Used as fallback when no client-specific post-logout URIs are set.
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Application Name</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="App 1 (app1.xyz.com)"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Redirect URIs (comma separated)</label>
                <input
                  type="text"
                  required
                  value={redirectUris}
                  onChange={(e) => setRedirectUris(e.target.value)}
                  placeholder="http://localhost:3001/callback"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div className="pt-1">
                <TailwindCheckbox
                  id="ssoCheck"
                  checked={isSsoEnabled}
                  onChange={(e) => setIsSsoEnabled(e.target.checked)}
                  label="Enable Single Sign-On (SSO)"
                  color="indigo"
                />
              </div>

              {/* Post-Logout Redirect URIs */}
              <div className="border-t border-slate-800 pt-3">
                <TailwindCheckbox
                  id="postLogoutCheck"
                  checked={enablePostLogout}
                  onChange={(e) => setEnablePostLogout(e.target.checked)}
                  label="Enable custom Post-Logout Redirect URIs"
                  description="When disabled, the client uses the global default URL."
                  color="indigo"
                />
                {enablePostLogout && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={postLogoutUris}
                      onChange={(e) => setPostLogoutUris(e.target.value)}
                      placeholder="https://app1.com/logout-callback"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      Comma-separated list of URIs the user can be redirected back to after logout.
                    </p>
                  </div>
                )}
              </div>

              {/* Back-Channel Logout */}
              <div className="border-t border-slate-800 pt-3">
                <TailwindCheckbox
                  id="backchannelCheck"
                  checked={enableBackchannel && globalBackchannelEnabled}
                  onChange={(e) => setEnableBackchannel(e.target.checked)}
                  label="Enable Back-Channel Logout"
                  description={
                    globalBackchannelEnabled
                      ? 'Send signed logout tokens to client endpoints on central logout.'
                      : 'Globally disabled in auth server settings.'
                  }
                  color="rose"
                  disabled={!globalBackchannelEnabled}
                />
                {enableBackchannel && globalBackchannelEnabled && (
                  <div className="mt-3">
                    <label className="block text-xs text-slate-400 mb-1">
                      Back-Channel Logout URIs (comma separated)
                    </label>
                    <input
                      type="text"
                      value={backchannelUris}
                      onChange={(e) => setBackchannelUris(e.target.value)}
                      placeholder="https://app1.com/backchannel-logout"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      Absolute URIs that receive HTTP POST logout_token when the central session ends.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-gradient-to-r from-indigo-400 to-purple-500 text-white font-semibold rounded-xl"
                >
                  {modalMode === 'edit' ? 'Save Changes' : 'Register App'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
