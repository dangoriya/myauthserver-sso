'use client';

import { useEffect } from 'react';

/**
 * TailwindModal — accessible confirmation dialog matching the dark slate
 * design system used across auth_server_management.
 *
 * Props:
 *   open           - boolean
 *   onClose        - () => void          (called for cancel / backdrop / Esc)
 *   onConfirm      - () => void          (called when the primary button is clicked)
 *   title          - string
 *   description    - string | ReactNode  (optional supporting copy)
 *   confirmLabel   - string              (default "Confirm")
 *   cancelLabel    - string              (default "Cancel")
 *   tone           - 'amber' | 'rose' | 'emerald' | 'indigo' (default 'amber')
 *   icon           - string              (optional emoji)
 *   loading        - boolean             (disables buttons + swaps confirm label)
 *   children       - ReactNode           (rich body content, e.g. bullet lists)
 *   showSingleButton - boolean           (hides the cancel button — OK-only dialog)
 */
export default function TailwindModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'amber',
  icon,
  loading = false,
  children,
  showSingleButton = false,
}) {
  // Lock body scroll + close on Esc while open
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, loading, onClose]);

  if (!open) return null;

  const toneStyles = {
    amber: {
      ring: 'ring-amber-500/40',
      iconBg: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
      btn: 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:opacity-95 shadow-lg shadow-amber-500/20',
    },
    rose: {
      ring: 'ring-rose-500/40',
      iconBg: 'bg-rose-500/20 border-rose-500/40 text-rose-300',
      btn: 'bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-600 hover:opacity-95 shadow-lg shadow-rose-500/20',
    },
    emerald: {
      ring: 'ring-emerald-500/40',
      iconBg: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
      btn: 'bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 hover:opacity-95 shadow-lg shadow-emerald-500/20',
    },
    indigo: {
      ring: 'ring-indigo-500/40',
      iconBg: 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300',
      btn: 'bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-600 hover:opacity-95 shadow-lg shadow-indigo-500/20',
    },
  }[tone] || {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tw-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm animate-[fadeIn_0.18s_ease]"
        onClick={() => !loading && onClose()}
      />

      {/* Dialog */}
      <div
        className={`relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl ring-1 ${toneStyles.ring} animate-[popIn_0.2s_cubic-bezier(0.22,1,0.36,1)]`}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            {icon && (
              <div
                className={`shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center text-2xl ${toneStyles.iconBg}`}
                aria-hidden="true"
              >
                {icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              {title && (
                <h2
                  id="tw-modal-title"
                  className="text-lg font-bold text-white"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-slate-400">{description}</p>
              )}
            </div>
          </div>

          {children && (
            <div className="mt-4 text-sm text-slate-300">
              {children}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-900/60 rounded-b-2xl">
          {!showSingleButton && (
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700 transition disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-xl text-white text-sm font-semibold transition disabled:opacity-60 ${toneStyles.btn}`}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Working...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
