import Link from 'next/link';
import { MapPin, Clock3, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { formatCents } from '@nexpec/shared-core';
import type { DisputeJob } from '@/lib/data/disputesQueue';
import { cn } from '@/lib/cn';

interface DisputesTableProps {
  jobs: DisputeJob[];
  selectedId?: string | null;
}

/**
 * Server-rendered dispute queue. Each row carries the job's escrow
 * exposure, the two parties, and the age of the dispute. Highest-stakes
 * disputes naturally sort to the top via updated_at DESC.
 */
export function DisputesTable({ jobs, selectedId }: DisputesTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          No active disputes.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Jobs that hit{' '}
          <span className="font-mono text-violet-glow/80">disputed</span>{' '}
          status land here. Both parties retain read access to their own
          dispute timeline via RLS.
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

function Row({ job, active }: { job: DisputeJob; active: boolean }) {
  const href = `?jobId=${job.id}`;
  return (
    <Link
      href={href}
      replace
      scroll={false}
      className={cn(
        'group block overflow-hidden rounded-2xl border transition-all',
        active
          ? 'border-accent-amber/40 bg-accent-amber/10 shadow-[0_30px_60px_-30px_rgba(245,158,11,0.4)]'
          : 'border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20 hover:-translate-y-0.5 hover:border-accent-amber/40',
      )}
    >
      <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          {/* Title + risk pill */}
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-amber/15 text-accent-amber ring-1 ring-inset ring-accent-amber/30">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <h3 className="truncate font-display text-base font-semibold text-white">
              {job.title ?? 'Untitled job'}
            </h3>
          </div>

          {/* Meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {job.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" />
              opened {relative(job.updated_at ?? job.created_at)}
            </span>
          </div>

          {/* Parties */}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Client
              </dt>
              <dd className="mt-0.5 truncate font-medium text-zinc-200">
                {job.client_name ?? job.client_email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Inspector
              </dt>
              <dd className="mt-0.5 truncate font-medium text-zinc-200">
                {job.contractor_name ?? job.contractor_email ?? '—'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Right column: escrow + CTA */}
        <div className="flex flex-col items-end gap-3 sm:items-end">
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Escrow at stake
            </p>
            <p className="mt-0.5 font-mono text-xl font-semibold tracking-tight text-accent-amber">
              {formatCents(job.client_price_cents)}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'border-accent-amber/50 bg-accent-amber/15 text-white'
                : 'border-white/10 bg-white/[0.02] text-zinc-300 group-hover:border-accent-amber/40 group-hover:text-white',
            )}
          >
            {active ? 'Reviewing' : 'Review'}
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
