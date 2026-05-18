// ════════════════════════════════════════════════════════════════════════════
//  components/forms/CountryMultiSelect.tsx — country picker (single or multi)
//
//  Client component. Receives the full Country[] list from the server
//  page (one fetch per page render). For multi mode, each selected code
//  is emitted as a hidden form field with the same `name`, so the server
//  action's formData.getAll(name) returns the array directly.
//
//  Mirrors the mobile CountryPicker behaviour: searchable, chip-style
//  selected display, dropdown with type-to-filter, max-items cap.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, X, Search, Check } from 'lucide-react';
import type { Country } from '@/lib/data/countries.types';
import { cn } from '@/lib/cn';

export interface CountryMultiSelectProps {
  /** Form field name. Each selected code becomes a hidden input with this name. */
  name: string;
  /** Full ISO country list from country_codes table. */
  countries: ReadonlyArray<Country>;
  /** Initial selected codes (uppercase). */
  defaultSelected?: ReadonlyArray<string>;
  /** Hard cap to mirror DB constraint (e.g. profiles_work_authorized_countries_cap = 60). */
  max?: number;
  /** Single-select mode — when true, only one country can be selected. */
  single?: boolean;
  /** Friendly label rendered above the chip area. */
  label?: string;
  /** Placeholder copy inside the trigger when nothing is selected. */
  placeholder?: string;
  /** Helper text under the input. */
  hint?: string;
  /** Disabled state — read-only display only. */
  disabled?: boolean;
}

export function CountryMultiSelect({
  name,
  countries,
  defaultSelected = [],
  max = 60,
  single = false,
  label,
  placeholder = 'Pick countries',
  hint,
  disabled = false,
}: CountryMultiSelectProps) {
  const initial = useMemo(
    () =>
      Array.from(
        new Set(defaultSelected.map((c) => c.trim().toUpperCase()).filter(Boolean)),
      ),
    [defaultSelected],
  );
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const codeToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.code, c.name);
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countries, query]);

  function toggle(code: string) {
    if (disabled) return;
    const up = code.toUpperCase();
    if (single) {
      setSelected([up]);
      setOpen(false);
      setQuery('');
      return;
    }
    setSelected((prev) => {
      if (prev.includes(up)) return prev.filter((x) => x !== up);
      if (prev.length >= max) return prev;
      return [...prev, up];
    });
  }

  function remove(code: string) {
    if (disabled) return;
    setSelected((prev) => prev.filter((x) => x !== code));
  }

  const atMax = !single && selected.length >= max;

  return (
    <div>
      {label && (
        <label className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          {label}
        </label>
      )}

      {/* Hidden inputs — each selected code is an entry the server action reads via formData.getAll(name) */}
      {selected.map((code) => (
        <input key={code} type="hidden" name={name} value={code} />
      ))}
      {/* If single mode, also ensure empty string is sent when nothing selected */}
      {single && selected.length === 0 && (
        <input type="hidden" name={name} value="" />
      )}

      {/* Chip area + trigger */}
      <div
        className={cn(
          'mt-2 rounded-xl border border-white/10 bg-white/[0.03] focus-within:border-violet/60 focus-within:ring-2 focus-within:ring-violet/30',
          disabled && 'opacity-60',
        )}
      >
        {/* Selected chips */}
        {selected.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 border-b border-white/[0.06] p-2">
            {selected.map((code) => (
              <li
                key={code}
                className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-xs font-medium text-violet-glow"
              >
                <span className="font-mono">{code}</span>
                <span className="hidden text-zinc-400 sm:inline">·</span>
                <span className="hidden sm:inline">
                  {codeToName.get(code) ?? code}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remove(code)}
                    aria-label={`Remove ${codeToName.get(code) ?? code}`}
                    className="ml-0.5 rounded-full p-0.5 text-violet-glow/60 transition-colors hover:bg-violet/20 hover:text-violet-glow"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Search trigger + dropdown */}
        {!disabled && !(single && selected.length === 1) && (
          <div className="relative">
            <div className="flex items-center gap-2 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder={selected.length === 0 ? placeholder : 'Search to add another'}
                disabled={atMax}
                className="w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
              />
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform',
                  open && 'rotate-180',
                )}
                strokeWidth={1.75}
              />
            </div>

            {open && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/[0.08] bg-ink-900/95 shadow-2xl backdrop-blur-xl">
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-zinc-500">
                    No countries match &ldquo;{query}&rdquo;.
                  </p>
                ) : (
                  <ul>
                    {filtered.slice(0, 100).map((c) => {
                      const isSelected = selected.includes(c.code);
                      return (
                        <li key={c.code}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()} // keep focus to avoid blur-close before click
                            onClick={() => toggle(c.code)}
                            className={cn(
                              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.04]',
                              isSelected ? 'text-violet-glow' : 'text-zinc-300',
                            )}
                          >
                            <span className="w-8 font-mono text-[11px] text-zinc-500">
                              {c.code}
                            </span>
                            <span className="flex-1">{c.name}</span>
                            {isSelected && (
                              <Check className="h-3.5 w-3.5 text-violet-glow" strokeWidth={2} />
                            )}
                          </button>
                        </li>
                      );
                    })}
                    {filtered.length > 100 && (
                      <li className="px-3 py-2 text-center text-[10px] text-zinc-500">
                        {filtered.length - 100} more — keep typing to narrow
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {hint && (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          {hint}
          {!single && atMax && (
            <span className="ml-1 text-accent-amber">
              · Max {max} reached
            </span>
          )}
        </p>
      )}
    </div>
  );
}
