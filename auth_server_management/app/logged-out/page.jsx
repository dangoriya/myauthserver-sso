'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clearSession } from '@/app/lib/auth';

export default function LoggedOutPage() {
  const [state, setState] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    clearSession();
    const params = new URLSearchParams(window.location.search);
    setState(params.get('state') || '');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-emerald-950">
      <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-tr from-emerald-400 via-teal-400 to-indigo-500 flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/30">
          ✓
        </div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-teal-200 to-indigo-300 bg-clip-text text-transparent mb-2">
          Signed Out
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          You have been securely signed out of all your apps via central SSO.
        </p>
        {state && (
          <p className="text-[11px] text-slate-500 font-mono mb-4 break-all">
            state: {state}
          </p>
        )}
        <Link
          href="/"
          className="inline-block w-full py-3 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 font-semibold text-white text-sm rounded-xl hover:opacity-95 transition"
        >
          Sign Back In
        </Link>
      </div>
    </div>
  );
}
