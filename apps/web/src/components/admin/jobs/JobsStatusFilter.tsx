'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import {
  ALL_JOB_STATUSES,
  jobStatusLabel,
  type JobStatus,
} from '@nexpec/shared-core';
import { cn } from '@/lib/cn';

/**
 * Status filter pills + clear. Pushes `?status=<x>` (or removes it).
 * Resets ?page on change. useTransition keeps the UI responsive.
 */
export function JobsStatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = (searchParams?.get('status') as JobStatus | null) ?? null;

  function setStatus(s: JobStatus | null) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (s) next.set('status', s);
    else next.delete('status');
    next.delete('page');
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', isPending && 'opacity-60')}>
      <Pill
        active={current === null}
        onClick={() => setStatus(null)}
        label="All"
      />
      {ALL_JOB_STATUSES.map((s) => (
        <Pill
          key={s}
          active={current === s}
          onClick={() => setStatus(s)}
          label={jobStatusLabel(s)}
        />
      ))}
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
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-violet/60 bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
          : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/25 hover:text-white',
      )}
    >
      {label}
    </button>
  );
}
