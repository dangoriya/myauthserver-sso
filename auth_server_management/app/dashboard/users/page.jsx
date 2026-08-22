'use client';
import { useEffect, useState, useCallback } from 'react';
import TailwindSelect from '@/app/components/TailwindSelect';
import TailwindCheckbox from '@/app/components/TailwindCheckbox';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Enforce 2FA Step-Up for ALL Users (moved from Google OAuth & 2FA menu)
  const [enforce2FAAll, setEnforce2FAAll] = useState(false);
  const [enforceLoading, setEnforceLoading] = useState(false);

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
  const [edit2FA, setEdit2FA] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState('');

  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';

  const fetchEnforce2FA = async () => {
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/google-settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEnforce2FAAll(!!data.enforce_2fa_all);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleEnforce2FAAll = async (checked) => {
    setEnforceLoading(true);
    const token = localStorage.getItem('admin_token');
    try {
      const gRes = await fetch(`${authServerUrl}/api/v1/admin/google-settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const gData = gRes.ok ? await gRes.json() : {};

      await fetch(`${authServerUrl}/api/v1/admin/google-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          client_id: gData.client_id || '',
          client_secret: gData.client_secret || '',
          redirect_uri: gData.redirect_uri || 'http://localhost:8000/auth/google/callback',
          is_enabled: !!gData.is_enabled,
          enforce_2fa_all: checked
        })
      });
      setEnforce2FAAll(checked);
    } catch (err) {
      console.error(err);
    } finally {
      setEnforceLoading(false);
    }
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('admin_token');
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (roleFilter) params.append('role', roleFilter);
      if (statusFilter) params.append('is_active', statusFilter === 'active');

      const res = await fetch(`${authServerUrl}/api/v1/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [authServerUrl, searchQuery, roleFilter, statusFilter]);

  const fetchRoles = async () => {
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/roles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setRoles(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchRoles();
    fetchEnforce2FA();
  }, [fetchUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          email, 
          name, 
          picture,
          password, 
          role: userRole, 
          is_admin: userRole === 'admin',
          is_2fa_enabled: is2FAEnabled 
        })
      });

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
    setEdit2FA(!!user.is_2fa_enabled);
    setEditActive(!!user.is_active);
    setEditError('');
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError('');
    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch(`${authServerUrl}/api/v1/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editName,
          picture: editPicture,
          role: editRole,
          is_admin: editRole === 'admin',
          is_2fa_enabled: edit2FA,
          is_active: editActive
        })
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

  const toggleUserStatus = async (user) => {
    const token = localStorage.getItem('admin_token');
    await fetch(`${authServerUrl}/api/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ is_active: !user.is_active })
    });
    fetchUsers();
  };

  const resetUser2FA = async (user) => {
    const token = localStorage.getItem('admin_token');
    await fetch(`${authServerUrl}/api/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ reset_2fa: true })
    });
    fetchUsers();
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

      {/* Enforce Global 2FA Policy Card (Moved here as requested) */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center font-bold text-lg">
            🔐
          </div>
          <div>
            <h3 className="font-semibold text-amber-300 text-sm">Enforce 2FA Step-up for ALL Users</h3>
            <p className="text-xs text-slate-400">Mandate two-factor TOTP authentication for every user logging into IAM system</p>
          </div>
        </div>
        <TailwindCheckbox
          id="enforce-2fa-all-users"
          checked={enforce2FAAll}
          onChange={(e) => handleToggleEnforce2FAAll(e.target.checked)}
          color="amber"
          disabled={enforceLoading}
        />
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
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${u.is_2fa_enabled ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400'}`}>
                      {u.is_2fa_enabled ? 'Active' : 'Off'}
                    </span>
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
                        onClick={() => toggleUserStatus(u)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition ${u.is_active ? 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10' : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'}`}
                      >
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
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
                  id="edit-2fa-enabled"
                  checked={edit2FA}
                  onChange={(e) => setEdit2FA(e.target.checked)}
                  label="Enforce 2FA Step-Up for this user"
                  color="amber"
                />
                <TailwindCheckbox
                  id="edit-active-status"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  label="User Account Active Status"
                  color="emerald"
                />

                {editingUser?.has_2fa_configured && (
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-400">2FA Key Configured:</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm(`Reset 2FA configuration for ${editingUser.email}?`)) {
                          await resetUser2FA(editingUser);
                          setEditingUser(null);
                        }
                      }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-medium"
                    >
                      Reset 2FA Secret Key
                    </button>
                  </div>
                )}
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
    </div>
  );
}
