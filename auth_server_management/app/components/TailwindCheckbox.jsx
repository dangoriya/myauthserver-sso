'use client';

/**
 * TailwindCheckbox - Styled checkbox, native browser size,
 * blue/indigo default with a clean native-style ✓ checkmark.
 *
 * Props:
 *   checked     - boolean
 *   onChange    - callback(e)
 *   label       - string
 *   description - optional string
 *   color       - 'indigo' (default) | 'emerald' | 'amber' | 'rose'
 *   id          - optional string
 */
export default function TailwindCheckbox({ checked, onChange, label, description, color = 'indigo', id }) {
  const boxColor = {
    indigo:  'bg-indigo-500 border-indigo-500',
    emerald: 'bg-emerald-500 border-emerald-500',
    amber:   'bg-amber-400 border-amber-400',
    rose:    'bg-rose-500 border-rose-500',
  }[color] || 'bg-indigo-500 border-indigo-500';

  return (
    <label className="relative flex items-center gap-2.5 cursor-pointer select-none group" htmlFor={id}>
      {/* Hidden native input for form compatibility */}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />

      {/* Visual checkbox box */}
      <div
        className={`w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center transition-all duration-150
          ${checked ? boxColor : 'bg-slate-800 border-slate-500'}`}
      >
        {/* Native-style ✓ checkmark */}
        {checked && (
          <svg
            viewBox="0 0 10 8"
            fill="none"
            className="w-2.5 h-2.5 text-white"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {(label || description) && (
        <div className="min-w-0">
          {label && (
            <span className="block text-sm text-slate-300 group-hover:text-slate-100 transition-colors">
              {label}
            </span>
          )}
          {description && (
            <span className="block text-xs text-slate-500 mt-0.5">{description}</span>
          )}
        </div>
      )}
    </label>
  );
}
