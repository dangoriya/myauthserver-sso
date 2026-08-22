'use client';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const [stats, setStats] = useState({ users: 0, clients: 0, googleEnabled: false });

  useEffect(() => {
    const fetchData = async () => {
      const token = localStorage.getItem('admin_token');
      const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
      try {
        const [usersRes, clientsRes, googleRes] = await Promise.all([
          fetch(`${authServerUrl}/api/v1/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${authServerUrl}/api/v1/admin/clients`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${authServerUrl}/api/v1/admin/google-settings`, { headers: { Authorization: `Bearer ${token}` } })
        ]);

        const users = usersRes.ok ? await usersRes.json() : [];
        const clients = clientsRes.ok ? await clientsRes.json() : [];
        const google = googleRes.ok ? await googleRes.json() : {};

        setStats({
          users: users.length,
          clients: clients.length,
          googleEnabled: !!google.is_enabled
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
        System Overview
      </h1>
      <p className="text-slate-400 mb-8">Central Authentication Server & SSO Status</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-400">Total Users</span>
            <span className="text-2xl">👥</span>
          </div>
          <p className="text-4xl font-extrabold text-white mt-4">{stats.users}</p>
        </div>

        <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-indigo-400">Registered Apps</span>
            <span className="text-2xl">📱</span>
          </div>
          <p className="text-4xl font-extrabold text-white mt-4">{stats.clients}</p>
        </div>

        <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-950/40 via-slate-900 to-slate-900 border border-purple-500/20 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-purple-400">Google OAuth</span>
            <span className="text-2xl">⚡</span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-full ${stats.googleEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></span>
            <span className="text-2xl font-bold text-white">{stats.googleEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
