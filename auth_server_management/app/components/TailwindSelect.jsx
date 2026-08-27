'use client';
import { Fragment } from 'react';
import {
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react';
import { ChevronUpDownIcon, CheckIcon } from '@heroicons/react/20/solid';

/**
 * TailwindSelect — custom dark-themed select built on Headless UI's
 * Listbox. Matches the official Tailwind Plus "Listbox" example
 * (tailwindcss.com/plus/ui-blocks/application-ui/forms/select-menus)
 * but with the auth_server's dark/slate theme.
 *
 * Props:
 *   value       - currently selected value (string)
 *   onChange    - callback(value, option) when user picks an option
 *   options     - Array<{ value: string|number, label: string, [key]: any }>
 *   placeholder - shown when nothing is selected
 *   label       - optional <label> rendered above the trigger
 *   className   - extra class on the outer wrapper
 *   name        - optional hidden <input> name for form submission
 *   disabled    - disable interaction
 *   id          - id attribute (auto-generated if not provided)
 */
export default function TailwindSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select an option',
  label,
  className = '',
  name,
  disabled = false,
  id,
}) {
  // Headless UI Listbox needs an object, not a primitive value.
  // We look up the matching option by `.value` and pass the object to
  // Listbox. The onChange callback emits the whole option object, which
  // we convert back to its `.value` for the caller.
  const selected = options.find((o) => o.value === value) ?? null;
  const listboxId =
    id || `tailwind-select-${Math.random().toString(36).slice(2, 8)}`;

  const handleChange = (option) => {
    if (option == null) return;
    onChange?.(option.value, option);
  };

  return (
    <div className={className}>
      {label && (
        <Label htmlFor={listboxId} className="block text-sm/6 font-medium text-white mb-1.5">
          {label}
        </Label>
      )}
      <Listbox value={selected} onChange={handleChange} disabled={disabled}>
        <div className="relative">
          <ListboxButton
            className={`
              relative w-full cursor-default
              rounded-md bg-white/5 py-2 pr-10 pl-3
              text-left text-white text-sm
              outline-1 -outline-offset-1 outline-white/10
              focus-visible:outline-2 focus-visible:-outline-offset-2
              focus-visible:outline-indigo-500
              transition
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/[0.07]'}
            `}
          >
            <span className="block truncate">
              {selected ? (
                <span className="text-white">{selected.label}</span>
              ) : (
                <span className="text-slate-500">{placeholder}</span>
              )}
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon
                aria-hidden="true"
                className="size-5 text-slate-400 sm:size-4"
              />
            </span>
          </ListboxButton>

          <ListboxOptions
            transition
            anchor="bottom start"
            className={`
              z-50 mt-1 max-h-56 w-[var(--button-width)] overflow-auto
              rounded-md bg-slate-800 py-1 text-base
              outline-1 -outline-offset-1 outline-white/10
              shadow-2xl shadow-black/40
              sm:text-sm
              [--anchor-gap:4px]
              transition duration-100 ease-in
              data-leave:transition data-leave:duration-100 data-leave:ease-in
              data-closed:data-leave:opacity-0
            `}
          >
            {options.length === 0 && (
              <div className="relative cursor-default select-none py-2 pr-9 pl-3 text-slate-500 italic">
                No options available
              </div>
            )}
            {options.map((option) => (
              <ListboxOption
                key={String(option.value)}
                value={option}
                className={`
                  group relative cursor-default py-2 pr-9 pl-3
                  text-white select-none
                  data-focus:bg-indigo-500 data-focus:outline-hidden
                  data-focus:text-white
                `}
              >
                <div className="flex items-center">
                  <span className="block truncate font-normal group-data-selected:font-semibold">
                    {option.label}
                  </span>
                </div>

                <span className="absolute inset-y-0 right-0 hidden items-center pr-4 text-indigo-400 group-data-selected:flex group-data-focus:text-white">
                  <CheckIcon aria-hidden="true" className="size-5" />
                </span>
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
      {/* Hidden input for native form submission */}
      {name && <input type="hidden" name={name} value={selected?.value ?? ''} />}
    </div>
  );
}
