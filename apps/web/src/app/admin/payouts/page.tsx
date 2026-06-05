// ════════════════════════════════════════════════════════════════════════════
//  app/admin/payouts/page.tsx — Payouts Reconciliation
//
//  Server Component. Reads completed jobs where payout_status is not yet
//  `paid`. Aggregates total owed. Settling a row fires the SECURITY
//  DEFINER `admin_mark_payout_processed` RPC.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { formatCents } from '@nexpec/shared-core';
import {
  fetchPayoutsQueue,
  fetchPayoutJob,
} from '@/lib/data/payoutsQueue';
import { PayoutsTable } from '@/components/admin/payouts/PayoutsTable';
import { PayoutsDrawer } from '@/components/admin/payouts/PayoutsDrawer';

export const metadata: Metadata = {
  title: 'Payouts',
  description: 'Inspector payout reconciliation, admin_mark_payout_processed.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ jobId?: string }>;
}

export default async function PayoutsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const [{ jobs, total, totalOwedCents }, selectedJob] = await Promise.all([
    fetchPayoutsQueue(),
    sp.jobId ? fetchPayoutJob(sp.jobId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-cyan-glow/90">
          Command Console, Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Payouts Reconciliation
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Every job in{' '}
          <span className="font-mono text-zinc-200">completed</span> status whose{' '}
          <span className="font-mono text-cyan-glow">payout_status</span> is not yet{' '}
          <span className="font-mono text-cyan-glow">paid</span>. Settling
          captures the Stripe transfer reference verbatim into the audit trail.
        </p>
      </header>

      {/* Aggregate strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Awaiting settlement"
          value={String(total)}
          tone={total > 0 ? 'cyan' : 'default'}
        />
        <Stat
          label="Total inspector owed"
          value={formatCents(totalOwedCents)}
          tone={totalOwedCents > 0 ? 'cyan' : 'default'}
        />
        <Stat
          label="Settlement method"
          value="Stripe + manual"
          sub="Stripe Connect transfer or manual:<context>"
        />
      </section>

      {/* Queue */}
      <PayoutsTable jobs={jobs} selectedId={sp.jobId ?? null} />

      {/* Drawer */}
      <PayoutsDrawer job={selectedJob} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'cyan';
}) {
  const valueColor = tone === 'cyan' ? 'text-cyan-glow' : 'text-white';
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
