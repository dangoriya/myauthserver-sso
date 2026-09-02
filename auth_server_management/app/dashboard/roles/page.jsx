'use client';
import { useEffect, useState } from 'react';
import { fetchAuthed } from '@/app/lib/auth';

export default function RolesManagementPage() {
  const [roles, setRoles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  // Delete confirmation modal state
  const [roleToDelete, setRoleToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchRoles = async () => {
    try {
      const res = await fetchAuthed('/api/v1/admin/roles');
      if (res.ok) setRoles(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleCreateRole = async (e) => {
    e.preventDefault();
    setError('');

    // Automatically calculate sort order (auto increment)
    const nextSortOrder = roles.length > 0 ? Math.max(...roles.map(r => r.sort_order || 0)) + 1 : 1;

    try {
      const res = await fetchAuthed('/api/v1/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().toLowerCase().replace(/\s+/g, '-'),
          label: label.trim(),
          description: description.trim(),
          sort_order: nextSortOrder
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to create role');
      }

      setShowModal(false);
      setName('');
      setLabel('');
      setDescription('');
      fetchRoles();
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmDeleteRole = (role) => {
    setRoleToDelete(role);
  };

  const handleExecuteDeleteRole = async () => {
    if (!roleToDelete) return;
    setIsDeleting(true);
    try {
      await fetchAuthed(`/api/v1/admin/roles/${roleToDelete.id}`, {
        method: 'DELETE',
      });
      setRoleToDelete(null);
      fetchRoles();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredRoles = roles.filter(r => 
    r.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.label?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">IAM Roles Management</h1>
          <p className="text-slate-400 text-sm">Define system roles and permission sets for user access</p>
        </div>

        {/* Header Action Controls: Search Bar & Add Role Button */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search roles..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-400"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-400 via-teal-500 to-indigo-500 font-semibold text-slate-950 rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 text-sm flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>+</span> Add New Role
          </button>
        </div>
      </div>

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredRoles.map((r) => (
          <div key={r.id} className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl shadow-xl space-y-4 flex flex-col justify-between hover:border-slate-700 transition">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                  {r.name}
                </span>

                {/* Display Active Users count for each role */}
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <span>👥</span> {r.active_user_count ?? 0} Active Users
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-white">{r.label}</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{r.description || 'No description provided.'}</p>
              </div>
            </div>

            {!['admin', 'normal-user'].includes(r.name) && (
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Total Users: {r.total_user_count ?? 0}</span>
                <button
                  onClick={() => confirmDeleteRole(r)}
                  className="text-xs text-rose-400 hover:text-rose-300 font-medium px-2.5 py-1 rounded-lg hover:bg-rose-500/10 transition"
                >
                  Delete Role
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Delete Confirmation Modal (Informs user about associated user disabling) */}
      {roleToDelete && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setRoleToDelete(null)}
        >
          <div className="bg-slate-900 border border-rose-500/30 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-lg shrink-0">⚠️</div>
              <div>
                <h3 className="font-bold text-rose-400 text-base">Delete Role Warning</h3>
                <p className="text-xs text-slate-400">Action cannot be undone</p>
              </div>
            </div>

            <p className="text-sm text-slate-300">
              Are you sure you want to delete role <strong className="text-white">{roleToDelete.label}</strong> ({roleToDelete.name})?
            </p>

            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
              🚨 <strong>Important:</strong> Deleting this role will automatically disable all <strong>{roleToDelete.total_user_count || 0} associated user(s)</strong> (including {roleToDelete.active_user_count || 0} active users).
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRoleToDelete(null)}
                className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteDeleteRole}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-rose-600 text-white font-semibold rounded-xl text-sm hover:bg-rose-500 transition shadow-lg shadow-rose-600/30 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Disable Users & Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Role Modal (Auto-increment order number, no manual order input needed) */}
      {showModal && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowModal(false)}
        >
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-white">Create New IAM Role</h2>
            {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{error}</div>}

            <form onSubmit={handleCreateRole} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Role Key Name (System identifier)</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. manager"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Role Display Label</label>
                <input
                  type="text"
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Team Manager"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Role privileges description..."
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 h-20"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-700">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 bg-gradient-to-r from-emerald-400 to-indigo-500 text-slate-950 font-semibold rounded-xl text-sm hover:opacity-95">Save Role</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
