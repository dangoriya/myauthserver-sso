'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  AppWindow,
  Settings,
  UserCircle,
  LogOut,
  Menu,
  X,
  UserCheck,
} from 'lucide-react';
import {
  fetchAuthed,
  getStoredUser,
  centralLogout,
} from '@/app/lib/auth';

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // ----- Initial auth check -----
  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace('/');
      return;
    }
    setCurrentUser(user);
    setIsAuthenticated(true);
    setIsCheckingAuth(false);
  }, [router]);

  // ----- Periodic /oauth/session/active ping -----
  // Once the central auth server has revoked this user's refresh
  // tokens, the access token we still hold will eventually be
  // rejected (after the auth server flushes) and the next refresh
  // will fail. To detect the centralized logout sooner, we ping the
  // auth server every 30s; if it 401s we drop to the login page.
  const onAuthLost = useCallback(() => {
    centralLogout({ redirectTo: '/?reason=sso_logout' });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetchAuthed('/oauth/session/active');
        if (cancelled) return;
        if (res.status === 401) onAuthLost();
      } catch { /* network blip — retry next tick */ }
    };
    const handle = setInterval(ping, 30000);
    const onFocus = () => ping();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(handle);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthenticated, onAuthLost]);

  const handleLogout = () => {
    centralLogout();
  };

  if (isCheckingAuth || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin mb-4" />
        <p className="text-xs text-slate-400 font-medium">Verifying Session Authorization...</p>
      </div>
    );
  }

  const isAdmin = currentUser?.is_admin || currentUser?.role === 'admin';
  const roleName = currentUser?.role || (isAdmin ? 'Admin' : 'User');
  const displayName = currentUser?.name || currentUser?.email || 'User';

  const navItems = isAdmin ? [
    { label: 'Overview',        href: '/dashboard',                 Icon: LayoutDashboard },
    { label: 'User Management', href: '/dashboard/users',           Icon: Users },
    { label: 'Roles Management',href: '/dashboard/roles',           Icon: ShieldCheck },
    { label: 'Registered Apps', href: '/dashboard/clients',         Icon: AppWindow },
    { label: 'Google OAuth & 2FA', href: '/dashboard/google-settings', Icon: Settings },
    { label: 'My Profile',      href: '/dashboard/profile',         Icon: UserCircle },
  ] : [
    { label: 'My Profile',      href: '/dashboard/profile',         Icon: UserCircle },
  ];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-950 text-slate-100">
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-400 to-indigo-500 flex items-center justify-center font-bold text-white shadow-md text-xs">
            IAM
          </div>
          <h2 className="font-bold text-sm bg-gradient-to-r from-emerald-400 to-indigo-300 bg-clip-text text-transparent">IAM Portal</h2>
        </div>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
          aria-label="Toggle Navigation Menu"
        >
          {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* Mobile Overlay Backdrop */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40"
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900/90 backdrop-blur-xl border-r border-slate-800 p-6 flex flex-col justify-between
        transform transition-transform duration-200 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div>
          {/* Logo */}
          <div className="hidden md:flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-400 to-indigo-500 flex items-center justify-center font-bold text-lg text-white shadow-md">
              IAM
            </div>
            <div>
              <h2 className="font-bold bg-gradient-to-r from-emerald-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">IAM System</h2>
              <p className="text-xs text-slate-400">Identity & Access Control</p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="space-y-1.5 mt-4 md:mt-0">
            {navItems.map(({ label, href, Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setIsSidebarOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition ${
                    active
                      ? 'bg-gradient-to-r from-emerald-500/20 via-indigo-500/10 to-purple-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  <Icon size={16} strokeWidth={1.8} className={active ? 'text-emerald-400' : 'text-slate-500'} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom user info + logout */}
        <div className="pt-5 border-t border-slate-800/80 mt-auto space-y-3">
          {/* User display */}
          <div className="px-1 space-y-1">
            <p className="text-xs text-slate-400 truncate">{currentUser?.email || 'User'}</p>
            {/* Status pill — matches the requested style */}
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <UserCheck size={12} color="#10b981" aria-hidden="true" />
              <span>Status: <span className="text-slate-300 font-medium capitalize">{roleName}</span></span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm font-medium hover:bg-rose-500/20 transition"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full">
        {children}
      </main>
    </div>
  );
}
