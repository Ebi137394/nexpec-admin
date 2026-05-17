'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Receipt,
  CreditCard,
} from 'lucide-react';
import { formatCents, isLikelyStripeTransferId } from '@nexpec/shared-core';
import {
  markPayoutProcessed,
  markPayoutInitialState,
  type MarkPayoutActionState,
} from '@/lib/actions/payouts';
import type { PayoutJob } from '@/lib/data/payoutsQueue.types';
import { cn } from '@/lib/cn';

interface PayoutsDrawerProps {
  job: PayoutJob | null;
}

export function PayoutsDrawer({ job }: PayoutsDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = !!job;

  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  // Reset form state when the drawer's job changes.
  useEffect(() => {
    setReference('');
    setNotes('');
  }, [job?.id]);

  const [state, formAction] = useActionState<MarkPayoutActionState, FormData>(
    markPayoutProcessed,
    markPayoutInitialState,
  );

  useEffect(() => {
    if (!state.ok || !state.paid) return;
    const t = setTimeout(() => close(), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.paid?.job_id]);

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

  const stripeShaped = isLikelyStripeTransferId(reference);

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
            aria-labelledby="payout-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                  <Receipt className="h-3 w-3" />
                  Settle Inspector Payout
                </p>
                <h2
                  id="payout-drawer-title"
                  className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white"
                >
                  {job.title ?? 'Untitled job'}
                </h2>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  Inspector owed ·{' '}
                  <span className="font-mono font-semibold text-cyan-glow">
                    {formatCents(job.payout_amount_cents)}
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
              {state.ok && state.paid ? (
                <SuccessPanel state={state} />
              ) : (
                <PayoutBody
                  job={job}
                  reference={reference}
                  setReference={setReference}
                  notes={notes}
                  setNotes={setNotes}
                  stripeShaped={stripeShaped}
                  state={state}
                  formAction={formAction}
                />
              )}
            </div>

            <footer className="border-t border-white/[0.06] px-6 py-3">
              <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                rpc · admin_mark_payout_processed · FOR UPDATE lock ·
                audit-stamped · ref captured verbatim
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

interface PayoutBodyProps {
  job: PayoutJob;
  reference: string;
  setReference: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  stripeShaped: boolean;
  state: MarkPayoutActionState;
  formAction: (formData: FormData) => void;
}

function PayoutBody({
  job,
  reference,
  setReference,
  notes,
  setNotes,
  stripeShaped,
  state,
  formAction,
}: PayoutBodyProps) {
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="jobId" value={job.id} />

      {/* Context */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Settlement context
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-zinc-500">Inspector</dt>
            <dd className="mt-0.5 truncate font-medium text-zinc-200">
              {job.contractor_name ?? job.contractor_email ?? '—'}
            </dd>
            {job.contractor_name && job.contractor_email && (
              <p className="truncate font-mono text-[10px] text-zinc-500">
                {job.contractor_email}
              </p>
            )}
          </div>
          <div>
            <dt className="text-zinc-500">Client</dt>
            <dd className="mt-0.5 truncate font-medium text-zinc-200">
              {job.client_name ?? job.client_email ?? '—'}
            </dd>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3 text-xs">
          <div>
            <dt className="text-zinc-500">Client charge</dt>
            <dd className="mt-0.5 font-mono font-semibold text-zinc-200">
              {formatCents(job.client_price_cents)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Inspector owed</dt>
            <dd className="mt-0.5 font-mono font-semibold text-cyan-glow">
              {formatCents(job.payout_amount_cents)}
            </dd>
          </div>
        </div>
      </section>

      {/* Reference */}
      <section>
        <label htmlFor="payout-reference" className="block">
          <span className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
              Settlement reference
            </span>
            {reference.trim().length > 0 && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial',
                  stripeShaped
                    ? 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow'
                    : 'border-white/15 bg-white/[0.04] text-zinc-400',
                )}
              >
                <CreditCard className="h-3 w-3" />
                {stripeShaped ? 'Stripe transfer detected' : 'Manual entry'}
              </span>
            )}
          </span>
          <input
            id="payout-reference"
            name="reference"
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required
            maxLength={200}
            placeholder="tr_3RkjzN2X5LpqrAB123 — or — manual:cash-paid-on-site-2026-05-20"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-700 transition-all focus:border-cyan-glow/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-cyan-glow/30"
          />
        </label>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Paste the Stripe Connect transfer id (<code className="font-mono text-zinc-400">tr_…</code>),
          or label a non-Stripe settlement with the{' '}
          <code className="font-mono text-zinc-400">manual:</code> prefix and a
          short context.
        </p>
      </section>

      {/* Notes */}
      <section>
        <label htmlFor="payout-notes" className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            Notes (optional · audit-captured)
          </span>
          <textarea
            id="payout-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="e.g., transfer to inspector via Stripe Connect after report approved; FX-locked at quote time"
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
        </label>
        <p className="mt-1 text-right font-mono text-[10px] text-zinc-600">
          {notes.length} / 1000
        </p>
      </section>

      {/* Error band */}
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{state.error}</p>
        </div>
      )}

      <SettleSubmit />

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        Settlement is atomic. The RPC flips{' '}
        <code className="font-mono text-zinc-400">payout_status</code> to{' '}
        <code className="font-mono text-cyan-glow">paid</code>, stamps the
        reference + operator + timestamp, and writes one audit row tagged with
        the correlation id.
      </p>
    </form>
  );
}

function SettleSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
    >
      <CheckCircle2 className="h-4 w-4" />
      {pending ? 'Settling…' : 'Mark payout processed'}
    </button>
  );
}

function SuccessPanel({ state }: { state: MarkPayoutActionState }) {
  if (!state.paid) return null;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-glow/20 text-cyan-glow">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-white">
              Payout settled.
            </p>
            <p className="text-xs text-zinc-400">
              Reference{' '}
              <span className="font-mono text-cyan-glow">
                {state.paid.reference}
              </span>{' '}
              captured.
            </p>
          </div>
        </div>
      </div>
      {state.paid.correlation_id && (
        <Link
          href={`/admin/audit?correlationId=${state.paid.correlation_id}`}
          className="inline-flex items-center gap-2 rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs font-medium text-violet-glow transition-colors hover:bg-violet/20"
        >
          <Link2 className="h-3.5 w-3.5" />
          View this settlement in the Audit Trail
        </Link>
      )}
      <p className="text-[11px] text-zinc-500">
        This drawer will close in a moment.
      </p>
    </div>
  );
}
