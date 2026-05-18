// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/wallet/page.tsx — Inspector wallet + Stripe Connect status
//
//  MVP: display-only. Balance + Stripe Connect status. The "Connect Stripe"
//  CTA stubs to /contact?channel=support until Sprint 7B wires the
//  create-stripe-connect-link edge function.
//
//  Stripe egress (process-payout) stays super_admin only — Golden Rule #6.
//  Nothing on this page calls a payout function.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import {
  Wallet,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Plug,
  Info,
} from 'lucide-react';
import { fetchInspectorProfile } from '@/lib/data/inspectorProfile';
import type { StripeConnectStatus } from '@/lib/data/inspectorProfile.types';

export const metadata: Metadata = {
  title: 'Wallet',
};

export const dynamic = 'force-dynamic';

export default async function InspectorWalletPage() {
  const profile = await fetchInspectorProfile();
  if (!profile) redirect('/inspector/dashboard');

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal · Wallet
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Earnings & payouts
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Your platform balance and payout connection. NEXPEC processes
          every payout through Stripe Connect; we don&apos;t hold or
          re-route inspector funds.
        </p>
      </header>

      {/* Balance + Connect status row */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalanceCard balanceCents={profile.balanceCents} />
        <div className="lg:col-span-2">
          <ConnectCard
            status={profile.stripeConnectStatus}
            payoutsEnabled={profile.stripeConnectPayoutsEnabled}
            onboardedAt={profile.stripeConnectOnboardedAt}
            stripeConnectId={profile.stripeConnectId}
          />
        </div>
      </section>

      {/* How payouts work */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="font-display text-sm font-semibold uppercase tracking-industrial text-zinc-500">
          How payouts work
        </h2>
        <ol className="mt-4 space-y-3 text-sm text-zinc-400">
          <Step
            n={1}
            text="Job completed. You submit a signed report; admin reviews technical + financial integrity."
          />
          <Step
            n={2}
            text="Client final-confirms the report. Their approval is a signal — they don't move money."
          />
          <Step
            n={3}
            text="Admin runs Stripe Connect payout. Funds settle to your connected account on Stripe's schedule (typically 2 business days)."
          />
          <Step
            n={4}
            text="Status here moves from 'unpaid' → 'processing' → 'paid'. You'll see the payout reference on the corresponding job."
          />
        </ol>
        <p className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-zinc-400">
          <Info className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
          NEXPEC never holds your funds. Payouts flow directly from
          escrow to your Stripe-connected account; we earn only the
          platform spread set per-job by ops.
        </p>
      </section>
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function BalanceCard({ balanceCents }: { balanceCents: number }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-violet/30 bg-gradient-to-b from-violet/[0.08] to-violet/[0.02] p-6 sm:p-8">
      <div className="flex items-center gap-2 text-violet-glow">
        <Wallet className="h-4 w-4" strokeWidth={1.75} />
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          Available balance
        </p>
      </div>
      <p className="mt-4 font-mono text-4xl font-semibold tracking-tight text-violet-glow">
        {formatBalance(balanceCents)}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Earnings that have cleared admin review and are queued for
        payout to your Stripe account. Live balance updates within
        seconds of a job completing.
      </p>
    </article>
  );
}

function ConnectCard({
  status,
  payoutsEnabled,
  onboardedAt,
  stripeConnectId,
}: {
  status: StripeConnectStatus;
  payoutsEnabled: boolean;
  onboardedAt: string | null;
  stripeConnectId: string | null;
}) {
  if (status === 'verified' && payoutsEnabled) {
    return (
      <article className="overflow-hidden rounded-3xl border border-accent-green/30 bg-gradient-to-br from-accent-green/[0.08] to-accent-green/[0.02] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-green/10 text-accent-green ring-1 ring-inset ring-accent-green/30">
            <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="flex-1">
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Stripe Connect verified — payouts enabled
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {onboardedAt
                ? `Connected ${new Date(onboardedAt).toLocaleDateString()}.`
                : 'Connected and ready.'}{' '}
              Payouts flow to this account on completion.
            </p>
            {stripeConnectId && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
                Connect ID · <span className="text-zinc-400">{stripeConnectId.slice(0, 16)}…</span>
              </p>
            )}
          </div>
        </div>
      </article>
    );
  }

  if (status === 'pending') {
    return (
      <article className="overflow-hidden rounded-3xl border border-cyan-glow/30 bg-gradient-to-br from-cyan-glow/[0.08] to-cyan-glow/[0.02] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <Clock className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Stripe onboarding in progress
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              You&apos;ve started Stripe Connect setup but a step is
              outstanding. Open the Stripe dashboard from the email Stripe
              sent you, finish KYC, and we&apos;ll sync within minutes.
            </p>
          </div>
        </div>
      </article>
    );
  }

  if (status === 'restricted' || status === 'disabled') {
    return (
      <article className="overflow-hidden rounded-3xl border border-accent-amber/30 bg-gradient-to-br from-accent-amber/[0.08] to-accent-amber/[0.02] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-amber/10 text-accent-amber ring-1 ring-inset ring-accent-amber/30">
            <AlertTriangle className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Stripe Connect {status === 'restricted' ? 'restricted' : 'disabled'}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Stripe flagged your account. Open the email from Stripe with
              the resolution steps, or contact our support team to
              coordinate.
            </p>
            <Link
              href="/contact?channel=support"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-accent-amber/40 bg-accent-amber/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-amber hover:bg-accent-amber/20"
            >
              Talk to support
            </Link>
          </div>
        </div>
      </article>
    );
  }

  // not_connected (default) — show onboarding CTA.
  return (
    <article className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet/10 text-violet-glow ring-1 ring-inset ring-violet/30">
          <Plug className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-white">
            Connect Stripe to receive payouts
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            One-time KYC, takes about 5 minutes. Without a connected
            Stripe account, completed jobs can&apos;t pay out — earnings
            queue in your balance instead.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/contact?channel=support"
              className="btn-primary inline-flex items-center gap-2"
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={2} />
              Start Stripe onboarding
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              5 minutes
            </span>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
            Onboarding currently routes through support while we wire the
            direct Stripe Connect link. Tag your message{' '}
            <span className="font-mono text-zinc-400">[stripe-connect]</span>{' '}
            and we&apos;ll send you the secure onboarding URL within one
            business hour.
          </p>
        </div>
      </div>
    </article>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet/15 font-mono text-[11px] font-semibold text-violet-glow ring-1 ring-inset ring-violet/30">
        {n}
      </span>
      <span className="flex-1 leading-relaxed">{text}</span>
    </li>
  );
}

function formatBalance(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(dollars);
}

// XCircle is unused but imported above — silence the dead-import lint in
// the production build by referencing it conditionally. (Real future:
// surface a "Disconnect" CTA in a confirm dialog → uses XCircle icon.)
void XCircle;
