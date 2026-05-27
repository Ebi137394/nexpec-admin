// ════════════════════════════════════════════════════════════════════════════
//  app/client/approvals/page.tsx — Approver dashboard
//
//  Server component. Calls fetch_my_pending_approvals() which is
//  SoD-filtered + role-filtered server-side, so this page just
//  renders whatever comes back. Mobile equivalent will mount the same
//  RPC.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { ShieldCheck, Activity } from 'lucide-react';

import { fetchMyPendingApprovals } from '@/lib/data/procurement';
import { ApprovalsList } from '@/components/procurement/ApprovalsList';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const requests = await fetchMyPendingApprovals();

  // Aggregate stats for the header.
  const totalAmountByCcy = new Map<string, number>();
  for (const r of requests) {
    totalAmountByCcy.set(
      r.currency,
      (totalAmountByCcy.get(r.currency) ?? 0) + r.amount_cents,
    );
  }
  const ccyEntries = Array.from(totalAmountByCcy.entries());

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Procurement · Approvals
        </p>
        <h1 className="mt-2 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
          </span>
          Awaiting your decision
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Jobs that triggered an approval gate are routed here. Click any
          request to record your decision. Self-approval is{' '}
          <span className="text-zinc-300">schema-blocked</span> — requests
          you posted yourself will never appear in this queue.
        </p>
      </header>

      {/* Stats strip */}
      {requests.length > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Pending requests"
            value={String(requests.length)}
            icon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
            tone="violet"
          />
          {ccyEntries.slice(0, 2).map(([ccy, total]) => (
            <Stat
              key={ccy}
              label={`Total awaiting (${ccy})`}
              value={formatMoney(total, ccy)}
              tone="neutral"
            />
          ))}
        </section>
      )}

      <ApprovalsList requests={requests} />

      <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        Source · fetch_my_pending_approvals() · SoD-filtered server-side.
        Decisions are written through submit_job_approval with constraint-
        trigger enforcement at the schema layer.
      </p>
    </div>
  );
}

/* ─── stat tile (matches the org structure pattern) ─────────────────── */

function Stat({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'violet';
}) {
  const ring =
    tone === 'violet'
      ? 'ring-violet/30 text-violet-glow'
      : 'ring-white/[0.08] text-white';
  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5 ring-1 ring-inset ${ring}`}
    >
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {icon}
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}
