'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CREDENTIAL_STATUSES } from '@/lib/data/compliance.types';
import { cn } from '@/lib/cn';

export function ComplianceStatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = searchParams?.get('status') ?? '';

  function setStatus(s: string) {
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
      <Pill active={current === ''} onClick={() => setStatus('')} label="All" />
      {CREDENTIAL_STATUSES.map((s) => (
        <Pill
          key={s}
          active={current === s}
          onClick={() => setStatus(s)}
          label={s.charAt(0).toUpperCase() + s.slice(1)}
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
          ? 'border-cyan-glow/60 bg-cyan-glow/15 text-white ring-1 ring-inset ring-cyan-glow/30'
          : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/25 hover:text-white',
      )}
    >
      {label}
    </button>
  );
}
