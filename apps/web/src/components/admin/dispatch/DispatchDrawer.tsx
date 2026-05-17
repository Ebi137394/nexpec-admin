'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  X,
  Send,
  AlertTriangle,
  CheckCircle2,
  Link2,
} from 'lucide-react';
import { formatCents, dollarsToCents } from '@nexpec/shared-core';
import {
  dispatchJob,
  dispatchInitialState,
  type DispatchActionState,
} from '@/lib/actions/dispatch';
import type { DispatchJob, DispatchApplication } from '@/lib/data/dispatchQueue.types';
import { SpreadVisualization } from './SpreadVisualization';

interface DispatchDrawerProps {
  /** Server-fetched job (with its CLIENT_SELECTED applications) — null
   *  closes the drawer. */
  job: DispatchJob | null;
  /** Application id from `?appId=`. */
  applicationId: string | null;
}

export function DispatchDrawer({ job, applicationId }: DispatchDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = !!job;

  const application = useMemo<DispatchApplication | null>(() => {
    if (!job || !applicationId) return null;
    return job.applications.find((a) => a.id === applicationId) ?? null;
  }, [job, applicationId]);

  /* ── Form state — controlled inputs so the visualizer can read them ── */
  const [clientPriceInput, setClientPriceInput] = useState('');
  const [payoutInput, setPayoutInput] = useState('');

  // When the application changes, reseed payout from the inspector's bid.
  useEffect(() => {
    if (application?.payout_amount_cents != null) {
      setPayoutInput((application.payout_amount_cents / 100).toFixed(2));
    } else {
      setPayoutInput('');
    }
    setClientPriceInput('');
  }, [application?.id, application?.payout_amount_cents]);

  /* ── Server action wiring ─────────────────────────────────────────── */
  const [state, formAction] = useActionState<DispatchActionState, FormData>(
    dispatchJob,
    dispatchInitialState,
  );

  // On success, close the drawer.
  useEffect(() => {
    if (!state.ok || !state.dispatched) return;
    const t = setTimeout(() => close(), 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.dispatched?.job_id]);

  // Escape closes (unless we're mid-success-toast).
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
    next.delete('appId');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const clientPriceCents = dollarsToCents(clientPriceInput);
  const payoutCents = dollarsToCents(payoutInput);

  return (
    <AnimatePresence>
      {open && job && application && (
        <>
          {/* backdrop — clicking it does NOT close; financial action,
              we want explicit dismissal */}
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
            aria-labelledby="dispatch-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
            {/* Header */}
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
                  Confirm &amp; Dispatch
                </p>
                <h2
                  id="dispatch-drawer-title"
                  className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white"
                >
                  {job.title ?? 'Untitled job'}
                </h2>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  Inspector ·{' '}
                  <span className="text-zinc-300">
                    {application.applicant_name ?? application.applicant_email ?? '—'}
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

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Success state */}
              {state.ok && state.dispatched ? (
                <SuccessPanel state={state} />
              ) : (
                <DispatchForm
                  job={job}
                  application={application}
                  clientPriceInput={clientPriceInput}
                  setClientPriceInput={setClientPriceInput}
                  payoutInput={payoutInput}
                  setPayoutInput={setPayoutInput}
                  clientPriceCents={clientPriceCents}
                  payoutCents={payoutCents}
                  state={state}
                  formAction={formAction}
                />
              )}
            </div>

            {/* Footer microcopy */}
            <footer className="border-t border-white/[0.06] px-6 py-3">
              <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                rpc · admin_dispatch_job · atomic across job, application,
                siblings · audit-stamped
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

interface DispatchFormProps {
  job: DispatchJob;
  application: DispatchApplication;
  clientPriceInput: string;
  setClientPriceInput: (v: string) => void;
  payoutInput: string;
  setPayoutInput: (v: string) => void;
  clientPriceCents: number | null;
  payoutCents: number | null;
  state: DispatchActionState;
  formAction: (formData: FormData) => void;
}

function DispatchForm({
  job,
  application,
  clientPriceInput,
  setClientPriceInput,
  payoutInput,
  setPayoutInput,
  clientPriceCents,
  payoutCents,
  state,
  formAction,
}: DispatchFormProps) {
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="jobId" value={job.id} />
      <input type="hidden" name="applicationId" value={application.id} />

      {/* Context summary */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Context
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-zinc-500">Client</dt>
            <dd className="mt-0.5 font-medium text-zinc-200">
              {job.client_name ?? job.client_email ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Location</dt>
            <dd className="mt-0.5 font-medium text-zinc-200">{job.location ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Inspector bid</dt>
            <dd className="mt-0.5 font-mono font-semibold text-cyan-glow">
              {formatCents(application.payout_amount_cents)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Job posted payout</dt>
            <dd className="mt-0.5 font-mono font-semibold text-zinc-200">
              {formatCents(job.posted_payout_cents)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Inputs */}
      <section className="space-y-4">
        <MoneyField
          label="Client charge"
          name="clientPriceDollars"
          value={clientPriceInput}
          onChange={setClientPriceInput}
          hint="The total the buyer is billed. Enter the agreed quote."
          autoFocus
        />
        <MoneyField
          label="Inspector payout"
          name="payoutDollars"
          value={payoutInput}
          onChange={setPayoutInput}
          hint="Defaults to the inspector's bid. Override only if you negotiated a different rate."
        />
      </section>

      {/* Live margin */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Spread
        </p>
        <SpreadVisualization
          clientPriceCents={clientPriceCents}
          payoutCents={payoutCents}
        />
      </section>

      {/* Error band */}
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{state.error}</p>
        </div>
      )}

      {/* Submit */}
      <DispatchSubmit />

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        Dispatch is atomic. The RPC flips the job to <code className="font-mono text-zinc-400">assigned</code>,
        promotes this application to <code className="font-mono text-zinc-400">hired</code>, and rejects every
        sibling — in one transaction.
      </p>
    </form>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function MoneyField({
  label,
  name,
  value,
  onChange,
  hint,
  autoFocus,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  autoFocus?: boolean;
}) {
  const inputId = `field-${name}`;
  return (
    <label htmlFor={inputId} className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
        {label}
      </span>
      <span className="relative block">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-zinc-500">
          $
        </span>
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-7 pr-4 font-mono text-base text-white placeholder:text-zinc-700 transition-all focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
        />
      </span>
      {hint && <span className="mt-1.5 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

/** Submit button reads pending state via useFormStatus inside the form. */
function DispatchSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
    >
      <Send className="h-4 w-4" />
      {pending ? 'Dispatching…' : 'Confirm & Dispatch'}
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function SuccessPanel({ state }: { state: DispatchActionState }) {
  if (!state.dispatched) return null;
  const corr = state.dispatched.correlation_id;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-accent-green/40 bg-accent-green/10 p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-green/20 text-accent-green">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-white">
              Dispatched.
            </p>
            <p className="text-xs text-zinc-400">
              The job is now <span className="font-mono text-accent-green">assigned</span>,
              the inspector has been hired, and{' '}
              <span className="font-mono text-zinc-200">
                {state.dispatched.rejected_siblings}
              </span>{' '}
              sibling application
              {state.dispatched.rejected_siblings === 1 ? '' : 's'} were rejected.
            </p>
          </div>
        </div>
      </div>

      {corr && (
        <Link
          href={`/admin/audit?correlationId=${corr}`}
          className="inline-flex items-center gap-2 rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs font-medium text-violet-glow transition-colors hover:bg-violet/20"
        >
          <Link2 className="h-3.5 w-3.5" />
          View this dispatch in the Audit Trail
        </Link>
      )}

      <p className="text-[11px] text-zinc-500">
        This drawer will close in a moment.
      </p>
    </div>
  );
}
