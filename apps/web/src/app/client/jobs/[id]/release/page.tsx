// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/release/page.tsx — Client report approval surface
//
//  GOLDEN_RULE_6 — This page does NOT release any money. The two actions
//  (approve / request revision) write to audit_events. Admin reads the
//  signal in /admin/audit + /admin/payouts and runs the payout via the
//  super_admin process-payout edge function. The client never sees a
//  Stripe Element and never has the option to trigger an inspector payout.
//
//  GOLDEN_RULE_2 — Shows the client's price (their own money). Hides
//  inspector payout / spread. Inspector identity is shown for context
//  only.
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Send,
  ShieldCheck,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { fetchClientJobReport } from '@/lib/data/clientJobReport';
import {
  clientApproveReport,
  clientRequestRevision,
} from '@/lib/actions/clientReport';

export const metadata: Metadata = {
  title: 'Report approval',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    approved?: string;
    revision?: string;
    already?: string;
    error?: string;
  }>;
}

export default async function ClientReleasePage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;
  const state = await fetchClientJobReport(jobId);
  if (!state) notFound();

  const adminHasForwarded = !!state.adminConfirmedAt;
  const signal = state.latestClientSignal;
  const alreadyResolved = signal.kind !== 'none';

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header>
        <Link
          href={`/client/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Report Approval
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {state.jobTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          {adminHasForwarded
            ? 'Our team has reviewed the inspection report and forwarded it for your final confirmation. Approving below signals our team to release payment to the inspector, we move the funds, you stay in control.'
            : "Our team is still reviewing the inspector's report. You'll be notified the moment it's ready for your review."}
        </p>
      </header>

      {/* Action banners */}
      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.approved && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          {qp.already === '1'
            ? 'You had already approved this report. Admin has the signal.'
            : 'Approval recorded. Admin will process the release shortly.'}
        </Banner>
      )}
      {qp.revision && (
        <Banner tone="amber" icon={<RotateCcw className="h-5 w-5" />}>
          Revision request recorded. Our team will reach out via the
          admin chat to coordinate next steps.
        </Banner>
      )}

      {/* Job summary tile */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SummaryTile
          icon={<Send className="h-4 w-4" strokeWidth={1.75} />}
          label="Forwarded by admin"
          value={
            state.adminConfirmedAt
              ? new Date(state.adminConfirmedAt).toLocaleString()
              : 'Pending'
          }
          tone={state.adminConfirmedAt ? 'cyan' : 'default'}
        />
        <SummaryTile
          icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
          label="Inspector on file"
          value={
            state.inspectorFullName ||
            state.inspectorCompanyName ||
            state.inspectorHandle ||
            '—'
          }
        />
        <SummaryTile
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          label="Your price"
          value={formatPrice(state.clientPriceCents)}
          tone="violet"
        />
      </section>

      {/* Decision surface */}
      {!adminHasForwarded ? (
        <PendingAdminCard />
      ) : alreadyResolved ? (
        <ResolvedCard signal={signal} jobId={jobId} />
      ) : (
        <DecisionCard jobId={jobId} />
      )}

      {/* Process explainer (always visible, re-assures the user that this
          is a signal, not a money-mover). */}
      <ProcessExplainer />
    </div>
  );
}

/* ─── decision states ────────────────────────────────────────────────── */

function PendingAdminCard() {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-12 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <Clock className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
        Report still with admin.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
        Our quality-review pass runs before any report reaches you. You&apos;ll
        get an email + in-app notification the moment it&apos;s ready for
        your sign-off.
      </p>
    </section>
  );
}

function ResolvedCard({
  signal,
  jobId,
}: {
  /**
   * Caller only renders this card when signal.kind !== 'none'. Encoding
   * that in the type means TS narrows correctly inside both branches
   * without runtime guards.
   */
  signal:
    | { kind: 'approved'; at: string }
    | { kind: 'revision_requested'; at: string; reason: string | null };
  jobId: string;
}) {
  if (signal.kind === 'approved') {
    return (
      <section className="rounded-3xl border border-cyan-glow/30 bg-cyan-glow/5 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              You approved this report.
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Signal recorded {new Date(signal.at).toLocaleString()}. Our team
              takes it from here, you&apos;ll see the
              completed report in <Link href="/client/reports" className="text-violet-glow hover:text-white">deliverables</Link>.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // revision_requested
  return (
    <section className="rounded-3xl border border-accent-amber/30 bg-accent-amber/5 p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-amber/10 text-accent-amber ring-1 ring-inset ring-accent-amber/30">
          <RotateCcw className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Revision requested.
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Submitted {new Date(signal.at).toLocaleString()}. Our team will
            reach out via the admin chat to coordinate next steps with the
            inspector. The payout stays held.
          </p>
          {signal.reason && (
            <blockquote className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-relaxed text-zinc-300">
              {signal.reason}
            </blockquote>
          )}
          {/* Allow re-submitting another revision request if needed. */}
          <RevisionForm
            jobId={jobId}
            secondary
            buttonLabel="Add another revision note"
          />
        </div>
      </div>
    </section>
  );
}

function DecisionCard({ jobId }: { jobId: string }) {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Approve */}
      <form
        action={clientApproveReport}
        className="rounded-3xl border border-cyan-glow/30 bg-gradient-to-br from-cyan-glow/[0.06] to-cyan-glow/[0.02] p-6 sm:p-8"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
          <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
          Approve report &amp; signal release
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          You accept the inspector&apos;s report as delivered. This signals
          our team to release the funds from the payment hold. We
          move the funds, you don&apos;t handle Stripe yourself.
        </p>
        <button
          type="submit"
          className="btn-primary mt-6 inline-flex w-full items-center justify-center gap-2"
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          Approve &amp; signal admin
        </button>
      </form>

      {/* Request revision */}
      <RevisionForm jobId={jobId} buttonLabel="Submit revision request" />
    </section>
  );
}

function RevisionForm({
  jobId,
  buttonLabel,
  secondary = false,
}: {
  jobId: string;
  buttonLabel: string;
  secondary?: boolean;
}) {
  return (
    <form
      action={clientRequestRevision}
      className={
        secondary
          ? 'mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5'
          : 'rounded-3xl border border-accent-amber/30 bg-gradient-to-br from-accent-amber/[0.06] to-accent-amber/[0.02] p-6 sm:p-8'
      }
    >
      <input type="hidden" name="jobId" value={jobId} />
      {!secondary && (
        <>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-amber/10 text-accent-amber ring-1 ring-inset ring-accent-amber/30">
            <RotateCcw className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
            Request revision
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Report has gaps, needs clarification, or doesn&apos;t match
            scope. Our team mediates, the inspector won&apos;t see your
            note directly, only the admin response.
          </p>
        </>
      )}

      <label
        htmlFor="reason"
        className={`mt-5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500 ${secondary ? 'mt-0' : ''}`}
      >
        What needs revisiting?
      </label>
      <textarea
        id="reason"
        name="reason"
        required
        minLength={10}
        maxLength={2000}
        rows={4}
        placeholder="Be specific, admin will translate this into actions for the inspector."
        className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-amber/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-accent-amber/30"
      />
      <button
        type="submit"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-accent-amber/40 bg-accent-amber/10 px-5 py-2.5 text-sm font-medium text-accent-amber transition-colors hover:bg-accent-amber/20"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={2} />
        {buttonLabel}
      </button>
    </form>
  );
}

function ProcessExplainer() {
  return (
    <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
      <h2 className="font-display text-sm font-semibold uppercase tracking-industrial text-zinc-500">
        How payment works
      </h2>
      <ol className="mt-4 space-y-3 text-sm text-zinc-400">
        <Step
          n={1}
          text="Inspector submits the final report. It lands on our admin team first, never directly with you or with the inspector's wallet."
        />
        <Step
          n={2}
          text="Admin reviews quality, signature integrity, and audit trail. Only then is the report forwarded to you here."
        />
        <Step
          n={3}
          text="Your approval signals admin. Our team executes the release from the payment hold. You never see card forms, payment hold buttons, or Stripe sheets."
        />
        <Step
          n={4}
          text="If something's off, request a revision. Funds stay on payment hold until you and admin agree the work is complete."
        />
      </ol>
    </section>
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

/* ─── presentational primitives ──────────────────────────────────────── */

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'cyan' | 'red' | 'amber';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    amber: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'violet' | 'cyan';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p className={`mt-2 font-mono text-lg font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{sub}</p>}
    </div>
  );
}

function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}
