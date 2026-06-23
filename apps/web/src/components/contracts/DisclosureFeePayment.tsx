'use client';
// components/contracts/DisclosureFeePayment.tsx
//   Web-only Stripe card collection for the Named-Disclosure VIP premium fee.
//   Renders an embedded PaymentElement against a server-created PaymentIntent
//   (create-disclosure-fee-intent). On confirmation the payments webhook
//   settles the fee and lifts identity escrow — this component only collects.
//
//   Intentionally bypasses native IAP: the charge is a direct card/bank
//   payment for a real-world inspection service (App Store 3.1.1 / Play
//   Billing real-world-service posture), and is surfaced on web only.
import { useMemo } from 'react';
import { loadStripe, type Stripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState } from 'react';
import { ShieldCheck, Lock } from 'lucide-react';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// Module-singleton so Stripe.js is loaded once per session.
let _stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!_stripePromise) {
    _stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : Promise.resolve(null);
  }
  return _stripePromise;
}

function PayInner({
  feeLabel, onPaid,
}: {
  feeLabel: string;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    if (error) {
      setBusy(false);
      setErr(error.message ?? 'Payment could not be completed.');
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      // Settlement (identity reveal) is finalized server-side by the webhook.
      onPaid();
      return;
    }
    setBusy(false);
    setErr('Payment was not completed. Please try again.');
  };

  return (
    <div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
        <span className="text-sm text-zinc-300">Amount due now</span>
        <span className="text-sm font-bold text-amber-200">{feeLabel}</span>
      </div>
      <div className="mt-3 rounded-xl border border-white/[0.06] bg-ink-950 p-3">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {err && <p className="mt-2 text-sm text-accent-red">{err}</p>}
      <button
        onClick={pay}
        disabled={busy || !stripe || !elements}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 py-3 font-bold text-ink-950 transition hover:from-amber-300 hover:to-amber-200 disabled:opacity-60"
      >
        {busy ? 'Processing…' : 'Pay & unlock'} <ShieldCheck className="h-4 w-4" />
      </button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500">
        <Lock className="h-3 w-3" /> Secured by Stripe. Your card is charged directly for this real-world engagement.
      </p>
    </div>
  );
}

export function DisclosureFeePayment({
  clientSecret, feeLabel, onPaid,
}: {
  clientSecret: string;
  feeLabel: string;
  onPaid: () => void;
}) {
  const options = useMemo<StripeElementsOptions>(
    () => ({
      clientSecret,
      appearance: {
        theme: 'night',
        variables: { colorPrimary: '#8b5cf6', colorBackground: '#0b0b12', borderRadius: '10px' },
      },
    }),
    [clientSecret],
  );

  if (!PUBLISHABLE_KEY) {
    return (
      <p className="mt-3 rounded-xl border border-accent-red/30 bg-accent-red/[0.07] px-4 py-3 text-center text-[12px] text-zinc-300">
        Card payments are not configured. Set <code className="text-zinc-200">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to enable the unlock fee.
      </p>
    );
  }

  return (
    <Elements stripe={getStripe()} options={options}>
      <PayInner feeLabel={feeLabel} onPaid={onPaid} />
    </Elements>
  );
}
