'use client';
import { useEffect, useState } from 'react';
import { Users, ShieldCheck, AppWindow, Lock, Globe } from 'lucide-react';
import { fetchAuthed, getStoredUser } from '@/app/lib/auth';

export default function DashboardPage() {
  const [stats, setStats] = useState({ users: 0, clients: 0, roles: 0, googleEnabled: false, enforce2FA: false });

  useEffect(() => {
    const userObj = getStoredUser();
    if (userObj) {
      const isAdmin = userObj?.is_admin || userObj?.role === 'admin';
      if (!isAdmin) {
        window.location.replace('/dashboard/profile');
        return;
      }
    }

    const fetchData = async () => {
      try {
        const [usersRes, clientsRes, rolesRes, googleRes] = await Promise.all([
          fetchAuthed('/api/v1/admin/users'),
          fetchAuthed('/api/v1/admin/clients'),
          fetchAuthed('/api/v1/admin/roles'),
          fetchAuthed('/api/v1/admin/google-settings')
        ]);

        const users = usersRes.ok ? await usersRes.json() : [];
        const clients = clientsRes.ok ? await clientsRes.json() : [];
        const roles = rolesRes.ok ? await rolesRes.json() : [];
        const google = googleRes.ok ? await googleRes.json() : {};

        setStats({
          users: users.length,
          clients: clients.length,
          roles: roles.length,
          googleEnabled: !!google.is_enabled,
          enforce2FA: !!google.enforce_2fa_all
        });
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      }
    };

    fetchData();
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent mb-2">
        IAM System Overview
      </h1>
      <p className="text-slate-400 mb-8">Identity & Access Control Center - Status Overview</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        <div className="p-6 rounded-3xl bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-400">Total Users</span>
            <Users size={22} className="text-emerald-400/70" />
          </div>
          <p className="text-4xl font-extrabold text-white mt-4">{stats.users}</p>
        </div>

        <div className="p-6 rounded-3xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-indigo-400">Defined Roles</span>
            <ShieldCheck size={22} className="text-indigo-400/70" />
          </div>
          <p className="text-4xl font-extrabold text-white mt-4">{stats.roles}</p>
        </div>

        <div className="p-6 rounded-3xl bg-gradient-to-br from-purple-950/40 via-slate-900 to-slate-900 border border-purple-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-purple-400">Registered Apps</span>
            <AppWindow size={22} className="text-purple-400/70" />
          </div>
          <p className="text-4xl font-extrabold text-white mt-4">{stats.clients}</p>
        </div>

        <div className="p-6 rounded-3xl bg-gradient-to-br from-sky-950/40 via-slate-900 to-slate-900 border border-sky-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-sky-400">Google OAuth</span>
            <Globe size={22} className="text-sky-400/70" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-full ${stats.googleEnabled ? 'bg-sky-400 animate-pulse' : 'bg-rose-500/60'}`}></span>
            <span className="text-xl font-bold text-white">{stats.googleEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        <div className="p-6 rounded-3xl bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-amber-400">Global 2FA Policy</span>
            <Lock size={22} className="text-amber-400/70" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-full ${stats.enforce2FA ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`}></span>
            <span className="text-xl font-bold text-white">{stats.enforce2FA ? 'Enforced' : 'Optional'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
