// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/dashboard/page.tsx — Inspector portal landing
//
//  Sibling of app/client/dashboard/page.tsx. Same visual treatment; the
//  metric tiles + next-actions reflect inspector-side workflows: open jobs,
//  active assignments, wallet balance, compliance status.
//
//  Sprint 5 wires the numbers via fetchInspectorMetrics() (RLS-gated to
//  the current inspector's job + earnings rows).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Compass,
  ClipboardList,
  Wallet,
  ShieldCheck,
  ArrowUpRight,
  Briefcase,
} from 'lucide-react';
import { fetchInspectorDashboardMetrics } from '@/lib/data/inspectorDashboardMetrics';

export const metadata: Metadata = {
  title: 'Inspector Dashboard',
};

export const dynamic = 'force-dynamic';

const NEXT_ACTIONS = [
  {
    label: 'Browse open jobs',
    href: '/inspector/jobs',
    icon: Compass,
    helper: 'Filter by specialty, city, urgency, sponsorship, schedule.',
  },
  {
    label: 'Active assignments',
    href: '/inspector/assignments',
    icon: ClipboardList,
    helper: 'Submit reports, attach evidence, sign-off scope.',
  },
  {
    label: 'Wallet & payouts',
    href: '/inspector/wallet',
    icon: Wallet,
    helper: 'Stripe Connect onboarding + balance reconciliation.',
  },
  {
    label: 'Compliance & credentials',
    href: '/inspector/compliance',
    icon: ShieldCheck,
    helper: 'Upload certs, refresh expiring tickets.',
  },
  {
    label: 'Profile & CV',
    href: '/inspector/settings',
    icon: Briefcase,
    helper: 'Specialties, NDT methods, languages, CV/Resume upload.',
  },
  {
    label: 'Work experience',
    href: '/inspector/experience',
    icon: Briefcase,
    helper: 'Past projects, employers, references.',
  },
];

export default async function InspectorDashboardPage() {
  const metrics = await fetchInspectorDashboardMetrics();

  return (
    <div className="space-y-10">
      {/* Heading */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Ready to work.
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Browse open jobs, manage active assignments, submit signed
          reports, and reconcile payouts — all from this console. The
          mobile app mirrors the same flows for field operations.
        </p>
      </header>

      {/* Metric tiles — placeholder data, wired in Sprint 5 */}
      <section
        aria-label="Your workspace"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <MetricTile
          label="Active assignments"
          value={formatCount(metrics.activeAssignments)}
          sub="assigned + in_progress"
        />
        <MetricTile
          label="Earnings · YTD"
          value={formatCurrency(metrics.earningsYtdCents)}
          sub="net of platform fees"
          tone="cyan"
        />
        <MetricTile
          label="Pending payouts"
          value={formatCurrency(metrics.pendingPayoutCents)}
          sub="awaiting Stripe transfer"
          tone="violet"
        />
        <MetricTile
          label="Reports · last 30d"
          value={formatCount(metrics.reportsLast30d)}
          sub="signed + delivered"
        />
      </section>

      {/* Next-actions rail */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 p-8 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          What you can do here
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
          Every surface, one click away.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Browse open jobs, manage assignments, upload your CV, reconcile
          payouts, and refresh credentials. The mobile app mirrors the same
          flows for field operations.
        </p>

        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NEXT_ACTIONS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-violet/40 hover:bg-white/[0.04]"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                  <item.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200 group-hover:text-white">
                      {item.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                    {item.helper}
                  </p>
                </div>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-glow"
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

/* ─── helpers (inlined to keep this file self-contained) ─────────────── */

type Tone = 'default' | 'violet' | 'cyan' | 'amber' | 'red';

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

function MetricTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
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

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl">
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
