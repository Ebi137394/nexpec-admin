'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  X,
  CheckCircle2,
  FilePen,
  Ban,
  AlertTriangle,
  Link2,
  Gavel,
} from 'lucide-react';
import { type JobModerationDecision } from '@nexpec/shared-core';

// Local safe formatter — avoids any null-handling drift from shared-core.
function fmtCents(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}
import {
  reviewJob,
  reviewJobInitialState,
  type ReviewJobActionState,
} from '@/lib/actions/jobModeration';
import type {
  ModerationJobDetail,
  ModerationTimelineEvent,
} from '@/lib/data/jobsModeration.types';
import { JobStatusBadge } from './JobStatusBadge';
import { cn } from '@/lib/cn';

interface JobModerationDrawerProps {
  job: ModerationJobDetail | null;
  timeline: ModerationTimelineEvent[];
}

interface DecisionOption {
  value: JobModerationDecision;
  label: string;
  copy: string;
  icon: typeof CheckCircle2;
  tone: 'green' | 'amber' | 'red';
}

const DECISIONS: DecisionOption[] = [
  {
    value: 'approved',
    label: 'Approve',
    copy: 'Admin sign-off. The job stays in its current state; moderation_status flips to approved.',
    icon: CheckCircle2,
    tone: 'green',
  },
  {
    value: 'edits_requested',
    label: 'Request edits',
    copy: 'Send back to the poster with notes. moderation_status flips to edits_requested.',
    icon: FilePen,
    tone: 'amber',
  },
  {
    value: 'rejected',
    label: 'Reject',
    copy: 'Cascade to admin_cancel_job — the job moves to cancelled with the moderation reason.',
    icon: Ban,
    tone: 'red',
  },
];

export function JobModerationDrawer({ job, timeline }: JobModerationDrawerProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const open = !!job;

  const [decision, setDecision] = useState<JobModerationDecision>('approved');
  const [notes, setNotes] = useState('');
  // GR1 — inspector payout the admin commits at approval time. Defaults to
  // any prior value already stored on the job (in dollars).
  const [payoutDollars, setPayoutDollars] = useState<string>('');

  useEffect(() => {
    setDecision('approved');
    setNotes('');
    const existing =
      job?.payout_amount_cents ??
      (job as unknown as { inspector_payout_cents?: number | null })?.inspector_payout_cents ??
      null;
    setPayoutDollars(
      typeof existing === 'number' && existing > 0
        ? String(Math.round(existing / 100))
        : '',
    );
  }, [job?.id, job?.payout_amount_cents, job]);

  const [state, formAction] = useActionState<ReviewJobActionState, FormData>(
    reviewJob,
    reviewJobInitialState,
  );

  useEffect(() => {
    if (!state.ok || !state.reviewed) return;
    const t = setTimeout(() => close(), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.reviewed?.job_id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.delete('inspect');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <AnimatePresence>
      {open && job && (
        <>
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
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
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                disabled={state.ok}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {state.ok && state.reviewed ? (
                <SuccessPanel state={state} />
              ) : (
                <Body
                  job={job}
                  timeline={timeline}
                  decision={decision}
                  setDecision={setDecision}
                  notes={notes}
                  setNotes={setNotes}
                  payoutDollars={payoutDollars}
                  setPayoutDollars={setPayoutDollars}
                  state={state}
                  formAction={formAction}
                />
              )}
            </div>

            <footer className="border-t border-white/[0.06] px-6 py-3">
              <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                rpc · admin_review_job · audit-stamped · reject cascades through
                admin_cancel_job
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Body({
  job,
  timeline,
  decision,
  setDecision,
  notes,
  setNotes,
  payoutDollars,
  setPayoutDollars,
  state,
  formAction,
}: {
  job: ModerationJobDetail;
  timeline: ModerationTimelineEvent[];
  decision: JobModerationDecision;
  setDecision: (d: JobModerationDecision) => void;
  notes: string;
  setNotes: (v: string) => void;
  payoutDollars: string;
  setPayoutDollars: (v: string) => void;
  state: ReviewJobActionState;
  formAction: (formData: FormData) => void;
}) {
  // Admin = god mode. Notes are ALWAYS optional. Payout is recommended on
  // approve (GR1) but never enforced — admin can ship a $0 pro-bono job or
  // come back to set the price later. UI hints these things; nothing blocks.
  const showNotesRequired = false;
  const showPayoutInput = decision === 'approved';
  const payoutDollarsNum = payoutDollars.trim() === '' ? NaN : Number(payoutDollars);
  const payoutFilled = Number.isFinite(payoutDollarsNum) && payoutDollarsNum >= 0;
  const clientBudgetDollars =
    typeof job.client_price_cents === 'number' && job.client_price_cents > 0
      ? Math.round(job.client_price_cents / 100)
      : null;
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="jobId" value={job.id} />
      <input type="hidden" name="decision" value={decision} />
      {showPayoutInput && (
        <input
          type="hidden"
          name="inspectorPayoutDollars"
          value={payoutDollars}
        />
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
                  className={cn(
                    'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    ev.severity === 'critical'
                      ? 'bg-accent-red'
                      : ev.severity === 'warning'
                        ? 'bg-accent-amber'
                        : 'bg-violet-glow/70',
                  )}
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

      {/* Decision */}
      <section>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Decision
        </p>
        <div className="space-y-2">
          {DECISIONS.map((opt) => (
            <DecisionRadio
              key={opt.value}
              option={opt}
              selected={decision === opt.value}
              onSelect={() => setDecision(opt.value)}
            />
          ))}
        </div>
      </section>

      {/* Inspector payout — GR1: admin sets the price BEFORE inspectors see it. */}
      {showPayoutInput && (
        <section className="rounded-2xl border border-violet/30 bg-gradient-to-br from-violet/[0.08] to-violet/[0.02] p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40">
              <Gavel className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow">
              Inspector payout · Golden Rule 1
            </p>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            What the platform pays the inspector on a signed report. Stored as{' '}
            <span className="font-mono text-zinc-300">inspector_payout_cents</span>
            . <span className="text-zinc-300">Clients never see this value</span>
            ; inspectors never see the client&rsquo;s budget. Recommended but
            optional — you can approve without a price and set it later.
          </p>
          {clientBudgetDollars !== null && (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-zinc-400">
              <span className="text-zinc-500">Client budget (admin-only view):</span>
              <span className="font-mono font-semibold text-zinc-200">
                ${clientBudgetDollars.toLocaleString()}
              </span>
            </p>
          )}
          <label
            htmlFor="inspector-payout"
            className="mt-4 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400"
          >
            Inspector payout (USD whole dollars)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-500">$</span>
            <input
              id="inspector-payout"
              type="number"
              min={1}
              max={1000000}
              step={1}
              value={payoutDollars}
              onChange={(e) => setPayoutDollars(e.target.value)}
              placeholder="e.g. 1500"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </div>
          {clientBudgetDollars !== null && payoutFilled && (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Platform spread: ${' '}
              <span className="font-mono text-zinc-300">
                {(clientBudgetDollars - Math.round(payoutDollarsNum)).toLocaleString()}
              </span>{' '}
              ({clientBudgetDollars > 0
                ? Math.round(
                    ((clientBudgetDollars - Math.round(payoutDollarsNum)) /
                      clientBudgetDollars) *
                      100,
                  )
                : 0}
              %). Hidden from both parties.
            </p>
          )}
        </section>
      )}

      {/* Notes */}
      <section>
        <label htmlFor="job-mod-notes" className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            Notes {showNotesRequired ? '(required · audit-captured)' : '(optional)'}
          </span>
          <textarea
            id="job-mod-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            required={showNotesRequired}
            maxLength={1000}
            rows={4}
            placeholder={
              decision === 'edits_requested'
                ? 'What changes does the client need to make? Be specific — this text reaches the poster.'
                : decision === 'rejected'
                  ? 'Why is the job being rejected? This becomes the cancellation reason.'
                  : 'Optional sign-off note (audit-captured).'
            }
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
        </label>
        <p className="mt-1 text-right font-mono text-[10px] text-zinc-600">
          {notes.length} / 1000
        </p>
      </section>

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{state.error}</p>
        </div>
      )}

      <ReviewSubmit decision={decision} blocked={false} />
    </form>
  );
}

function DecisionRadio({
  option,
  selected,
  onSelect,
}: {
  option: DecisionOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const toneClasses = {
    green: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
    amber: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber',
    red: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
  } as const;
  const Icon = option.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all',
        selected
          ? `${toneClasses[option.tone]} ring-2 ring-inset ring-current/30`
          : 'border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:bg-white/[0.04]',
      )}
    >
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          selected ? 'bg-current/10' : 'bg-white/[0.04]',
        )}
      >
        <Icon className={cn('h-4 w-4', selected ? '' : 'text-zinc-400')} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', selected ? '' : 'text-zinc-100')}>{option.label}</p>
        <p className={cn('mt-0.5 text-xs leading-relaxed', selected ? 'opacity-90' : 'text-zinc-500')}>
          {option.copy}
        </p>
      </div>
    </button>
  );
}

function ReviewSubmit({
  decision,
  blocked,
}: {
  decision: JobModerationDecision;
  blocked: boolean;
}) {
  const { pending } = useFormStatus();
  const label =
    decision === 'approved'
      ? 'Confirm — approve job'
      : decision === 'edits_requested'
        ? 'Confirm — request edits'
        : 'Confirm — reject (cancel)';
  const disabled = pending || blocked;
  return (
    <div className="space-y-2">
      <button
        type="submit"
        disabled={disabled}
        className="btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
      >
        <Gavel className="h-4 w-4" />
        {pending ? 'Recording…' : label}
      </button>
      {blocked && (
        <p className="text-center text-[11px] text-accent-amber">
          Set the inspector payout above to enable approval.
        </p>
      )}
    </div>
  );
}

function SuccessPanel({ state }: { state: ReviewJobActionState }) {
  if (!state.reviewed) return null;
  const { moderation_status, job_status, correlation_id } = state.reviewed;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-accent-green/40 bg-accent-green/10 p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-green/20 text-accent-green">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-white">
              Moderation recorded.
            </p>
            <p className="text-xs text-zinc-400">
              moderation_status ={' '}
              <span className="font-mono text-accent-green">{moderation_status}</span>
              {job_status && (
                <>
                  {' · '}status ={' '}
                  <span className="font-mono text-zinc-200">{job_status}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
      {correlation_id && (
        <Link
          href={`/admin/audit?correlationId=${correlation_id}`}
          className="inline-flex items-center gap-2 rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs font-medium text-violet-glow transition-colors hover:bg-violet/20"
        >
          <Link2 className="h-3.5 w-3.5" />
          View this review in the Audit Trail
        </Link>
      )}
      <p className="text-[11px] text-zinc-500">This drawer will close in a moment.</p>
    </div>
  );
}

function compactTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  } catch {
    return iso;
  }
}
