import Link from 'next/link';
import { MapPin, Clock3, Receipt, ArrowUpRight } from 'lucide-react';
import { formatCents } from '@nexpec/shared-core';
import type { PayoutJob } from '@/lib/data/payoutsQueue';
import { cn } from '@/lib/cn';

interface PayoutsTableProps {
  jobs: PayoutJob[];
  selectedId?: string | null;
}

/**
 * Each row is a payout candidate. Sorted by the oldest unpaid first
 * (queue.ts orders updated_at ASC) so the inspectors waiting longest
 * surface at the top. Hovering or active-state tints cyan — payouts are
 * the cyan-accent surface across the console.
 */
export function PayoutsTable({ jobs, selectedId }: PayoutsTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          All caught up.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          No completed jobs are awaiting payout. New entries appear here
          the moment a job moves to <span className="font-mono text-cyan-glow/80">completed</span>{' '}
          while <span className="font-mono text-cyan-glow/80">payout_status</span> is not yet{' '}
          <span className="font-mono text-cyan-glow/80">paid</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <Row key={job.id} job={job} active={job.id === selectedId} />
      ))}
    </div>
  );
}

function Row({ job, active }: { job: PayoutJob; active: boolean }) {
  const href = `?jobId=${job.id}`;
  return (
    <Link
      href={href}
      replace
      scroll={false}
      className={cn(
        'group block overflow-hidden rounded-2xl border transition-all',
        active
          ? 'border-cyan-glow/40 bg-cyan-glow/5 shadow-[0_30px_60px_-30px_rgba(0,207,213,0.35)]'
          : 'border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20 hover:-translate-y-0.5 hover:border-cyan-glow/40',
      )}
    >
      <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-glow/15 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
              <Receipt className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <h3 className="truncate font-display text-base font-semibold text-white">
              {job.title ?? 'Untitled job'}
            </h3>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {job.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" />
              completed {relative(job.completed_at ?? job.updated_at)}
            </span>
            {job.payout_status && (
              <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                status, {job.payout_status}
              </span>
            )}
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Inspector (recipient)
              </dt>
              <dd className="mt-0.5 truncate font-medium text-zinc-200">
                {job.contractor_name ?? job.contractor_email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Client (escrow source)
              </dt>
              <dd className="mt-0.5 truncate font-medium text-zinc-200">
                {job.client_name ?? job.client_email ?? '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col items-end gap-3 sm:items-end">
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Inspector owed
            </p>
            <p className="mt-0.5 font-mono text-xl font-semibold tracking-tight text-cyan-glow">
              {formatCents(job.payout_amount_cents)}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'border-cyan-glow/50 bg-cyan-glow/15 text-white'
                : 'border-white/10 bg-white/[0.02] text-zinc-300 group-hover:border-cyan-glow/40 group-hover:text-white',
            )}
          >
            {active ? 'Settling' : 'Settle'}
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function relative(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
