'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition, useState, useEffect } from 'react';
import { Search } from 'lucide-react';
// ★ Types-only import keeps next/headers out of the client bundle.
import { KNOWN_ROLES } from '@/lib/data/users.types';
import { cn } from '@/lib/cn';

/**
 * Filter bar: search box (debounced server roundtrip) + role pill row.
 * Search updates the URL after 350ms so each keystroke doesn't fire a
 * server fetch.
 */
export function UsersFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentRole = searchParams?.get('role') ?? '';
  const currentSearch = searchParams?.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(currentSearch);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput === currentSearch) return;
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      if (searchInput.trim()) next.set('search', searchInput.trim());
      else next.delete('search');
      next.delete('page');
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function setRole(r: string) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (r) next.set('role', r);
    else next.delete('role');
    next.delete('page');
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={cn('space-y-3', isPending && 'opacity-60')}>
      {/* Search */}
      <label className="relative block max-w-md">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
          <Search className="h-4 w-4" />
        </span>
        <input
          type="search"
          placeholder="Search name or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
        />
      </label>

      {/* Role pills */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill active={currentRole === ''} onClick={() => setRole('')} label="All roles" />
        {KNOWN_ROLES.map((r) => (
          <Pill
            key={r}
            active={currentRole === r}
            onClick={() => setRole(r)}
            label={r.replace('_', ' ')}
          />
        ))}
      </div>
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
        active
          ? 'border-violet/60 bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
          : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/25 hover:text-white',
      )}
    >
      {label}
    </button>
  );
}
