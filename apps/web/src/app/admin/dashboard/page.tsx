// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/dashboard/page.tsx — admin landing with LIVE metrics
//
//  Reads six metrics in parallel from the jobs + audit_events tables.
//  RLS for super_admin grants platform-wide SELECT. Individual fetch
//  failures degrade to "—" rather than 500-ing the dashboard.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ScrollText,
  Briefcase,
  Send,
  AlertTriangle,
  Users,
  Receipt,
  ArrowUpRight,
  ShieldAlert,
  BarChart3,
  FolderLock,
} from 'lucide-react';
import { fetchDashboardMetrics } from '@/lib/data/dashboardMetrics';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PipelineSection } from '@/components/jobs/PipelineSection';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

const SHIPPING_NEXT = [
  { label: 'Audit Trail Command Center', href: '/admin/audit', icon: ScrollText, live: true },
  { label: 'Job Moderation queue', href: '/admin/jobs', icon: Briefcase, live: true },
  { label: 'Spread Editor', href: '/admin/dispatch', icon: Send, live: true },
  { label: 'Dispute resolution', href: '/admin/disputes', icon: AlertTriangle, live: true },
  { label: 'User & org management', href: '/admin/users', icon: Users, live: true },
  { label: 'Payouts reconciliation', href: '/admin/payouts', icon: Receipt, live: true },
  // M1 Financial Suite · platform-wide buyer spend tracker
  { label: 'Budget Overview', href: '/admin/budget', icon: BarChart3, live: true },
  // M1 Financial Suite · invoice queue + dispute adjudication
  { label: 'Invoices, Mediation', href: '/admin/invoices', icon: Receipt, live: true },
  // M1 Financial Suite · platform-wide compliance vault (verification)
  { label: 'Compliance Vault', href: '/admin/vault', icon: FolderLock, live: true },
];

export default async function AdminDashboardPage() {
  const metrics = await fetchDashboardMetrics();

  // SLA Sentinel — overdue jobs with no sealed report (admin-only RPC, RLS-guarded)
  let atRiskCount = 0;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: overdue } = await supabase.rpc('get_overdue_reports');
    atRiskCount = Array.isArray(overdue) ? overdue.length : 0;
  } catch { /* sentinel migration not applied yet */ }

  return (
    <div className="space-y-10">
      {/* Heading */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Welcome back, operator.
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Live platform snapshot. Reads run as super_admin against the
          jobs and audit_events tables, RLS-gated, no service-role
          credentials in the browser.
        </p>
      </header>

      {/*
        Admin Pipeline — surfaces the 5 admin signoff gates on the home
        screen: open disputes (hottest red), completed jobs awaiting
        admin sign-off (amber), milestone release requests (amber),
        accepted applications needing contract issuance (violet), and
        pending approval queue (cyan). Self-suppresses when nothing is
        pending. Strictly additive — no sidebar changes (2026-05-20
        UX directive).
      */}
      <PipelineSection tone="admin" />

      {/* Critical alert ribbon */}
      {(metrics.criticalLast24h ?? 0) > 0 && (
        <Link
          href="/admin/audit?severity=critical"
          className="group flex items-center justify-between gap-4 rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3 transition-colors hover:bg-accent-red/15"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-accent-red" />
            <p className="text-sm font-medium text-accent-red">
              {metrics.criticalLast24h} critical audit event
              {metrics.criticalLast24h === 1 ? '' : 's'} in the last 24
              hours
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-industrial text-accent-red/80 group-hover:text-accent-red">
            review →
          </span>
        </Link>
      )}

      {/* SLA Sentinel — at-risk reports ribbon */}
      {atRiskCount > 0 && (
        <Link
          href="/admin/jobs"
          className="group flex items-center justify-between gap-4 rounded-xl border border-accent-amber/40 bg-accent-amber/10 px-4 py-3 transition-colors hover:bg-accent-amber/15"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-accent-amber" />
            <p className="text-sm font-medium text-accent-amber">
              {atRiskCount} at-risk report{atRiskCount === 1 ? '' : 's'}, inspection overdue without a sealed report, SLA Sentinel is chasing the inspector
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-industrial text-accent-amber/80 group-hover:text-accent-amber">
            review →
          </span>
        </Link>
      )}

      {/* Metric tiles */}
      <section
        aria-label="Platform overview"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <MetricTile
          label="Active jobs"
          value={formatCount(metrics.activeJobs)}
          sub="assigned + in_progress"
        />
        <MetricTile
          label="Held for payout"
          value={formatCurrency(metrics.escrowCents)}
          sub="across active jobs"
          tone="violet"
        />
        <MetricTile
          label="Open disputes"
          value={formatCount(metrics.openDisputes)}
          sub="awaiting mediation"
          tone={(metrics.openDisputes ?? 0) > 0 ? 'amber' : 'default'}
        />
        <MetricTile
          label="Inspectors working"
          value={formatCount(metrics.inspectorsActive)}
          sub="distinct contractors, in_progress"
          tone="cyan"
        />
      </section>

      {/* Secondary metric row */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Completed, last 7d"
          value={formatCount(metrics.completedLast7d)}
          sub="jobs marked completed"
          variant="muted"
        />
        <MetricTile
          label="Critical events, 24h"
          value={formatCount(metrics.criticalLast24h)}
          sub="severity = critical"
          variant="muted"
          tone={(metrics.criticalLast24h ?? 0) > 0 ? 'red' : 'default'}
        />
        <MetricTile
          label="—"
          value="—"
          sub="reserved, payouts queue"
          variant="muted"
        />
        <MetricTile
          label="—"
          value="—"
          sub="reserved, KYC pending"
          variant="muted"
        />
      </section>

      {/* Shipping next */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 p-8 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Console surfaces
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
          Six surfaces routed under this shell.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          The Audit Trail is live. The remaining five surfaces inherit
          this layout and ship as Sprint 3 closes.
        </p>

        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHIPPING_NEXT.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-violet/40 hover:bg-white/[0.04]"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                  <item.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="flex-1 text-sm font-medium text-zinc-200 group-hover:text-white">
                  {item.label}
                </span>
                {item.live ? (
                  <span className="rounded-full border border-accent-green/40 bg-accent-green/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-accent-green">
                    live
                  </span>
                ) : (
                  <span className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-zinc-500">
                    soon
                  </span>
                )}
                <ArrowUpRight
                  className="h-4 w-4 text-zinc-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-glow"
                  strokeWidth={1.75}
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

type Tone = 'default' | 'violet' | 'cyan' | 'amber' | 'red';

function MetricTile({
  label,
  value,
  sub,
  tone = 'default',
  variant = 'primary',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  variant?: 'primary' | 'muted';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : tone === 'amber'
          ? 'text-accent-amber'
          : tone === 'red'
            ? 'text-accent-red'
            : 'text-white';

  const baseClass =
    variant === 'muted'
      ? 'border-white/[0.04] bg-white/[0.01]'
      : 'border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40';

  return (
    <div className={`rounded-2xl border ${baseClass} p-5 backdrop-blur-xl`}>
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
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
