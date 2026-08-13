'use client';
// ════════════════════════════════════════════════════════════════════════════
//  client/jobs/[id]/funding/StagePaymentDialog.tsx
//
//  Card collection for ONE funding tranche.
//
//  ── THERE IS EXACTLY ONE PAYMENT PATH, AND THIS IS NOT A SECOND ONE ────────
//  This component creates no PaymentIntent. The only intent factory in the
//  whole flow is supabase/functions/create-payment-intent, invoked below with
//  { job_id, stage } — the same function the mobile payment screen calls
//  (app/payment-screen.tsx:64-67). It is already stage-aware:
//
//    index.ts:198  stageCode is read from the body and validated against
//                  ['initial','final','retention']
//    index.ts:249-282  the amount is read from job_funding_stages.amount_cents
//                  server-side, NEVER from this request body
//    index.ts:275-280  a tranche already 'funded' or 'waived' is refused
//                  with ALREADY_FUNDED (409)
//    index.ts:324  idempotencyKey = `nexpec_pi_${job.id}_${stageCode}`
//
//  ── PER-STAGE IDEMPOTENT RETRY ─────────────────────────────────────────────
//  Retrying a tranche must never double-charge. Three independent guards, none
//  of them this component's invention:
//    1. Stripe idempotency key scoped per (job, stage) — a repeat request
//       returns the SAME PaymentIntent instead of minting a second one.
//    2. ALREADY_FUNDED refuses a settled tranche outright.
//    3. job_funding_stages_pi_uq (migration §2) — one PaymentIntent settles at
//       most one stage, ever.
//  What this component adds is the honest UI half: before showing a pay button
//  on a retry it RETRIEVES the intent and, if it is already succeeded or
//  processing, refuses to collect a card again and says so.
//
//  ── THIS SCREEN MOVES NO MONEY TO ANYONE ───────────────────────────────────
//  Funding a tranche records that the CLIENT paid. It never credits the
//  Inspector and never settles anything: nx_funding_mark_stage_funded is
//  service-role-only and is deliberately absent from net/fundingReview.ts, so
//  no surface — including this one — can reach it.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadStripe,
  type Stripe,
  type StripeElementsOptions,
} from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import { formatCents } from '@nexpec/shared-core/domain';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// Module singleton so Stripe.js loads once per session — same posture as
// components/contracts/DisclosureFeePayment.tsx:20-26.
let _stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!_stripePromise) {
    _stripePromise = PUBLISHABLE_KEY
      ? loadStripe(PUBLISHABLE_KEY)
      : Promise.resolve(null);
  }
  return _stripePromise;
}

interface IntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  /** Integer cents, read server-side from job_funding_stages.amount_cents. */
  amount: number;
  currency: string;
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'preparing' }
  | { kind: 'collect'; intent: IntentResponse }
  | { kind: 'in_flight'; amountCents: number }
  | { kind: 'settled' }
  | { kind: 'error'; message: string; code: string | null };

export interface StagePaymentDialogProps {
  jobId: string;
  jobTitle: string;
  stageCode: string;
  stageLabel: string;
  gateCopy: string;
  /** Indicative, from the schedule. The binding figure comes from the server. */
  scheduledAmountCents: number;
  pctLabel: string;
  onClose: () => void;
  /** Called after a successful confirmation so the parent can re-read. */
  onPaymentSubmitted: () => void;
}

/** Pull the Edge Function's machine-readable error out of the invoke failure. */
async function readFunctionError(
  error: unknown,
): Promise<{ message: string; code: string | null }> {
  const err = error as { message?: string; context?: unknown };
  const ctx = err?.context as { json?: () => Promise<unknown> } | undefined;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as {
        error?: unknown;
        code?: unknown;
      } | null;
      const message =
        typeof body?.error === 'string' ? body.error : undefined;
      const code = typeof body?.code === 'string' ? body.code : null;
      if (message) return { message, code };
      if (code) return { message: 'Payment could not be started.', code };
    } catch {
      /* body was not JSON — fall through to the generic message */
    }
  }
  return {
    message:
      typeof err?.message === 'string' && err.message
        ? err.message
        : 'Payment could not be started. Please try again.',
    code: null,
  };
}

export function StagePaymentDialog(props: StagePaymentDialogProps) {
  const {
    jobId,
    jobTitle,
    stageCode,
    stageLabel,
    gateCopy,
    scheduledAmountCents,
    pctLabel,
    onClose,
    onPaymentSubmitted,
  } = props;

  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const headingId = `funding-pay-${stageCode}`;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Ask the ONE existing edge function for this tranche's intent, then check
   * whether that intent has already been paid before offering a card form.
   */
  const prepare = useCallback(async () => {
    setPhase({ kind: 'preparing' });

    if (!PUBLISHABLE_KEY) {
      setPhase({
        kind: 'error',
        message:
          'Card payments are not configured for this environment. Contact support and we will take the tranche by bank transfer.',
        code: 'NO_PUBLISHABLE_KEY',
      });
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.functions.invoke(
      'create-payment-intent',
      // The amount is NOT sent. The server reads it from the funding schedule.
      { body: { job_id: jobId, stage: stageCode } },
    );

    if (!alive.current) return;

    if (error) {
      const parsed = await readFunctionError(error);
      if (!alive.current) return;
      if (parsed.code === 'ALREADY_FUNDED') {
        setPhase({ kind: 'settled' });
        onPaymentSubmitted();
        return;
      }
      setPhase({ kind: 'error', ...parsed });
      return;
    }

    const intent = data as IntentResponse | null;
    if (!intent?.clientSecret || !Number.isFinite(intent.amount)) {
      setPhase({
        kind: 'error',
        message:
          'The payment could not be prepared. Nothing has been charged. Please try again.',
        code: 'NO_CLIENT_SECRET',
      });
      return;
    }

    // ── Idempotent-retry guard, client half ──────────────────────────────
    // Because the idempotency key is scoped per (job, stage), a retry hands
    // back the SAME PaymentIntent. If that intent already succeeded, showing
    // a card form again would invite a second attempt at a paid tranche.
    const stripe = await getStripe();
    if (!alive.current) return;
    if (stripe) {
      const { paymentIntent } = await stripe.retrievePaymentIntent(
        intent.clientSecret,
      );
      if (!alive.current) return;
      if (
        paymentIntent?.status === 'succeeded' ||
        paymentIntent?.status === 'processing'
      ) {
        setPhase({ kind: 'in_flight', amountCents: intent.amount });
        onPaymentSubmitted();
        return;
      }
    }

    setPhase({ kind: 'collect', intent });
  }, [jobId, stageCode, onPaymentSubmitted]);

  const elementsOptions = useMemo<StripeElementsOptions | null>(() => {
    if (phase.kind !== 'collect') return null;
    return {
      clientSecret: phase.intent.clientSecret,
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary: '#7C3AED',
          colorBackground: '#020420',
          borderRadius: '10px',
        },
      },
    };
  }, [phase]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-violet/30 bg-gradient-to-b from-ink-900 to-ink-950 shadow-2xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close payment dialog"
          className="absolute right-3 top-3 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className="p-6 sm:p-7">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
          </span>

          <p className="mt-4 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            {stageLabel}, {pctLabel} tranche
          </p>
          <h2
            id={headingId}
            className="mt-1 font-display text-xl font-semibold tracking-tight text-white"
          >
            {phase.kind === 'settled'
              ? 'This tranche is already settled'
              : phase.kind === 'in_flight'
                ? 'Payment already received'
                : 'Confirm this funding tranche'}
          </h2>
          <p className="mt-1 truncate text-xs text-zinc-500" title={jobTitle}>
            {jobTitle}
          </p>

          {phase.kind === 'confirm' && (
            <ConfirmStep
              scheduledAmountCents={scheduledAmountCents}
              gateCopy={gateCopy}
              onCancel={onClose}
              onProceed={prepare}
            />
          )}

          {phase.kind === 'preparing' && (
            <p
              role="status"
              className="mt-6 flex items-center gap-2 text-sm text-zinc-400"
            >
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Preparing a secure payment for this tranche. Nothing has been
              charged yet.
            </p>
          )}

          {phase.kind === 'collect' && elementsOptions && (
            <>
              <AmountRow
                amountCents={phase.intent.amount}
                scheduledAmountCents={scheduledAmountCents}
              />
              <Elements stripe={getStripe()} options={elementsOptions}>
                <CollectStep
                  amountCents={phase.intent.amount}
                  onFailed={(message) =>
                    setPhase({ kind: 'error', message, code: 'STRIPE_CONFIRM' })
                  }
                  onSucceeded={() => {
                    setPhase({
                      kind: 'in_flight',
                      amountCents: phase.intent.amount,
                    });
                    onPaymentSubmitted();
                  }}
                />
              </Elements>
            </>
          )}

          {phase.kind === 'in_flight' && (
            <div
              role="status"
              className="mt-5 rounded-2xl border border-accent-green/30 bg-accent-green/[0.07] p-4"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-accent-green">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {formatCents(phase.amountCents)} received
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                Your card has been charged for this tranche. NEXPEC confirms the
                tranche against your job from Stripe&apos;s side, so the status
                above updates on its own within a few moments. Paying again is
                not possible and not necessary.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary mt-4 w-full"
              >
                Done
              </button>
            </div>
          )}

          {phase.kind === 'settled' && (
            <div
              role="status"
              className="mt-5 rounded-2xl border border-accent-green/30 bg-accent-green/[0.07] p-4"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-accent-green">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                Nothing further is owed on this tranche
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                NEXPEC already has this tranche on record, so no card was
                charged. Your funding status has been refreshed.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary mt-4 w-full"
              >
                Close
              </button>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="mt-5">
              <div
                role="alert"
                className="rounded-2xl border border-accent-red/30 bg-accent-red/[0.08] p-4"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-accent-red">
                  <AlertCircle className="h-4 w-4" strokeWidth={2} />
                  Payment not completed
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">
                  {phase.message}
                </p>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Retrying is safe. This tranche has its own payment reference, so
                a repeat attempt reuses the same one rather than creating a
                second charge.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={prepare}
                  className="flex-1 rounded-full border border-violet/40 bg-violet/10 px-4 py-2.5 text-sm font-medium text-violet-glow transition-colors hover:bg-violet/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-full border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── steps ──────────────────────────────────────────────────────────── */

function ConfirmStep({
  scheduledAmountCents,
  gateCopy,
  onCancel,
  onProceed,
}: {
  scheduledAmountCents: number;
  gateCopy: string;
  onCancel: () => void;
  onProceed: () => void;
}) {
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3 rounded-2xl border border-violet/25 bg-violet/[0.07] px-4 py-3.5">
        <span className="text-sm text-zinc-300">Scheduled for this tranche</span>
        <span className="font-mono text-lg font-semibold text-white">
          {formatCents(scheduledAmountCents)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{gateCopy}</p>
      <ul className="mt-4 space-y-2 text-xs leading-relaxed text-zinc-400">
        <li className="flex gap-2">
          <span aria-hidden className="text-violet-glow">
            &bull;
          </span>
          <span>
            You are funding <span className="text-white">this tranche only</span>
            . The other tranches on this job are untouched.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-violet-glow">
            &bull;
          </span>
          <span>
            Funding does <span className="text-white">not</span> pay the
            inspector and does not release anything. NEXPEC holds it and settles
            separately, on your approval.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-violet-glow">
            &bull;
          </span>
          <span>
            The exact amount charged is confirmed on the next step, straight
            from your funding schedule.
          </span>
        </li>
      </ul>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-full border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onProceed}
          className="flex-1 rounded-full bg-violet px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function AmountRow({
  amountCents,
  scheduledAmountCents,
}: {
  amountCents: number;
  scheduledAmountCents: number;
}) {
  // Integer-cents comparison. The server figure wins: it is the row the charge
  // is built from. We only mention the difference so the buyer is never
  // surprised by a rounding cent between the two screens.
  const differs = amountCents !== scheduledAmountCents;
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3 rounded-2xl border border-violet/25 bg-violet/[0.07] px-4 py-3.5">
        <span className="text-sm text-zinc-300">You will be charged</span>
        <span className="font-mono text-lg font-semibold text-white">
          {formatCents(amountCents)}
        </span>
      </div>
      {differs && (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          This is the exact figure on your funding schedule. It differs from the
          estimate shown a moment ago by the rounding the final tranche absorbs.
        </p>
      )}
    </div>
  );
}

function CollectStep({
  amountCents,
  onFailed,
  onSucceeded,
}: {
  amountCents: number;
  onFailed: (message: string) => void;
  onSucceeded: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (error) {
      setBusy(false);
      onFailed(
        error.message ??
          'Your bank did not complete the payment. Nothing was charged.',
      );
      return;
    }
    if (
      paymentIntent &&
      (paymentIntent.status === 'succeeded' ||
        paymentIntent.status === 'processing')
    ) {
      // Settlement of the tranche is finalized server-side, from Stripe. This
      // component never writes funding state.
      onSucceeded();
      return;
    }
    setBusy(false);
    onFailed('The payment was not completed. Please try again.');
  };

  return (
    <div className="mt-3">
      <div className="rounded-2xl border border-white/[0.06] bg-ink-950 p-3">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      <button
        type="button"
        onClick={pay}
        disabled={busy || !stripe || !elements}
        className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Processing&hellip;
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" strokeWidth={2} />
            Pay {formatCents(amountCents)}
          </>
        )}
      </button>
      <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500">
        <Lock className="h-3 w-3" strokeWidth={2} />
        Secured by Stripe. NEXPEC never sees or stores your card details.
      </p>
    </div>
  );
}
