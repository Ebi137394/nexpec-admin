// ════════════════════════════════════════════════════════════════════════════
//  app/client/dashboard/page.tsx — Client portal landing
//
//  Skeleton with the full visual treatment of the admin dashboard:
//  metric tiles in a 4-up grid, a "what's shipping next" rail, atmospheric
//  layers inherited from the parent layout.
//
//  Metric values are placeholders ("—") this sprint. Sprint 2 wires the
//  numbers to a fetchClientMetrics() data module that reads only the
//  current client's jobs (RLS-gated by client_id = auth.uid()).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Briefcase,
  PlusCircle,
  FileCheck2,
  ArrowUpRight,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Client Dashboard',
};

export const dynamic = 'force-dynamic';

const NEXT_ACTIONS = [
  {
    label: 'Post a new inspection',
    href: '/client/jobs/new',
    icon: PlusCircle,
    helper: 'Define scope, location, budget. Funds land in escrow.',
    state: 'live' as const,
  },
  {
    label: 'My active jobs',
    href: '/client/jobs',
    icon: Briefcase,
    helper: 'Track applications, in-progress work, scheduled visits.',
    state: 'live' as const,
  },
  {
    label: 'Download a completed report',
    href: '/client/reports',
    icon: FileCheck2,
    helper: 'Signed PDFs, photos, audit hash.',
    state: 'live' as const,
  },
];

export default function ClientDashboardPage() {
  return (
    <div className="space-y-10">
      {/* Heading */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Welcome.
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Post inspections, review applications, fund escrow, and download
          signed reports — all from this console. The mobile app mirrors the
          same flows for field operations.
        </p>
      </header>

      {/* Metric tiles — placeholder data, wired in Sprint 2 */}
      <section
        aria-label="Your workspace"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <MetricTile
          label="Active jobs"
          value="—"
          sub="assigned + in_progress"
        />
        <MetricTile
          label="Held in escrow"
          value="—"
          sub="across your active jobs"
          tone="violet"
        />
        <MetricTile
          label="Pending review"
          value="—"
          sub="applications awaiting your decision"
          tone="cyan"
        />
        <MetricTile
          label="Reports · last 30d"
          value="—"
          sub="signed + delivered"
        />
      </section>

      {/* Next-actions rail */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 p-8 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          What you can do here
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
          Three surfaces, end-to-end.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Each surface inherits this shell. The job-posting form lands first
          (Sprint 2), then application review, then escrow release.
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
                    {item.state === 'live' ? (
                      <span className="rounded-full border border-accent-green/40 bg-accent-green/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-accent-green">
                        live
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-zinc-500">
                        soon
                      </span>
                    )}
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
