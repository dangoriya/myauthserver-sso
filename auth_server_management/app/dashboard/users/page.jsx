'use client';
import { useEffect, useState, useCallback } from 'react';
import TailwindSelect from '@/app/components/TailwindSelect';
import TailwindCheckbox from '@/app/components/TailwindCheckbox';
import TailwindModal from '@/app/components/TailwindModal';
import { fetchAuthed, getStoredUser } from '@/app/lib/auth';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);

  // Enforce 2FA Step-Up for ALL Users (moved from Google OAuth & 2FA menu)
  const [enforce2FAAll, setEnforce2FAAll] = useState(false);
  const [enforceLoading, setEnforceLoading] = useState(false);
  // Pending toggle action (shown in TailwindModal before committing)
  const [pendingEnforce, setPendingEnforce] = useState(null); // { action: 'enforce' | 'disable' }

  // Real-time backend filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Create User Modal state
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [picture, setPicture] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [userRole, setUserRole] = useState('normal-user');
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [error, setError] = useState('');

  // Edit User Modal state
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPicture, setEditPicture] = useState('');
  const [editRole, setEditRole] = useState('normal-user');
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState('');

  // Current logged-in user (for admin-only action visibility)
  const [currentUser, setCurrentUser] = useState(null);
  const isAdmin = currentUser?.is_admin || currentUser?.role === 'admin';

  // Confirmation modal states for destructive actions
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [reset2FAConfirmUser, setReset2FAConfirmUser] = useState(null);
  const [disableConfirmUser, setDisableConfirmUser] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // 'delete' | 'reset-2fa' | 'disable' | null

  const fetchEnforce2FA = async () => {
    try {
      const res = await fetchAuthed('/api/v1/admin/google-settings');
      if (res.ok) {
        const data = await res.json();
        setEnforce2FAAll(!!data.enforce_2fa_all);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Open the confirmation modal for enforce/disable actions
  const requestToggleEnforce2FAAll = (action) => {
    setPendingEnforce({ action });
  };

  const cancelEnforceToggle = () => {
    if (enforceLoading) return;
    setPendingEnforce(null);
  };

  const handleToggleEnforce2FAAll = async (action) => {
    setEnforceLoading(true);
    const checked = action === 'enforce';
    try {
      const gRes = await fetchAuthed('/api/v1/admin/google-settings');
      const gData = gRes.ok ? await gRes.json() : {};

      const saveRes = await fetchAuthed('/api/v1/admin/google-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: gData.client_id || '',
          client_secret: gData.client_secret || '',
          redirect_uri: gData.redirect_uri || 'http://localhost:8000/auth/google/callback',
          is_enabled: !!gData.is_enabled,
          enforce_2fa_all: checked
        })
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update 2FA enforcement');
      }
      const saveData = await saveRes.json();
      setEnforce2FAAll(checked);
      setPendingEnforce(null);

      await fetchUsers();
    } catch (err) {
      console.error(err);
      await fetchEnforce2FA();
    } finally {
      setEnforceLoading(false);
    }
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (roleFilter) params.append('role', roleFilter);
      if (statusFilter) params.append('is_active', statusFilter === 'active');

      const res = await fetchAuthed(`/api/v1/admin/users?${params.toString()}`);
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter]);

  const fetchRoles = async () => {
    try {
      const res = await fetchAuthed('/api/v1/admin/roles');
      if (res.ok) setRoles(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    setCurrentUser(getStoredUser());
    fetchUsers();
    fetchRoles();
    fetchEnforce2FA();
  }, [fetchUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetchAuthed('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          picture,
          password,
          roles: userRole,
          is_2fa_enabled: is2FAEnabled,
          is_2fa_activated: false  // New users start with 2FA not activated
        })
      })

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to create user');
      }

      setShowModal(false);
      setEmail('');
      setName('');
      setPicture('');
      setPassword('');
      setUserRole('normal-user');
      setIs2FAEnabled(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setEditName(user.name || '');
    setEditPicture(user.picture || '');
    setEditRole(user.role || 'normal-user');
    setEditActive(!!user.is_active);
    setEditError('');
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError('');

    // Only update basic profile fields (2FA is handled by separate buttons)
    const payload = {
      name: editName,
      picture: editPicture,
      roles: editRole,
      is_active: editActive
    };

    try {
      const res = await fetchAuthed(`/api/v1/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to update user');
      }

      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      setEditError(err.message);
    }
  };

  const confirmDisableUser = async () => {
    if (!disableConfirmUser) return;
    setActionLoading('disable');
    try {
      const res = await fetchAuthed(`/api/v1/admin/users/${disableConfirmUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !disableConfirmUser.is_active })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update user status');
      }
      fetchUsers();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
      setDisableConfirmUser(null);
    }
  };

  const resetUser2FA = async (user) => {
    await fetchAuthed(`/api/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_2fa: true })
    });
    fetchUsers();
  };

  const deleteUser = async (user) => {
    setActionLoading('delete');
    try {
      const res = await fetchAuthed(`/api/v1/admin/users/${user.id}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete user');
      }
      fetchUsers();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
      setDeleteConfirmUser(null);
    }
  };

  const confirmReset2FA = async () => {
    if (!reset2FAConfirmUser) return;
    setActionLoading('reset-2fa');
    try {
      const res = await fetchAuthed(`/api/v1/admin/users/${reset2FAConfirmUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_2fa: true })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to reset 2FA');
      }
      fetchUsers();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
      setReset2FAConfirmUser(null);
    }
  };

  const roleFilterOptions = [
    { value: '', label: 'All Roles' },
    { value: 'admin', label: 'Admin' },
    { value: 'normal-user', label: 'Normal User' },
    ...roles.filter(r => !['admin', 'normal-user'].includes(r.name)).map(r => ({ value: r.name, label: r.label }))
  ];

  const statusFilterOptions = [
    { value: '', label: 'All Status' },
    { value: 'active', label: 'Active' },
    { value: 'disabled', label: 'Disabled' }
  ];

  const userRoleOptions = [
    { value: 'normal-user', label: 'Normal User' },
    { value: 'admin', label: 'Admin' },
    ...roles.filter(r => !['admin', 'normal-user'].includes(r.name)).map(r => ({ value: r.name, label: r.label }))
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">IAM User Management</h1>
          <p className="text-slate-400 text-sm">Manage users, roles, 2FA policies, and credentials</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-gradient-to-r from-emerald-400 via-teal-500 to-indigo-500 font-semibold text-slate-950 rounded-xl hover:opacity-95 transition shadow-lg shadow-emerald-500/20 text-sm flex items-center justify-center gap-2"
        >
          <span>+</span> Add New User
        </button>
      </div>

      {/* Global 2FA Setup Section */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center font-bold text-lg">
            🔐
          </div>
          <div>
            <h3 className="font-semibold text-amber-300 text-sm">Global 2FA Setup</h3>
            <p className="text-xs text-slate-400">Configure two-factor authentication policy for all users</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => requestToggleEnforce2FAAll('enforce')}
            disabled={enforceLoading}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#625e58] to-orange-500 text-white font-semibold text-sm hover:opacity-95 transition shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span>🔒 Enforce 2FA</span>
          </button>
          <button
            onClick={() => requestToggleEnforce2FAAll('disable')}
            disabled={enforceLoading}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-slate-600 to-slate-700 text-slate-200 font-semibold text-sm hover:bg-slate-600/80 transition shadow-lg shadow-slate-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-slate-700"
          >
            <span>⏸️ Disable Temporary</span>
          </button>
        </div>
      </div>

      {/* Real-time Filter Bar (Backend API Filter) */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl shadow-md flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase font-semibold text-slate-400 mb-1">Search User (Real-time)</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
          />
        </div>

        <div className="w-full sm:w-44">
          <label className="block text-[10px] uppercase font-semibold text-slate-400 mb-1">Filter by Role</label>
          <TailwindSelect
            value={roleFilter}
            onChange={(val) => setRoleFilter(val)}
            options={roleFilterOptions}
            placeholder="All Roles"
          />
        </div>

        <div className="w-full sm:w-40">
          <label className="block text-[10px] uppercase font-semibold text-slate-400 mb-1">Status Filter</label>
          <TailwindSelect
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            options={statusFilterOptions}
            placeholder="All Status"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-x-auto shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800/50 text-slate-400 uppercase text-xs">
            <tr>
              <th className="p-4">User Details</th>
              <th className="p-4">Provider</th>
              <th className="p-4">Role</th>
              <th className="p-4">2FA Status</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">Loading users from backend...</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">No matching users found.</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-white font-bold overflow-hidden shrink-0">
                        {u.picture ? (
                          <img src={u.picture} alt={u.name || 'User Avatar'} className="w-full h-full object-cover" />
                        ) : (
                          (u.name || u.email || 'U').charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-200">{u.name || 'No Name'}</p>
                        <p className="text-xs text-slate-400 font-mono">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-slate-300 capitalize">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${u.provider === 'google' ? 'bg-sky-500/10 text-sky-300 border border-sky-500/30' : 'bg-slate-800 text-slate-300'}`}>
                      {u.provider === 'google' ? '🌐 Google' : '🔑 Password'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${u.role === 'admin' || u.is_admin ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                      {u.role || (u.is_admin ? 'Admin' : 'Normal User')}
                    </span>
                  </td>
                  <td className="p-4">
                    {(() => {
                      // 2FA status logic:
                      //   is_2fa_enabled = false → "Off" (grey)
                      //   is_2fa_enabled = true AND is_2fa_activated = true → "Active" (amber)
                      //   is_2fa_enabled = true AND is_2fa_activated = false → "Setup" (blue)
                      if (!u.is_2fa_enabled) {
                        return (
                          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                            Off
                          </span>
                        );
                      }
                      if (u.is_2fa_enabled && u.is_2fa_activated) {
                        return (
                          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                            🔐 Active
                          </span>
                        );
                      }
                      return (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30 inline-flex items-center gap-1">
                          ⚙ Setup
                        </span>
                      );
                    })()}
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${u.is_active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Modern Edit Button in Action Column */}
                      <button
                        onClick={() => openEditModal(u)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 transition flex items-center gap-1 font-medium"
                      >
                        ✏️ Edit
                      </button>

                      <button
                        onClick={() => setDisableConfirmUser(u)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition ${u.is_active ? 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10' : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'}`}
                      >
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>

                      {isAdmin && (
                        <>
                          <button
                            onClick={() => setReset2FAConfirmUser(u)}
                            disabled={actionLoading === 'reset-2fa'}
                            className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20 transition flex items-center gap-1 font-medium"
                            title="Reset 2FA"
                          >
                            🔐 Reset 2FA
                          </button>

                          <button
                            onClick={() => setDeleteConfirmUser(u)}
                            disabled={actionLoading === 'delete'}
                            className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition flex items-center gap-1 font-medium"
                            title="Delete Account"
                          >
                            🗑️ Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setEditingUser(null)}
        >
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-lg w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-xl font-bold text-white">Edit User Profile & Settings</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editingUser.email}</p>
              </div>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            {editError && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{editError}</div>}

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter full name"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Profile Picture URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editPicture}
                    onChange={(e) => setEditPicture(e.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                    className="flex-1 px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {editPicture && (
                    <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 overflow-hidden shrink-0">
                      <img src={editPicture} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Assigned Role</label>
                <TailwindSelect
                  value={editRole}
                  onChange={(val) => setEditRole(val)}
                  options={userRoleOptions}
                  placeholder="Select Role"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <TailwindCheckbox
                  id="edit-active-status"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  label="User Account Active Status"
                  color="emerald"
                />
              </div>

              {/* 2FA Management Section */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Two-Factor Authentication (2FA)
                </h3>
                
                {/* Current 2FA Status */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Current Status:</span>
                  {(() => {
                    if (!editingUser?.is_2fa_enabled) {
                      return <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Off</span>;
                    }
                    if (editingUser?.is_2fa_enabled && editingUser?.is_2fa_activated) {
                      return <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Active</span>;
                    }
                    return <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">Setup</span>;
                  })()}
                  {editingUser?.has_2fa_configured && (
                    <span className="text-slate-500">(Key configured)</span>
                  )}
                </div>

                {/* 2FA Action Buttons */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {!editingUser?.is_2fa_enabled ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Enable 2FA requirement for ${editingUser.email}? User will be prompted to set up 2FA on next login.`)) {
                          fetchAuthed(`/api/v1/admin/users/${editingUser.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enable_2fa: true })
                          }).then(async (res) => {
                            if (res.ok) {
                              fetchUsers();
                              setEditingUser(null);
                            } else {
                              const data = await res.json().catch(() => ({}));
                              setEditError(data.detail || 'Failed to enable 2FA');
                            }
                          });
                        }
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition font-medium"
                      title="Enable 2FA requirement for this user"
                    >
                      ✅ Enable 2FA
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Temporarily disable 2FA requirement for ${editingUser.email}? User will no longer be prompted for 2FA but their configuration will be preserved.`)) {
                            fetchAuthed(`/api/v1/admin/users/${editingUser.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ disable_2fa_temporary: true })
                            }).then(async (res) => {
                              if (res.ok) {
                                fetchUsers();
                                setEditingUser(null);
                              } else {
                                const data = await res.json().catch(() => ({}));
                                setEditError(data.detail || 'Failed to disable 2FA');
                              }
                            });
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition font-medium"
                        title="Temporarily disable 2FA requirement (keeps secret)"
                      >
                        ⏸️ Disable 2FA (Temporary)
                      </button>
                      
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Permanently disable 2FA for ${editingUser.email}? This will remove their 2FA requirement, deactivate 2FA, and clear their TOTP secret.`)) {
                            fetchAuthed(`/api/v1/admin/users/${editingUser.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ disable_2fa_permanent: true })
                            }).then(async (res) => {
                              if (res.ok) {
                                fetchUsers();
                                setEditingUser(null);
                              } else {
                                const data = await res.json().catch(() => ({}));
                                setEditError(data.detail || 'Failed to disable 2FA permanently');
                              }
                            });
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition font-medium"
                        title="Permanently disable 2FA and clear secret"
                      >
                        🗑️ Disable 2FA (Permanent)
                      </button>
                    </>
                  )}

                  {editingUser?.has_2fa_configured && editingUser?.is_2fa_enabled && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Reset 2FA configuration for ${editingUser.email}? User will need to set up 2FA again.`)) {
                          fetchAuthed(`/api/v1/admin/users/${editingUser.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reset_2fa: true })
                          }).then(async (res) => {
                            if (res.ok) {
                              fetchUsers();
                              setEditingUser(null);
                            } else {
                              const data = await res.json().catch(() => ({}));
                              setEditError(data.detail || 'Failed to reset 2FA');
                            }
                          });
                        }
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20 transition font-medium"
                      title="Reset 2FA secret (user must reconfigure)"
                    >
                      🔄 Reset 2FA Secret
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingUser(null)} className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-700">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl text-sm hover:opacity-95 shadow-lg shadow-indigo-500/20">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowModal(false)}
        >
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-white mb-4">Create IAM User</h2>
            {error && <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{error}</div>}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Profile Picture URL (Optional)</label>
                <input
                  type="text"
                  value={picture}
                  onChange={(e) => setPicture(e.target.value)}
                  placeholder="https://example.com/photo.jpg"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
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

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Assigned Role</label>
                <TailwindSelect
                  value={userRole}
                  onChange={(val) => setUserRole(val)}
                  options={userRoleOptions}
                  placeholder="Select Role"
                />
              </div>

              <div className="pt-2">
                <TailwindCheckbox
                  id="create-2fa-enabled"
                  checked={is2FAEnabled}
                  onChange={(e) => setIs2FAEnabled(e.target.checked)}
                  label="Enable 2FA Step-up for user"
                  color="emerald"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-700">Cancel</button>
                <button type="submit" className="flex-1 py-2.5 bg-gradient-to-r from-emerald-400 to-indigo-500 text-slate-950 font-semibold rounded-xl text-sm hover:opacity-95">Save User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm toggle: Global 2FA Setup */}
      <TailwindModal
        open={!!pendingEnforce}
        onClose={cancelEnforceToggle}
        onConfirm={() => handleToggleEnforce2FAAll(pendingEnforce?.action)}
        title={
          pendingEnforce?.action === 'enforce'
            ? 'Enable 2FA for all users?'
            : 'Disable global 2FA enforcement?'
        }
        description={
          pendingEnforce?.action === 'enforce'
            ? 'This will mark every user account as 2FA-required.'
            : 'Global enforcement will be turned off and 2FA requirement will be temporarily disabled for all users.'
        }
        icon={pendingEnforce?.action === 'enforce' ? '🔐' : '🛡️'}
        tone={pendingEnforce?.action === 'enforce' ? 'amber' : 'rose'}
        confirmLabel={pendingEnforce?.action === 'enforce' ? 'Enable 2FA' : 'Disable Temporary'}
        cancelLabel="Cancel"
        loading={enforceLoading}
      >
        {pendingEnforce?.action === 'enforce' ? (
          <ul className="space-y-2 list-disc list-inside text-slate-300">
            <li>Sets <code className="text-amber-300 font-mono">is_2fa_enabled = true</code> on every user account that doesn't already have it.</li>
            <li>On next login, users without a configured TOTP secret will be routed to the 2FA setup page.</li>
            <li>Existing sessions remain valid until expiry.</li>
            <li>Users who already have 2FA activated will continue to use it normally.</li>
          </ul>
        ) : (
          <ul className="space-y-2 list-disc list-inside text-slate-300">
            <li>Sets <code className="text-amber-300 font-mono">is_2fa_enabled = false</code> on all user accounts.</li>
            <li>2FA requirement will be temporarily disabled for all users.</li>
            <li>Individual 2FA configurations (secrets, activation status) are preserved.</li>
            <li>Users can still log in without 2FA until global enforcement is re-enabled.</li>
          </ul>
        )}
      </TailwindModal>

      {/* Delete Account Confirmation Modal (Admin only) */}
      <TailwindModal
        open={!!deleteConfirmUser}
        onClose={() => setDeleteConfirmUser(null)}
        onConfirm={() => deleteUser(deleteConfirmUser)}
        title="Delete User Account?"
        description={`This action cannot be undone. ${deleteConfirmUser?.email || 'user'}`}
        icon="🗑️"
        tone="rose"
        confirmLabel="Delete Account"
        cancelLabel="Cancel"
        loading={actionLoading === 'delete'}
      >
        <ul className="space-y-2 list-disc list-inside text-slate-300">
          <li>Permanently removes the user account and all associated credentials.</li>
          <li>The user will no longer be able to sign in.</li>
          <li>Any active sessions will be invalidated.</li>
        </ul>
      </TailwindModal>

      {/* Disable/Enable User Confirmation Modal (Admin only) */}
      <TailwindModal
        open={!!disableConfirmUser}
        onClose={() => setDisableConfirmUser(null)}
        onConfirm={confirmDisableUser}
        title={disableConfirmUser?.is_active ? 'Disable User Account?' : 'Enable User Account?'}
        description={`This action affects ${disableConfirmUser?.email || 'user'}.`}
        icon={disableConfirmUser?.is_active ? '🚫' : '✅'}
        tone={disableConfirmUser?.is_active ? 'rose' : 'emerald'}
        confirmLabel={disableConfirmUser?.is_active ? 'Disable Account' : 'Enable Account'}
        cancelLabel="Cancel"
        loading={actionLoading === 'disable'}
      >
        <ul className="space-y-2 list-disc list-inside text-slate-300">
          {disableConfirmUser?.is_active ? (
            <>
              <li>Disabling this user prevents them from signing in.</li>
              <li>Active sessions remain valid until they expire.</li>
              <li>The account can be re-enabled at any time from this screen.</li>
            </>
          ) : (
            <>
              <li>Re-enabling this user restores their access immediately.</li>
              <li>The user will be able to sign in again.</li>
            </>
          )}
        </ul>
      </TailwindModal>

      {/* Reset 2FA Confirmation Modal (Admin only) */}
      <TailwindModal
        open={!!reset2FAConfirmUser}
        onClose={() => setReset2FAConfirmUser(null)}
        onConfirm={confirmReset2FA}
        title="Reset 2FA for this user?"
        description={`User will need to set up 2FA again on next login. ${reset2FAConfirmUser?.email || 'user'}`}
        icon="🔐"
        tone="amber"
        confirmLabel="Reset 2FA"
        cancelLabel="Cancel"
        loading={actionLoading === 'reset-2fa'}
      >
        <ul className="space-y-2 list-disc list-inside text-slate-300">
          <li>Clears the current TOTP secret key.</li>
          <li>User will remain 2FA-required but must reconfigure with a new QR code.</li>
          <li>2FA status will show as "Setup" until user completes verification.</li>
        </ul>
      </TailwindModal>
    </div>
  );
}
