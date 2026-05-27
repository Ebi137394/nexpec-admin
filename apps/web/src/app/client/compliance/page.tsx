// ════════════════════════════════════════════════════════════════════════════
//  app/client/compliance/page.tsx — The Compliance Command Center
//
//  The CFO-grade page. Resolves the active org, fetches posture + six
//  detector outputs in parallel, renders:
//
//    · CompliancePostureHero      — headline score, coverage tiles,
//                                    control telemetry
//    · AnomalyFeed                — six detectors as one ordered stream
//    · Quick-action panel         — deep-links to evidence pack assembly,
//                                    approvals queue, policy ladder,
//                                    budget envelopes, audit trail
//    · "How to read this" panel   — for auditors visiting for the first
//                                    time, plain-English overview of
//                                    methodology
//
//  All controls are projection over data already in the DB — no new
//  reads beyond the seven RPCs landed in 20260606120000.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight,
  ShieldCheck,
  Receipt,
  Wallet,
  Coins,
  ScrollText,
  FileCheck,
  Building2,
  Shield,
  ExternalLink,
} from 'lucide-react';

import {
  fetchMyOrgMemberships,
  resolveActiveOrgId,
} from '@/lib/data/orgStructure';
import {
  fetchCompliancePosture,
  fetchAllComplianceAnomalies,
  computePostureScore,
} from '@/lib/data/compliancePosture';
import { CompliancePostureHero } from '@/components/compliance/CompliancePostureHero';
import { AnomalyFeed } from '@/components/compliance/AnomalyFeed';

export const metadata: Metadata = { title: 'Compliance Command Center' };
export const dynamic = 'force-dynamic';

export default async function ComplianceCommandCenter() {
  const memberships = await fetchMyOrgMemberships();
  const activeOrgId = await resolveActiveOrgId();
  const active = memberships.find((m) => m.org_id === activeOrgId) ?? null;

  if (!active) {
    return (
      <div className="space-y-6">
        <Header orgName={null} />
        <p className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-10 text-center text-xs text-zinc-500">
          Compliance posture is computed per organization. Pick a workspace
          from the switcher in the header to see its dashboard.
        </p>
      </div>
    );
  }

  // Parallel fetch — three independent reads.
  const [posture, anomalies] = await Promise.all([
    fetchCompliancePosture(active.org_id),
    fetchAllComplianceAnomalies(active.org_id),
  ]);
  const score = computePostureScore(posture, anomalies);

  return (
    <div className="space-y-8">
      <Header orgName={active.org_name} />

      <CompliancePostureHero
        posture={posture}
        score={score}
        orgName={active.org_name}
      />

      <AnomalyFeed anomalies={anomalies} />

      <QuickActions />

      <MethodologyPanel />
    </div>
  );
}

/* ─── header ──────────────────────────────────────────────────────── */

function Header({ orgName }: { orgName: string | null }) {
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
        Procurement · Compliance
      </p>
      <h1 className="mt-2 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <Shield className="h-5 w-5" strokeWidth={1.75} />
        </span>
        Command Center
        {orgName && (
          <span className="font-mono text-base text-zinc-500 sm:text-lg">
            · {orgName}
          </span>
        )}
      </h1>
      <p className="mt-2 max-w-3xl text-pretty text-sm text-zinc-400">
        A single page that projects every control NEXPEC enforces on your
        spend program. Posture score, coverage telemetry, schema-enforced
        control health, and six SOX-grade anomaly detectors — recomputed
        live on every visit.
      </p>
    </header>
  );
}

/* ─── quick action panel ──────────────────────────────────────────── */

function QuickActions() {
  const actions: Array<{
    href: string;
    icon: React.ElementType;
    title: string;
    subtitle: string;
  }> = [
    {
      href: '/client/approvals',
      icon: ShieldCheck,
      title: 'Approvals queue',
      subtitle: 'Pending requests awaiting your decision',
    },
    {
      href: '/client/budget/policies',
      icon: Coins,
      title: 'Approval policies',
      subtitle: 'Configure the tiered ladder of approval bands',
    },
    {
      href: '/client/budget/envelopes',
      icon: Wallet,
      title: 'Budget envelopes',
      subtitle: 'Per-department fiscal-period allocations',
    },
    {
      href: '/client/budget',
      icon: Receipt,
      title: 'Budget overview',
      subtitle: 'Spend rollup by department + currency display selector',
    },
    {
      href: '/client/structure',
      icon: Building2,
      title: 'Org structure',
      subtitle: 'Department tree, cost centers, member assignments',
    },
    {
      href: '/verify',
      icon: ExternalLink,
      title: 'Public verification',
      subtitle: 'Share with auditors — no NEXPEC login required',
    },
  ];

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/30 p-5 sm:p-6">
      <header className="mb-4">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
          QUICK ACTIONS
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white">
          Drill into a control
        </h2>
      </header>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:-translate-y-px hover:border-violet/30 hover:bg-violet/[0.04]"
            >
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                <a.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{a.title}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {a.subtitle}
                </p>
              </div>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-violet-glow"
                strokeWidth={1.75}
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─── methodology panel ───────────────────────────────────────────── */

function MethodologyPanel() {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 sm:p-6">
      <header className="mb-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
          METHODOLOGY
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white">
          How to read this page
        </h2>
      </header>
      <ul className="space-y-3 text-[12px] leading-relaxed text-zinc-400">
        <li className="flex gap-3">
          <FileCheck
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-glow"
            strokeWidth={1.75}
          />
          <p>
            <span className="text-white">Posture score (0–100).</span>{' '}
            Mean of the three coverage percentages, less anomaly penalties
            (−6 critical, −2 warning, −1 info). Transparent — auditors can
            recompute by hand from the figures shown above.
          </p>
        </li>
        <li className="flex gap-3">
          <ShieldCheck
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300"
            strokeWidth={1.75}
          />
          <p>
            <span className="text-white">SoD violations = 0 is the goal.</span>{' '}
            Segregation of Duties is enforced at the schema layer via a
            constraint trigger on <code className="font-mono text-zinc-200">approval_decisions</code> —
            self-approval cannot exist as a database state. Surfacing zero
            here is the proof the control held.
          </p>
        </li>
        <li className="flex gap-3">
          <ScrollText
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-glow"
            strokeWidth={1.75}
          />
          <p>
            <span className="text-white">Anomaly detectors.</span> Six
            pure-SQL projections over the audit trail. They run when you
            load this page — no background daemon, no stored results, no
            possibility of tampering with detector output.
          </p>
        </li>
        <li className="flex gap-3">
          <ExternalLink
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-glow"
            strokeWidth={1.75}
          />
          <p>
            <span className="text-white">Third-party verifiable.</span>{' '}
            Any evidence pack you generate (from a job detail page) can be
            handed to your external auditor.{' '}
            <Link href="/verify" className="text-violet-glow hover:text-white">
              nexpecapp.com/verify
            </Link>{' '}
            accepts the JSON, recomputes the SHA-256 chain-of-custody
            client-side, and proves no artifact was modified —{' '}
            <span className="text-white">without requiring NEXPEC access</span>.
          </p>
        </li>
      </ul>
    </section>
  );
}
