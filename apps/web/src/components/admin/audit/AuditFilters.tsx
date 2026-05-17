'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/cn';

interface AuditFiltersProps {
  eventTypes: string[];
}

const SEVERITIES = ['', 'info', 'warning', 'critical'] as const;

/**
 * Client filter bar. Pushes URL search params and lets the Server
 * Component page re-render. `useTransition` keeps the UI responsive while
 * the server roundtrip is in flight.
 */
export function AuditFilters({ eventTypes }: AuditFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = {
    eventType: searchParams?.get('eventType') ?? '',
    severity: searchParams?.get('severity') ?? '',
  };

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (value) next.set(key, value);
    else next.delete(key);
    // Reset pagination on filter change.
    next.delete('page');
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  function clearAll() {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }

  const hasActiveFilter = current.eventType !== '' || current.severity !== '';

  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-3 transition-opacity',
        isPending && 'opacity-60',
      )}
    >
      <FilterField label="Event type">
        <select
          value={current.eventType}
          onChange={(e) => setParam('eventType', e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/30"
        >
          <option value="">All types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Severity">
        <select
          value={current.severity}
          onChange={(e) => setParam('severity', e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/30"
        >
          {SEVERITIES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All severities'}
            </option>
          ))}
        </select>
      </FilterField>

      {hasActiveFilter && (
        <button
          type="button"
          onClick={clearAll}
          className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-white/30 hover:text-white"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
