'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
    if (!token) {
      router.replace('/');
    } else {
      const user = localStorage.getItem('admin_user');
      if (user) {
        try {
          setCurrentUser(JSON.parse(user));
        } catch (e) {
          console.error(e);
        }
      }
      setIsAuthenticated(true);
      setIsCheckingAuth(false);
    }
  }, [router]);

  // Centralized SSO logout detection: poll the auth server every 30s
  // and clear the local session if the OP reports the central session
  // is no longer valid. This ensures that a logout from any other
  // client app / browser tab is reflected here within ~30s.
  useEffect(() => {
    if (!isAuthenticated) return;
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
    let cancelled = false;
    const ping = async () => {
      const token = localStorage.getItem('admin_token');
      if (!token) return;
      try {
        const res = await fetch(`${authServerUrl}/api/v1/sso/ping`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.status === 401) {
          // Central SSO session gone — log this tab out
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_id_token');
          localStorage.removeItem('admin_user');
          router.replace('/?reason=sso_logout');
        }
      } catch (_) {
        // Network blip — ignore, retry on next tick
      }
    };
    const handle = setInterval(ping, 30000);
    // Also ping immediately on focus
    const onFocus = () => ping();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(handle);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthenticated, router]);

  const handleLogout = () => {
    // OIDC RP-Initiated Logout 1.0 (front-channel).
    //   1. Clear local session data immediately
    //   2. Redirect the browser to the OP's /logout endpoint with
    //      - id_token_hint: the id_token the OP issued to this client
    //      - client_id: this client's identifier
    //      - post_logout_redirect_uri: where the OP should send the user back
    //      - state: optional, echoed back
    //   The OP will then POST a back-channel logout_token to every other
    //   client app the user had a session on, then bounce the user back to
    //   the post_logout_redirect_uri.
    const idToken = localStorage.getItem('admin_id_token');
    const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
    const postLogoutUri = `${window.location.origin}/logged-out`;
    const params = new URLSearchParams();
    if (idToken) params.set('id_token_hint', idToken);
    params.set('client_id', 'auth_management_app');
    params.set('post_logout_redirect_uri', postLogoutUri);

    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_id_token');
    localStorage.removeItem('admin_user');

    // Use a hard navigation so the OP endpoint sets the right cookies/redirects.
    window.location.href = `${authServerUrl}/logout?${params.toString()}`;
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
