'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  X,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Link2,
  Gavel,
} from 'lucide-react';
import { formatCents, type DisputeResolution } from '@nexpec/shared-core';
import {
  resolveDispute,
  resolveDisputeInitialState,
  type ResolveDisputeActionState,
} from '@/lib/actions/disputes';
import type { DisputeJob, DisputeTimelineEvent } from '@/lib/data/disputesQueue.types';
import { cn } from '@/lib/cn';

interface DisputesDrawerProps {
  job: DisputeJob | null;
  timeline: DisputeTimelineEvent[];
}

interface ResolutionOption {
  value: DisputeResolution;
  label: string;
  copy: string;
  icon: typeof CheckCircle2;
  tone: 'green' | 'red' | 'violet';
}

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  {
    value: 'completed',
    label: 'Pay inspector',
    copy: 'Rules in favour of the inspector. Job moves to completed. Escrow releases via the payouts pipeline.',
    icon: CheckCircle2,
    tone: 'green',
  },
  {
    value: 'cancelled',
    label: 'Refund client',
    copy: 'Rules in favour of the client. Job moves to cancelled. Escrow returns to the buyer via the refunds pipeline.',
    icon: XCircle,
    tone: 'red',
  },
  {
    value: 'in_progress',
    label: 'Return to active',
    copy: 'Mediation succeeded. Job moves back to in_progress and the inspector resumes work.',
    icon: RotateCcw,
    tone: 'violet',
  },
];

export function DisputesDrawer({ job, timeline }: DisputesDrawerProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const open = !!job;

  const [selected, setSelected] = useState<DisputeResolution>('completed');
  const [reason, setReason] = useState('');

  // Reset form state when the drawer's job changes.
  useEffect(() => {
    setSelected('completed');
    setReason('');
  }, [job?.id]);

  const [state, formAction] = useActionState<ResolveDisputeActionState, FormData>(
    resolveDispute,
    resolveDisputeInitialState,
  );

  // Auto-close on success.
  useEffect(() => {
    if (!state.ok || !state.resolved) return;
    const t = setTimeout(() => close(), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.resolved?.job_id]);

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
    next.delete('jobId');
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
            aria-labelledby="dispute-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-accent-amber">
                  <Gavel className="h-3 w-3" />
                  Dispute Resolution
                </p>
                <h2
                  id="dispute-drawer-title"
                  className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white"
                >
                  {job.title ?? 'Untitled job'}
                </h2>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  Escrow at stake ·{' '}
                  <span className="font-mono font-semibold text-accent-amber">
                    {formatCents(job.client_price_cents)}
                  </span>
                </p>
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
              {state.ok && state.resolved ? (
                <SuccessPanel state={state} />
              ) : (
                <DisputeBody
                  job={job}
                  timeline={timeline}
                  selected={selected}
                  setSelected={setSelected}
                  reason={reason}
                  setReason={setReason}
                  state={state}
                  formAction={formAction}
                />
              )}
            </div>

            <footer className="border-t border-white/[0.06] px-6 py-3">
              <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                rpc · admin_resolve_dispute · FOR UPDATE lock · audit-stamped ·
                guard_jobs_status_transition validated
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

interface DisputeBodyProps {
  job: DisputeJob;
  timeline: DisputeTimelineEvent[];
  selected: DisputeResolution;
  setSelected: (v: DisputeResolution) => void;
  reason: string;
  setReason: (v: string) => void;
  state: ResolveDisputeActionState;
  formAction: (formData: FormData) => void;
}

function DisputeBody({
  job,
  timeline,
  selected,
  setSelected,
  reason,
  setReason,
  state,
  formAction,
}: DisputeBodyProps) {
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="jobId" value={job.id} />
      <input type="hidden" name="resolution" value={selected} />

      {/* Parties */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Parties
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <PartyCell
            label="Client"
            name={job.client_name}
            email={job.client_email}
          />
          <PartyCell
            label="Inspector"
            name={job.contractor_name}
            email={job.contractor_email}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3 text-xs">
          <div>
            <dt className="text-zinc-500">Client charge</dt>
            <dd className="mt-0.5 font-mono font-semibold text-zinc-200">
              {formatCents(job.client_price_cents)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Inspector payout</dt>
            <dd className="mt-0.5 font-mono font-semibold text-cyan-glow">
              {formatCents(job.payout_amount_cents)}
            </dd>
          </div>
        </div>
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
                    <span>{ev.actor_label ?? ev.actor_role ?? 'system'}</span>
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

      {/* Resolution picker */}
      <section>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Resolution
        </p>
        <div className="space-y-2">
          {RESOLUTION_OPTIONS.map((opt) => (
            <ResolutionRadio
              key={opt.value}
              option={opt}
              selected={selected === opt.value}
              onSelect={() => setSelected(opt.value)}
            />
          ))}
        </div>
      </section>

      {/* Reason */}
      <section>
        <label htmlFor="dispute-reason" className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            Reason (audit-captured)
          </span>
          <textarea
            id="dispute-reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={1000}
            rows={4}
            placeholder="Describe the evidence reviewed, the rationale, and any commitments made. This text is preserved verbatim in the audit trail."
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
        </label>
        <p className="mt-1 text-right font-mono text-[10px] text-zinc-600">
          {reason.length} / 1000
        </p>
      </section>

      {/* Error band */}
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{state.error}</p>
        </div>
      )}

      <ResolveSubmit selected={selected} />
    </form>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function ResolutionRadio({
  option,
  selected,
  onSelect,
}: {
  option: ResolutionOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const toneClasses = {
    green: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
    red: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
    violet: 'border-violet/40 bg-violet/10 text-violet-glow',
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
        <Icon
          className={cn('h-4 w-4', selected ? '' : 'text-zinc-400')}
          strokeWidth={2}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', selected ? '' : 'text-zinc-100')}>
          {option.label}
        </p>
        <p className={cn('mt-0.5 text-xs leading-relaxed', selected ? 'opacity-90' : 'text-zinc-500')}>
          {option.copy}
        </p>
      </div>
    </button>
  );
}

function PartyCell({
  label,
  name,
  email,
}: {
  label: string;
  name: string | null;
  email: string | null;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-white">
        {name ?? email ?? '—'}
      </p>
      {name && email && (
        <p className="truncate font-mono text-[10px] text-zinc-500">{email}</p>
      )}
    </div>
  );
}

function ResolveSubmit({ selected }: { selected: DisputeResolution }) {
  const { pending } = useFormStatus();
  const label =
    selected === 'completed'
      ? 'Confirm — pay inspector'
      : selected === 'cancelled'
        ? 'Confirm — refund client'
        : 'Confirm — return to active';
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
    >
      <Gavel className="h-4 w-4" />
      {pending ? 'Resolving…' : label}
    </button>
  );
}

function SuccessPanel({ state }: { state: ResolveDisputeActionState }) {
  if (!state.resolved) return null;
  const { to_status, correlation_id } = state.resolved;
  const headline =
    to_status === 'completed'
      ? 'Resolved — inspector will be paid'
      : to_status === 'cancelled'
        ? 'Resolved — client will be refunded'
        : 'Resolved — returned to active';
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-accent-green/40 bg-accent-green/10 p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-green/20 text-accent-green">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-white">
              {headline}
            </p>
            <p className="text-xs text-zinc-400">
              Job moved <span className="font-mono">disputed</span> →{' '}
              <span className="font-mono text-accent-green">{to_status}</span>.
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
          View this resolution in the Audit Trail
        </Link>
      )}
      <p className="text-[11px] text-zinc-500">
        This drawer will close in a moment.
      </p>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function compactTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  } catch {
    return iso;
  }
}
