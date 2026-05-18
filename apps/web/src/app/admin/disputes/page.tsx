// ════════════════════════════════════════════════════════════════════════════
//  app/admin/disputes/page.tsx — Disputes Board
//
//  Server Component. Reads every job currently in `status='disputed'`,
//  hydrates client + inspector profiles, calculates total escrow at stake.
//  Clicking a row opens the resolution drawer with the audit timeline.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { formatCents } from '@nexpec/shared-core';
import {
  fetchDisputesQueue,
  fetchDisputeJob,
  fetchDisputeTimeline,
} from '@/lib/data/disputesQueue';
import { DisputesTable } from '@/components/admin/disputes/DisputesTable';
import { DisputesDrawer } from '@/components/admin/disputes/DisputesDrawer';

export const metadata: Metadata = {
  title: 'Disputes',
  description: 'Disputes Board — admin mediation surface backed by admin_resolve_dispute.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ jobId?: string }>;
}

export default async function DisputesPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const [{ jobs, total, totalEscrowCents }, selectedJob, timeline] =
    await Promise.all([
      fetchDisputesQueue(),
      sp.jobId ? fetchDisputeJob(sp.jobId) : Promise.resolve(null),
      sp.jobId ? fetchDisputeTimeline(sp.jobId) : Promise.resolve([]),
    ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-accent-amber/90">
          Command Console · Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Disputes Board
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Every job currently in <span className="font-mono text-accent-amber">disputed</span>{' '}
          status. Reviewing surfaces the audit timeline; resolving fires
          the SECURITY DEFINER <span className="font-mono">admin_resolve_dispute</span> RPC.
        </p>
      </header>

      {/* Aggregate strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Open disputes" value={String(total)} tone={total > 0 ? 'amber' : 'default'} />
        <Stat
          label="Total escrow at stake"
          value={formatCents(totalEscrowCents)}
          tone={totalEscrowCents > 0 ? 'amber' : 'default'}
        />
        <Stat
          label="Resolution paths"
          value="3"
          sub="pay inspector · refund client · return to active"
        />
      </section>

      {/* Queue */}
      <DisputesTable jobs={jobs} selectedId={sp.jobId ?? null} />

      {/* Drawer */}
      <DisputesDrawer job={selectedJob} timeline={timeline} />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'amber';
}) {
  const valueColor = tone === 'amber' ? 'text-accent-amber' : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
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
