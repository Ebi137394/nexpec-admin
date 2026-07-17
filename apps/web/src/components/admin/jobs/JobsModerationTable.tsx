import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ModerationJob } from '@/lib/data/jobsModeration';
import { JobStatusBadge } from './JobStatusBadge';
import { cn } from '@/lib/cn';

// Local safe formatter — handles null/undefined/NaN gracefully.
function fmtCents(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}

interface JobsModerationTableProps {
  jobs: ModerationJob[];
  selectedId?: string | null;
}

/**
 * Server-rendered platform-wide job table. Sprint 4: rows are clickable
 * and open the moderation detail drawer with the full audit timeline.
 */
export function JobsModerationTable({ jobs, selectedId }: JobsModerationTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          No jobs match the current filter.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Clear the filter above or wait for a new posting.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/[0.06] bg-white/[0.02]">
          <tr className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <th className="px-4 py-3 font-semibold">Updated</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Job</th>
            <th className="px-4 py-3 font-semibold">Client</th>
            <th className="px-4 py-3 font-semibold">Inspector</th>
            <th className="px-4 py-3 text-right font-semibold">Payment hold</th>
            <th className="px-4 py-3 text-right font-semibold">Payout</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {jobs.map((job) => {
            const active = job.id === selectedId;
            const href = `?inspect=${job.id}#moderation`;
            return (
              <tr
                key={job.id}
                className={cn(
                  'group transition-colors',
                  active ? 'bg-violet/10' : 'hover:bg-white/[0.03]',
                )}
              >
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <Link href={href} replace className="block">
                    <time className="font-mono text-xs text-zinc-400">
                      {formatTimestamp(job.updated_at ?? job.created_at)}
                    </time>
                  </Link>
                </td>
                <td className="px-4 py-3 align-top">
                  <Link href={href} replace>
                    <JobStatusBadge status={job.status} />
                    {job.payout_status && job.payout_status !== 'unpaid' && (
                      <span className="ml-2 font-mono text-[9px] uppercase tracking-industrial text-zinc-500">
                        payout, {job.payout_status}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 align-top">
                  <Link href={href} replace className="block">
                    <p className="line-clamp-2 max-w-xs text-sm font-medium text-white group-hover:text-white">
                      {job.title ?? 'Untitled job'}
                    </p>
                    {job.location && (
                      <p className="mt-0.5 text-[11px] text-zinc-500">{job.location}</p>
                    )}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <Link href={href} replace>
                    <p className="text-sm text-zinc-200">{job.client_name ?? '—'}</p>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <Link href={href} replace>
                    <p className="text-sm text-zinc-200">{job.contractor_name ?? '—'}</p>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                  <Link href={href} replace>
                    <p className="font-mono text-sm font-semibold text-zinc-200">
                      {fmtCents(job.client_price_cents)}
                    </p>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                  <Link
                    href={href}
                    replace
                    scroll={false}
                    className="flex items-center justify-end gap-2"
                  >
                    <p className="font-mono text-sm font-semibold text-cyan-glow">
                      {fmtCents(job.payout_amount_cents)}
                    </p>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 transition-colors',
                        active ? 'text-violet-glow' : 'text-zinc-600 group-hover:text-zinc-300',
                      )}
                    />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  } catch {
    return iso;
  }
}
