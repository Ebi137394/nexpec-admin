import Link from 'next/link';
import { MapPin, Clock3, ArrowUpRight, MessageSquare, Gavel } from 'lucide-react';
import type { DispatchJob } from '@/lib/data/dispatchQueue';
import { cn } from '@/lib/cn';

// Local safe formatter — handles null/undefined/NaN.
function fmtCents(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}

interface DispatchTableProps {
  jobs: DispatchJob[];
  selectedId?: string | null;
  selectedAppId?: string | null;
}

/**
 * Server-rendered queue. Each row carries the job + its CLIENT_SELECTED
 * applications. Clicking an application row adds
 * `?jobId=...&appId=...` to the URL, which opens the dispatch drawer.
 */
export function DispatchTable({ jobs, selectedId, selectedAppId }: DispatchTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          Queue is clear.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          No jobs are currently awaiting Confirm &amp; Dispatch. New rows
          land here the moment a client moves an applicant to{' '}
          <span className="font-mono text-violet-glow/80">CLIENT_SELECTED</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {jobs.map((job) => (
        <JobBlock
          key={job.id}
          job={job}
          selectedAppId={selectedId === job.id ? selectedAppId ?? null : null}
        />
      ))}
    </div>
  );
}

function JobBlock({
  job,
  selectedAppId,
}: {
  job: DispatchJob;
  selectedAppId: string | null;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20">
      {/* Job header */}
      <header className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-semibold text-white">
            {job.title ?? 'Untitled job'}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {job.location}
              </span>
            )}
            {job.created_at && (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3 w-3" />
                posted {relative(job.created_at)}
              </span>
            )}
            {job.client_name && (
              <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                client · {job.client_name}
              </span>
            )}
          </div>
        </div>
        {job.posted_payout_cents != null && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Job posted payout
            </p>
            <p className="font-mono text-base font-semibold text-zinc-200">
              {fmtCents(job.posted_payout_cents)}
            </p>
          </div>
        )}
      </header>

      {/* Applications */}
      <ul className="divide-y divide-white/[0.04]">
        {job.applications.map((app) => {
          const active = app.id === selectedAppId;
          const params = new URLSearchParams();
          params.set('jobId', job.id);
          params.set('appId', app.id);
          const href = `?${params.toString()}`;

          return (
            <li
              key={app.id}
              className={cn(
                'group transition-colors',
                active ? 'bg-violet/10' : 'hover:bg-white/[0.03]',
              )}
            >
              <div className="flex flex-col gap-3 px-5 py-4">
                <Link
                  href={href}
                  replace
                  scroll={false}
                  className="flex items-center gap-4"
                >
                  {/* Selection dot */}
                  <span
                    className={cn(
                      'inline-flex h-2 w-2 shrink-0 rounded-full transition-colors',
                      active ? 'bg-violet-glow shadow-glow' : 'bg-white/10',
                    )}
                  />

                  {/* Applicant — name + link to profile for admin due diligence */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {app.applicant_name ?? 'Unknown inspector'}
                    </p>
                    <p className="truncate font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                      {app.applicant_email ?? app.applicant_id ?? '—'}
                    </p>
                  </div>

                  {/* Inspector's counter-bid — the ACTUAL bid from the apply form */}
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                      <Gavel className="h-2.5 w-2.5" strokeWidth={2} />
                      Inspector bid
                    </p>
                    <p className="font-mono text-sm font-semibold text-cyan-glow">
                      {app.bid_amount_cents != null
                        ? fmtCents(app.bid_amount_cents)
                        : 'No counter — accepts admin price'}
                    </p>
                  </div>

                  {/* Admin-set payout, if previously committed */}
                  {app.payout_amount_cents != null && (
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                        Admin payout
                      </p>
                      <p className="font-mono text-sm font-semibold text-zinc-200">
                        {fmtCents(app.payout_amount_cents)}
                      </p>
                    </div>
                  )}

                  {/* CTA */}
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-violet/50 bg-violet/20 text-white'
                        : 'border-white/10 bg-white/[0.02] text-zinc-300 group-hover:border-violet/40 group-hover:text-white',
                    )}
                  >
                    {active ? 'Editing' : 'Dispatch'}
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </Link>

                {/* Cover note — admin sees the inspector's pitch */}
                {app.cover_note && (
                  <div className="ml-5 flex items-start gap-2 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2">
                    <MessageSquare
                      className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500"
                      strokeWidth={1.75}
                    />
                    <p className="line-clamp-3 text-xs leading-relaxed text-zinc-300">
                      {app.cover_note}
                    </p>
                  </div>
                )}

                {/* Profile link — admin due diligence */}
                {app.applicant_id && (
                  <Link
                    href={`/p/${app.applicant_id}`}
                    className="ml-5 inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-violet-glow hover:text-white"
                  >
                    View inspector profile →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function relative(iso: string): string {
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
