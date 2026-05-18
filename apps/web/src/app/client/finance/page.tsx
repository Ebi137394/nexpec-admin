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
} from 'lucide-react';
import { fetchClientFinance } from '@/lib/data/clientFinance';
import type {
  FinanceActivityKind,
  FinanceActivityRow,
} from '@/lib/data/clientFinance.types';

export const metadata: Metadata = {
  title: 'Finance',
};

export const dynamic = 'force-dynamic';

export default async function ClientFinancePage() {
  const { metrics, recentActivity } = await fetchClientFinance();

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Finance
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Spend &amp; invoices
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          What you&apos;ve funded, what&apos;s in escrow, and what&apos;s
          settled. NEXPEC processes payouts to inspectors directly via
          Stripe — you fund escrow per job; we move the money.
        </p>
      </header>

      {/* Primary metrics */}
      <section
        aria-label="Finance overview"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <MetricTile
          icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}
          label="Total spend · YTD"
          value={formatCurrency(metrics.totalSpendYtdCents)}
          sub="across completed jobs this year"
          tone="violet"
        />
        <MetricTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label="Held in escrow"
          value={formatCurrency(metrics.heldInEscrowCents)}
          sub="across active jobs"
          tone="cyan"
        />
        <MetricTile
          icon={<Receipt className="h-4 w-4" strokeWidth={1.75} />}
          label="Paid out · YTD"
          value={formatCurrency(metrics.paidOutYtdCents)}
          sub="released to inspectors"
        />
        <MetricTile
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          label="Completed · YTD"
          value={formatCount(metrics.completedJobsYtd)}
          sub={`${formatCount(metrics.activeJobsCount)} currently active`}
        />
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
            Cards on file + ACH instructions are managed via the secure
            Stripe customer portal. Direct in-portal management lands in
            the next sprint; for now, our team can rotate cards on
            request.
          </p>
          <Link
            href="/contact?channel=support"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20"
          >
            Talk to support
            <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </article>

        <article className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <ScrollText className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-5 font-display text-lg font-semibold tracking-tight text-white">
            Invoices &amp; receipts
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            A signed PDF receipt is issued for every completed job. Find
            them attached to each completed report in
            <Link href="/client/reports" className="text-cyan-glow hover:text-white">
              {' '}
              deliverables
            </Link>
            . Consolidated monthly statements lands post-launch.
          </p>
          <Link
            href="/client/reports"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-cyan-glow hover:bg-cyan-glow/20"
          >
            View deliverables
            <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </article>
      </section>

      {/* How escrow works */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
          <h2 className="font-display text-sm font-semibold uppercase tracking-industrial text-zinc-500">
            How NEXPEC escrow works
          </h2>
        </header>
        <ol className="space-y-3 text-sm text-zinc-400">
          <Step
            n={1}
            text="You fund a job's escrow when you post it. Funds sit with Stripe, not NEXPEC — we never touch your money directly."
          />
          <Step
            n={2}
            text="Inspector submits report. Our team reviews technical + financial integrity, then forwards to you."
          />
          <Step
            n={3}
            text="You approve the report. That approval is a signal — admin executes the Stripe Connect payout to the inspector."
          />
          <Step
            n={4}
            text="If you dispute the report, escrow holds until our team mediates. Funds only release on mutual agreement."
          />
        </ol>
      </section>
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

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
        and escrow status flow through here in real time.
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
          {labelForKind(row.kind)} · {formatRelative(row.occurredAt)}
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
      return 'Job posted · escrow funded';
    case 'job_assigned':
      return 'Inspector assigned · work in progress';
    case 'report_received':
      return 'Report forwarded to you';
    case 'job_completed':
      return 'Job completed';
    case 'payout_released':
      return 'Inspector payout released';
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
