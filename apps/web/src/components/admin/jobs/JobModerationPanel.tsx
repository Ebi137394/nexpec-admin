// ════════════════════════════════════════════════════════════════════════════
//  components/admin/jobs/JobModerationPanel.tsx — PURE SERVER COMPONENT
//
//  Rewrite of JobModerationDrawer with zero client-side dependencies:
//  no useActionState, no useFormStatus, no framer-motion, no @nexpec/shared-core.
//  Plain <form action={reviewJobSimple}> posts to a server action that redirects.
//
//  This eliminates the entire class of SSR errors caused by client component
//  hydration with null props.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  CheckCircle2,
  FilePen,
  Ban,
  Gavel,
  X,
  Link2,
  AlertCircle,
  MessageSquare,
  ExternalLink,
  Users,
} from 'lucide-react';
import { reviewJobSimple } from '@/lib/actions/jobModerationSimple';
import type {
  ModerationJobDetail,
  ModerationTimelineEvent,
} from '@/lib/data/jobsModeration.types';
import type { ModerationApplicant } from '@/lib/data/jobsModeration';
import { JobStatusBadge } from './JobStatusBadge';

// Local safe formatter (no shared-core dependency).
function fmtCents(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}

interface Props {
  job: ModerationJobDetail;
  timeline: ModerationTimelineEvent[];
  applicants?: ModerationApplicant[];
  /** Optional ?error= query param to show inline after a failed action. */
  errorMessage?: string;
}

export function JobModerationPanel({
  job,
  timeline,
  applicants = [],
  errorMessage,
}: Props) {
  const existingPayoutCents =
    job.payout_amount_cents ??
    ((job as unknown as { inspector_payout_cents?: number | null })
      .inspector_payout_cents ?? null);
  const existingPayoutDollars =
    typeof existingPayoutCents === 'number' && existingPayoutCents > 0
      ? Math.round(existingPayoutCents / 100)
      : '';
  const clientBudgetDollars =
    typeof job.client_price_cents === 'number' && job.client_price_cents > 0
      ? Math.round(job.client_price_cents / 100)
      : null;

  return (
    <aside className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            <Gavel className="h-3 w-3" />
            Job Moderation
          </p>
          <h2 className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white">
            {job.title ?? 'Untitled job'}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-300">
              moderation · {job.moderation_status ?? 'pending_review'}
            </span>
          </div>
        </div>
        <Link
          href="/admin/jobs"
          aria-label="Close"
          className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:border-white/30 hover:text-white"
        >
          <X className="h-4 w-4" />
        </Link>
      </header>

      <div className="px-6 py-5 space-y-6">
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        )}

        {/* Job summary */}
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Job summary
          </p>
          {job.description && (
            <p className="mt-2 line-clamp-6 text-xs leading-relaxed text-zinc-300">
              {job.description}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3 text-xs">
            <div>
              <dt className="text-zinc-500">Client</dt>
              <dd className="mt-0.5 truncate font-medium text-zinc-200">
                {job.client_name ?? job.client_email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Inspector</dt>
              <dd className="mt-0.5 truncate font-medium text-zinc-200">
                {job.contractor_name ?? job.contractor_email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Client price</dt>
              <dd className="mt-0.5 font-mono font-semibold text-zinc-200">
                {fmtCents(job.client_price_cents)}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Inspector payout</dt>
              <dd className="mt-0.5 font-mono font-semibold text-cyan-glow">
                {fmtCents(job.payout_amount_cents)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Applicants — inspector bids + cover notes visible to admin only */}
        <section className="rounded-xl border border-cyan-glow/25 bg-cyan-glow/[0.04] p-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cyan-glow" strokeWidth={1.75} />
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
              Inspector applications · {applicants.length}
            </p>
          </div>
          {applicants.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              No inspectors have applied yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {applicants.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {a.applicant_name ?? a.applicant_email ?? a.applicant_id ?? '—'}
                      </p>
                      <span
                        className={
                          'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ' +
                          (a.status === 'CLIENT_SELECTED'
                            ? 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow'
                            : a.status === 'accepted' || a.status === 'hired'
                              ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                              : a.status === 'rejected' || a.status === 'withdrawn'
                                ? 'border-white/10 bg-white/[0.04] text-zinc-400'
                                : 'border-violet/30 bg-violet/10 text-violet-glow')
                        }
                      >
                        {a.status}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-3">
                      {/* Inspector's counter-bid (or "no counter") */}
                      <div className="text-right">
                        <p className="text-[9px] font-semibold uppercase tracking-industrial text-zinc-500">
                          Inspector bid
                        </p>
                        <p className="font-mono text-sm font-semibold text-cyan-glow">
                          {a.bid_amount_cents != null
                            ? fmtCents(a.bid_amount_cents)
                            : 'no counter'}
                        </p>
                      </div>
                      {a.payout_amount_cents != null && (
                        <div className="text-right">
                          <p className="text-[9px] font-semibold uppercase tracking-industrial text-zinc-500">
                            Admin payout
                          </p>
                          <p className="font-mono text-sm font-semibold text-zinc-200">
                            {fmtCents(a.payout_amount_cents)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  {a.cover_note && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-white/[0.04] bg-ink-950/30 px-3 py-2">
                      <MessageSquare
                        className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500"
                        strokeWidth={1.75}
                      />
                      <p className="text-xs leading-relaxed text-zinc-300">
                        {a.cover_note}
                      </p>
                    </div>
                  )}
                  {a.applicant_id && (
                    <Link
                      href={`/p/${a.applicant_id}`}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-glow hover:text-white"
                    >
                      View inspector profile
                      <ExternalLink className="h-3 w-3" strokeWidth={2} />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Timeline */}
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Audit timeline (most recent 20)
          </p>
          {timeline.length === 0 ? (
            <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-zinc-500">
              No audit events for this job yet.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {timeline.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-start gap-3 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2"
                >
                  <span
                    className={
                      'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ' +
                      (ev.severity === 'critical'
                        ? 'bg-accent-red'
                        : ev.severity === 'warning'
                          ? 'bg-accent-amber'
                          : 'bg-violet-glow/70')
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-200">{ev.summary}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                      <span className="font-mono">{ev.event_type}</span>
                      <span>·</span>
                      <span>{ev.actor_label ?? 'system'}</span>
                      <span>·</span>
                      <time>{compactTime(ev.created_at)}</time>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <Link
            href={`/admin/audit?jobId=${job.id}`}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-violet-glow transition-colors hover:text-white"
          >
            <Link2 className="h-3 w-3" />
            Open the full timeline in Audit Trail
          </Link>
        </section>

        {/* Three independent forms — one per decision. Server-action POST,
            redirect back. No client component, no hydration risk. */}
        <section>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Decision
          </p>
          <div className="space-y-3">
            {/* APPROVE */}
            <form
              action={reviewJobSimple}
              className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-4"
            >
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="approved" />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-green/15 text-accent-green ring-1 ring-inset ring-accent-green/40">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">Approve</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Admin sign-off. Optionally set the inspector payout (GR1)
                    and a sign-off note below.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                    Inspector payout (USD)
                    {clientBudgetDollars !== null && (
                      <span className="ml-2 font-mono normal-case text-zinc-500">
                        client budget · ${clientBudgetDollars.toLocaleString()}
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    name="inspectorPayoutDollars"
                    min={0}
                    step={1}
                    defaultValue={existingPayoutDollars}
                    placeholder="e.g. 1500 — optional"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-accent-green/60 focus:outline-none focus:ring-2 focus:ring-accent-green/30"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                    Notes (optional)
                  </span>
                  <input
                    type="text"
                    name="notes"
                    maxLength={500}
                    placeholder="Optional sign-off note"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-green/60 focus:outline-none focus:ring-2 focus:ring-accent-green/30"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent-green px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-accent-green/90"
              >
                <Gavel className="h-3 w-3" />
                Confirm approval
              </button>
            </form>

            {/* REQUEST EDITS */}
            <form
              action={reviewJobSimple}
              className="rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-4"
            >
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="edits_requested" />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-amber/15 text-accent-amber ring-1 ring-inset ring-accent-amber/40">
                  <FilePen className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">Request edits</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Send back to the poster with notes.
                  </p>
                </div>
              </div>
              <label className="mt-3 block">
                <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                  Notes for the client (optional but recommended)
                </span>
                <textarea
                  name="notes"
                  maxLength={1000}
                  rows={2}
                  placeholder="What does the poster need to fix?"
                  className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-amber/60 focus:outline-none focus:ring-2 focus:ring-accent-amber/30"
                />
              </label>
              <button
                type="submit"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent-amber px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-ink-950 shadow-sm transition-colors hover:bg-accent-amber/90"
              >
                <FilePen className="h-3 w-3" />
                Send back for edits
              </button>
            </form>

            {/* REJECT */}
            <form
              action={reviewJobSimple}
              className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4"
            >
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="rejected" />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-red/15 text-accent-red ring-1 ring-inset ring-accent-red/40">
                  <Ban className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">Reject</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Cascade to admin_cancel_job. Job moves to cancelled with the
                    reason below.
                  </p>
                </div>
              </div>
              <label className="mt-3 block">
                <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                  Rejection reason (optional)
                </span>
                <textarea
                  name="notes"
                  maxLength={1000}
                  rows={2}
                  placeholder="Why is this being rejected?"
                  className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-red/60 focus:outline-none focus:ring-2 focus:ring-accent-red/30"
                />
              </label>
              <button
                type="submit"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent-red px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-accent-red/90"
              >
                <Ban className="h-3 w-3" />
                Reject and cancel
              </button>
            </form>
          </div>
        </section>
      </div>

      <footer className="border-t border-white/[0.06] px-6 py-3">
        <p className="font-mono text-[10px] tracking-wider text-zinc-600">
          rpc · admin_review_job · audit-stamped · reject cascades through admin_cancel_job
        </p>
      </footer>
    </aside>
  );
}

function compactTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  } catch {
    return iso;
  }
}
