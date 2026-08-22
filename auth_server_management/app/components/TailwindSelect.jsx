'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * TailwindSelect - A custom styled select component matching the TailwindUI/TailwindPlus `el-select` design.
 *
 * Props:
 *   value     - current selected value (string)
 *   onChange  - callback(value: string) when user picks an option
 *   options   - Array of { value: string, label: string }
 *   placeholder - text shown when nothing is selected (default: "Select Option")
 *   className - optional extra class on the wrapper
 */
export default function TailwindSelect({ value, onChange, options = [], placeholder = 'Select Option', className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="grid w-full cursor-default grid-cols-1 rounded-xl bg-slate-800/80 py-2.5 pr-2 pl-3.5 text-left text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 text-sm shadow-sm transition hover:border-slate-600"
      >
        <span className="col-start-1 row-start-1 flex items-center gap-3 pr-6 truncate text-slate-100">
          {selectedOption ? selectedOption.label : <span className="text-slate-500">{placeholder}</span>}
        </span>
        {/* Chevron up/down icon */}
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
          className="col-start-1 row-start-1 size-4 self-center justify-self-end text-slate-400"
        >
          <path
            d="M5.22 10.22a.75.75 0 0 1 1.06 0L8 11.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06ZM10.78 5.78a.75.75 0 0 1-1.06 0L8 4.06 6.28 5.78a.75.75 0 0 1-1.06-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06Z"
            clipRule="evenodd"
            fillRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown options */}
      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-xl bg-slate-800 py-1 text-sm shadow-2xl border border-slate-700 text-slate-200 animate-in fade-in slide-in-from-top-1 duration-100">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`relative cursor-pointer py-2.5 pr-9 pl-3.5 select-none transition-colors ${
                  isSelected
                    ? 'bg-indigo-600/20 text-indigo-300 font-semibold'
                    : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <div className="flex items-center">
                  <span className="block truncate">{opt.label}</span>
                </div>
                {/* Checkmark for selected */}
                {isSelected && (
                  <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-indigo-400">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
                      <path
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                        fillRule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
