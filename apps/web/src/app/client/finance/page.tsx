// ════════════════════════════════════════════════════════════════════════════
//  app/client/finance/page.tsx — Client finance dashboard
//
//  GOLDEN_RULE_2 — every figure here is the CLIENT'S money. Never
//  inspector_payout_cents or platform_spread_cents.
//
//  Until an invoices table lands (Sprint 10+), invoices + payment method
//  management route through support. The metrics + activity rail derive
//  entirely from the client's job ledger.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Wallet,
  Receipt,
  Briefcase,
  TrendingUp,
  ArrowUpRight,
  ChevronRight,
  PlusCircle,
  CreditCard,
  Building2,
  ScrollText,
  ShieldCheck,
  BarChart3,
  FolderLock,
  Lock,
  Landmark,
  CalendarClock,
} from 'lucide-react';
import { fetchClientFinance } from '@/lib/data/clientFinance';
import { fetchFundingRailJobs } from './fundingRailData';
import { FundingRail } from './FundingRail';
import { PaymentOptions } from '@/components/payments/PaymentOptions';
import type {
  ClientCreditProfile,
  FinanceActivityKind,
  FinanceActivityRow,
  PaymentTerms,
} from '@/lib/data/clientFinance.types';

export const metadata: Metadata = {
  title: 'Finance',
};

export const dynamic = 'force-dynamic';

export default async function ClientFinancePage() {
  const [{ metrics, credit, recentActivity }, fundingRailJobs] = await Promise.all([
    fetchClientFinance(),
    fetchFundingRailJobs(),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal, Finance
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Spend &amp; invoices
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          What you&apos;ve funded, what&apos;s locked on payment hold, and what
          you owe on terms. NEXPEC holds prepaid funds in a dedicated payment-hold
          ledger and releases them to the inspector only on your approval.
        </p>
      </header>

      {/* Staged funding — what is waiting on money from this buyer.
          The only inbound link to /client/jobs/[id]/funding. */}
      <section aria-labelledby="funding-rail-heading">
        <header className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2
              id="funding-rail-heading"
              className="font-display text-lg font-semibold tracking-tight text-white"
            >
              Awaiting your funding
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Jobs with an outstanding tranche. Funding the initial tranche
              authorises the work; the remainder is due before the final signed
              report is delivered.
            </p>
          </div>
        </header>

        <FundingRail jobs={fundingRailJobs} />
      </section>

      {/* Primary metrics */}
      <section
        aria-label="Finance overview"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <MetricTile
          icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}
          label="Total spend, YTD"
          value={formatCurrency(metrics.totalSpendYtdCents)}
          sub="across completed jobs this year"
          tone="violet"
        />
        <MetricTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label="On payment hold"
          value={formatCurrency(metrics.heldInEscrowCents)}
          sub="across active jobs"
          tone="cyan"
        />
        <MetricTile
          icon={<Receipt className="h-4 w-4" strokeWidth={1.75} />}
          label="Released, YTD"
          value={formatCurrency(metrics.paidOutYtdCents)}
          sub="released from your payment holds"
        />
        <MetricTile
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          label="Completed, YTD"
          value={formatCount(metrics.completedJobsYtd)}
          sub={`${formatCount(metrics.activeJobsCount)} currently active`}
        />
      </section>

      {/* How this engagement is settled in the current release. */}
      <PaymentOptions />

      {/* Payment hold vs Credit — the crux: locked cash vs borrowed headroom */}
      <section aria-label="Payment hold versus credit" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EscrowPanel lockedCents={metrics.heldInEscrowCents} />
        <CreditPanel credit={credit} />
      </section>

      {/* Activity ledger */}
      <section>
        <header className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Recent activity
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Latest 25 events derived from your job ledger.
            </p>
          </div>
          <Link
            href="/client/jobs"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-white"
          >
            View all jobs
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </header>

        {recentActivity.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {recentActivity.map((row, i) => (
              <li
                key={row.jobId + '-' + i}
                className="border-b border-white/[0.04] last:border-0"
              >
                <ActivityRow row={row} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* M1 Financial Suite trio — Budget Overview · Compliance Vault */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Link
          href="/client/vault"
          className="group flex items-center gap-4 rounded-3xl border border-amber-500/30 bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.04] to-transparent p-5 transition-colors hover:border-amber-500/50 hover:from-amber-500/[0.12]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30">
            <FolderLock className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-amber-300/80">
              New, Financial Suite
            </p>
            <h2 className="mt-0.5 font-display text-base font-semibold tracking-tight text-white">
              Compliance Vault
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Corporate docs + inspection certificates, admin-verified
            </p>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-300" strokeWidth={2} />
        </Link>
      </div>

      {/* Budget Overview CTA — links to the live spend tracker (M1 Financial Suite) */}
      <Link
        href="/client/budget"
        className="group flex flex-wrap items-center gap-5 rounded-3xl border border-violet/30 bg-gradient-to-r from-violet/[0.08] via-violet/[0.04] to-transparent p-6 transition-colors hover:border-violet/50 hover:from-violet/[0.12] sm:p-8"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <BarChart3 className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            New, Financial Suite
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white">
            Budget Overview
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Live spend tracker, committed budget, payment holds, paid-out
            amounts, 12-month trend, and top inspectors by spend.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow transition-colors group-hover:bg-violet/20">
          Open
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
        </span>
      </Link>

      {/* Payment methods + invoices CTA */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet/10 text-violet-glow ring-1 ring-inset ring-violet/30">
            <CreditCard className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-5 font-display text-lg font-semibold tracking-tight text-white">
            Payment methods
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Prepay jobs are funded by bank transfer into your payment-hold ledger;
            net-terms invoices settle by transfer on the due date. To add or
            update remittance details, or to discuss raising your credit
            line, our team can help directly.
          </p>
          <Link
            href="/contact?channel=support"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20"
          >
            Talk to support
            <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </article>

        <article className="rounded-3xl border border-cyan-glow/30 bg-gradient-to-b from-cyan-glow/[0.06] to-transparent p-6 sm:p-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <ScrollText className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-5 font-display text-lg font-semibold tracking-tight text-white">
            Invoices
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Every executed contract auto-issues an invoice. Review, approve,
            or raise a dispute. Approved invoices move into the payment
            queue. Signed PDF receipts attach to each completed report in
            <Link href="/client/reports" className="text-cyan-glow hover:text-white">
              {' '}
              deliverables
            </Link>
            .
          </p>
          <Link
            href="/client/invoices"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-cyan-glow hover:bg-cyan-glow/20"
          >
            Open invoices
            <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </article>
      </section>

      {/* How payment hold works */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
          <h2 className="font-display text-sm font-semibold uppercase tracking-industrial text-zinc-500">
            How NEXPEC payment holds work
          </h2>
        </header>
        <ol className="space-y-3 text-sm text-zinc-400">
          <Step
            n={1}
            text="Prepay: you fund a job's payment hold when you post it, and the amount is held in a dedicated payment-hold ledger, ring-fenced from your spend until the work is done. Net-terms: approved B2B clients skip up-front funding and draw against a credit line instead."
          />
          <Step
            n={2}
            text="Inspector submits the report. Our team reviews technical + financial integrity, then forwards it to you."
          />
          <Step
            n={3}
            text="You approve the report. That approval releases your held funds and settles the engagement per your agreement; for net-terms jobs it issues the invoice on your agreed terms."
          />
          <Step
            n={4}
            text="If you dispute the report, the payment hold remains until our team mediates. Funds only release on mutual agreement; cancellations are refunded from the hold."
          />
        </ol>
      </section>
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

const TERMS_LABEL: Record<PaymentTerms, string> = {
  prepay: 'Prepay',
  net_15: 'Net-15',
  net_30: 'Net-30',
  net_45: 'Net-45',
  net_60: 'Net-60',
};

/** Prepay payment hold — cash the client has locked and committed. */
function EscrowPanel({ lockedCents }: { lockedCents: number }) {
  return (
    <article className="relative overflow-hidden rounded-3xl border border-violet/30 bg-gradient-to-br from-violet/[0.12] via-violet/[0.05] to-transparent p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <Lock className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/90">
          Prepay payment hold, locked
        </p>
      </div>
      <p className="mt-5 font-display text-4xl font-semibold tracking-tight text-white">
        {formatCurrency(lockedCents)}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300/90">
        Cash you&apos;ve <span className="font-medium text-white">already paid</span>{' '}
        into NEXPEC&apos;s payment-hold ledger for active jobs. It is ring-fenced,
        released to the inspector only when you approve the report, and refunded
        if a job is cancelled.
      </p>
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-violet/25 bg-violet/10 px-3 py-1 text-[11px] font-medium text-violet-glow">
        <ShieldCheck className="h-3 w-3" strokeWidth={2} />
        Your money, held not spent
      </p>
    </article>
  );
}

/** Net-terms credit — borrowed headroom, distinct from locked payment hold cash. */
function CreditPanel({ credit }: { credit: ClientCreditProfile }) {
  const hasCredit = credit.terms !== 'prepay' || credit.creditLimitCents > 0;

  if (!hasCredit) {
    return (
      <article className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-7">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-zinc-300 ring-1 ring-inset ring-white/10">
            <Landmark className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-400">
            Net-terms credit
          </p>
        </div>
        <p className="mt-5 font-display text-2xl font-semibold tracking-tight text-white">
          Prepay account
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          You currently fund each job up front. Approved B2B clients can switch
          to <span className="text-white">Net-30 to Net-60</span> terms, posting
          jobs against a credit line and settling invoices later, with nothing
          locked on payment hold.
        </p>
        <Link
          href="/contact?channel=support&topic=credit"
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-cyan-glow hover:bg-cyan-glow/20"
        >
          Apply for trade credit
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </article>
    );
  }

  const limit = credit.creditLimitCents;
  const used = credit.creditUsedCents;
  const usedPct =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const overLimit = used > limit && limit > 0;

  return (
    <article className="relative overflow-hidden rounded-3xl border border-cyan-glow/30 bg-gradient-to-br from-cyan-glow/[0.10] via-cyan-glow/[0.04] to-transparent p-6 sm:p-7">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-glow/15 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <Landmark className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-cyan-glow/90">
            Net-terms credit
          </p>
        </div>
        <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-industrial text-cyan-glow">
          {TERMS_LABEL[credit.terms]}
        </span>
      </div>

      <p className="mt-5 text-[11px] font-medium uppercase tracking-industrial text-zinc-400">
        Available to draw
      </p>
      <p className="mt-1 font-display text-4xl font-semibold tracking-tight text-white">
        {formatCurrency(credit.creditAvailableCents)}
      </p>

      {/* Usage bar — used vs limit */}
      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full ${overLimit ? 'bg-accent-red' : 'bg-cyan-glow'}`}
            style={{ width: `${Math.max(usedPct, used > 0 ? 4 : 0)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span>
            <span className="font-semibold text-white">{formatCurrency(used)}</span> drawn
          </span>
          <span>
            limit <span className="font-semibold text-white">{formatCurrency(limit)}</span>
          </span>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-zinc-300/90">
        Headroom you can post jobs against without funding payment holds up front.
        Nothing here is locked; it&apos;s borrowed and settles on terms.
      </p>

      {credit.netTermsDueCents > 0 && (
        <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3">
          <CalendarClock className="h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.75} />
          <p className="text-xs text-amber-100/90">
            <span className="font-semibold text-amber-200">
              {formatCurrency(credit.netTermsDueCents)}
            </span>{' '}
            invoiced and due on your {TERMS_LABEL[credit.terms]} terms.
          </p>
        </div>
      )}
    </article>
  );
}

function EmptyState() {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <Building2 className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
        No financial activity yet.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
        Post your first inspection to start building the ledger. Spend
        and payment-hold status flow through here in real time.
      </p>
      <Link
        href="/client/jobs/new"
        className="btn-primary mt-6 inline-flex items-center gap-2"
      >
        <PlusCircle className="h-4 w-4" strokeWidth={2} />
        Post your first job
      </Link>
    </section>
  );
}

function ActivityRow({ row }: { row: FinanceActivityRow }) {
  return (
    <Link
      href={`/client/jobs/${row.jobId}`}
      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
    >
      <KindBadge kind={row.kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white group-hover:text-violet-glow">
          {row.jobTitle}
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {labelForKind(row.kind)}, {formatRelative(row.occurredAt)}
        </p>
      </div>
      <p className="text-right font-mono text-sm font-medium text-zinc-200">
        {row.amountCents !== null ? formatCurrency(row.amountCents) : '—'}
      </p>
      <ChevronRight
        className="h-4 w-4 text-zinc-600 transition-colors group-hover:text-violet-glow"
        strokeWidth={2}
      />
    </Link>
  );
}

function KindBadge({ kind }: { kind: FinanceActivityKind }) {
  const tone: 'cyan' | 'violet' | 'green' | 'zinc' =
    kind === 'payout_released'
      ? 'green'
      : kind === 'job_completed' || kind === 'report_received'
        ? 'cyan'
        : kind === 'job_assigned'
          ? 'violet'
          : 'zinc';
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    violet: 'border-violet/30 bg-violet/10 text-violet-glow',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    zinc: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
  }[tone];
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${classes}`}
      aria-hidden
    >
      {kind === 'payout_released' ? (
        <Receipt className="h-4 w-4" strokeWidth={1.75} />
      ) : kind === 'report_received' || kind === 'job_completed' ? (
        <ScrollText className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Briefcase className="h-4 w-4" strokeWidth={1.75} />
      )}
    </span>
  );
}

function MetricTile({
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
      <p className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>}
    </div>
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

/* ─── helpers ────────────────────────────────────────────────────────── */

function labelForKind(kind: FinanceActivityKind): string {
  switch (kind) {
    case 'job_posted':
      return 'Job posted, payment hold funded';
    case 'job_assigned':
      return 'Inspector assigned, work in progress';
    case 'report_received':
      return 'Report forwarded to you';
    case 'job_completed':
      return 'Job completed';
    case 'payout_released':
      // Client-facing label for the client's own released hold. Never imply
      // the amount shown (the client's price) is the inspector's payout.
      return 'Held funds released';
  }
}

function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
