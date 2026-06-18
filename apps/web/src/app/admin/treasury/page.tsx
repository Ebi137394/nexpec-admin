// ════════════════════════════════════════════════════════════════════════════
//  app/admin/treasury/page.tsx — Admin Treasury Control Tower
//
//  The operator's money command center: action manual payout requests (Mark as
//  Paid / Reject), approve early-payout advances, and see the "owed to you vs
//  you owe" cash position. Pure server component; row actions are <form action>
//  → SECURITY DEFINER RPCs. Gated by the /admin layout. Brand tokens only.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import {
  Landmark,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Wallet,
  ArrowDownToLine,
  Zap,
  Building2,
} from 'lucide-react';
import { formatCents } from '@nexpec/shared-core';
import {
  fetchTreasury,
  fetchReconciliationRuns,
  type WithdrawalRow,
  type AdvanceRow,
  type ReconciliationRunRow,
} from '@/lib/data/treasury';
import { markWithdrawalPaid, rejectWithdrawal, fundAdvance, runReconciliation } from '@/lib/actions/treasury';

export const metadata: Metadata = { title: 'Treasury Control Tower' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ error?: string; paid?: string; rejected?: string; funded?: string; recon?: string }>;
}

export default async function TreasuryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const { summary, requests, advances, recent } = await fetchTreasury();
  const reconRuns = await fetchReconciliationRuns(8);

  return (
    <div className="space-y-8">
      <header>
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/90">
          <Landmark className="h-3.5 w-3.5" strokeWidth={2} />
          Treasury, Command Console
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Treasury Control Tower
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Action manual payout requests, approve early-payout advances, and track
          your cash position. Money moves outside the platform; marking a request
          paid debits the requester&apos;s balance.
        </p>
      </header>

      {/* Banners */}
      {sp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-4 w-4" />}>{sp.error}</Banner>
      )}
      {sp.paid && (
        <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Payout marked as paid, the balance was debited.</Banner>
      )}
      {sp.rejected && (
        <Banner tone="zinc" icon={<XCircle className="h-4 w-4" />}>Payout request rejected, funds returned to available.</Banner>
      )}
      {sp.funded && (
        <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Advance funded, the inspector was paid the net amount.</Banner>
      )}
      {sp.recon === 'ok' && (
        <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Reconciliation complete, the Stripe balance backs your liabilities.</Banner>
      )}
      {sp.recon === 'shortfall' && (
        <Banner tone="red" icon={<AlertCircle className="h-4 w-4" />}>Reconciliation found a SHORTFALL, Stripe holds less than you owe. Investigate before paying out.</Banner>
      )}

      {/* Cash position */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />}
          label="Owed to you"
          value={formatCents(summary.receivablesCents)}
          sub="net-terms jobs awaiting client settlement"
          tone="cyan"
        />
        <Stat
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label="You owe (cleared)"
          value={formatCents(summary.clearedLiabilityCents)}
          sub="withdrawable inspector balances"
          tone="violet"
        />
        <Stat
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          label="Open payout requests"
          value={String(summary.pendingCount)}
          sub={`${formatCents(summary.reservedCents)} reserved`}
        />
        <Stat
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          label="Accrued (pending)"
          value={formatCents(summary.accruedCents)}
          sub="net-terms earnings not yet cleared"
        />
      </section>

      {/* Payout request queue */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Payout requests
          </h2>
          <span className="ml-1 rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold text-violet-glow">
            {requests.length}
          </span>
        </div>

        {requests.length === 0 ? (
          <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-500">
            No open payout requests. When an inspector or supplier requests a payout, it lands here.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {requests.map((r) => (
              <WithdrawalCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </section>

      {/* Early-payout advances */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-accent-amber" strokeWidth={1.75} />
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Early-payout advances
          </h2>
          <span className="ml-1 rounded-full border border-accent-amber/30 bg-accent-amber/10 px-2 py-0.5 text-[10px] font-semibold text-accent-amber">
            {advances.length}
          </span>
        </div>
        {advances.length === 0 ? (
          <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-500">
            No advance requests pending.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {advances.map((a) => (
              <AdvanceCard key={a.id} a={a} />
            ))}
          </div>
        )}
      </section>

      {/* Reconciliation — ledger vs Stripe balance */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Reconciliation
            </h2>
          </div>
          <form action={runReconciliation}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-glow/30 bg-violet-glow/10 px-3 py-1.5 text-xs font-semibold text-violet-glow transition hover:bg-violet-glow/20"
            >
              <Zap className="h-3.5 w-3.5" strokeWidth={2} />
              Run now
            </button>
          </form>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Real Stripe balance vs custodial liabilities (wallets + supplier earnings + platform). A shortfall means Stripe holds less than you owe.
        </p>

        {reconRuns.length === 0 ? (
          <p className="mt-5 text-sm text-zinc-500">No reconciliation runs yet. Run one to capture a baseline.</p>
        ) : (
          <ul className="mt-5 space-y-1.5">
            {reconRuns.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2.5 text-xs"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-zinc-300">{fmtTime(run.runAt)}</span>
                  <span className="text-zinc-500">
                    {run.source} · owe {formatCents(run.liabilitiesCents)}
                    {run.stripeBalanceCents != null && <> · Stripe {formatCents(run.stripeBalanceCents)}</>}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {run.driftCents != null && (
                    <span className={`font-mono ${run.driftCents < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                      {run.driftCents < 0 ? '' : '+'}{formatCents(run.driftCents)}
                    </span>
                  )}
                  <ReconPill status={run.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent activity */}
      {recent.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Recent settlements
          </p>
          <ul className="space-y-1.5">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate text-zinc-300">
                  {r.requesterName}
                  <span className="ml-2 text-zinc-500">{r.role}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-zinc-400">{formatCents(r.amountCents)}</span>
                  <StatusPill status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ─── cards ──────────────────────────────────────────────────────────────── */

function WithdrawalCard({ r }: { r: WithdrawalRow }) {
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{r.requesterName}</p>
            <span className="rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
              {r.role}
            </span>
          </div>
          {r.requesterEmail && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{r.requesterEmail}</p>}
          <p className="mt-1 text-[11px] text-zinc-500">
            Requested {fmtTime(r.requestedAt)}
            {r.method ? ` · ${r.method.replace('_', ' ')}` : ''}
          </p>
          {r.destinationNote && (
            <p className="mt-1 text-xs text-zinc-400">Destination: {r.destinationNote}</p>
          )}
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight text-violet-glow">
          {formatCents(r.amountCents)}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
        {/* Mark as paid */}
        <form action={markWithdrawalPaid} className="flex items-end gap-2">
          <input type="hidden" name="id" value={r.id} />
          <label className="flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Wire / transfer reference
            </span>
            <input
              type="text"
              name="reference"
              maxLength={200}
              placeholder="e.g. ACH #48213 (optional)"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-green/60 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-green px-4 py-2 text-[11px] font-semibold uppercase tracking-industrial text-white transition hover:bg-accent-green/90"
          >
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
            Mark as paid
          </button>
        </form>

        {/* Reject */}
        <form action={rejectWithdrawal} className="flex items-end gap-2">
          <input type="hidden" name="id" value={r.id} />
          <label className="flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Reject reason
            </span>
            <input
              type="text"
              name="reason"
              maxLength={500}
              placeholder="Returns funds to available (optional)"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-accent-red/60 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent-red/40 bg-accent-red/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-industrial text-accent-red transition hover:bg-accent-red/15"
          >
            <XCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
            Reject
          </button>
        </form>
      </div>
    </article>
  );
}

function AdvanceCard({ a }: { a: AdvanceRow }) {
  return (
    <article className="rounded-xl border border-accent-amber/20 bg-accent-amber/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{a.requesterName}</p>
          {a.jobTitle && <p className="mt-0.5 truncate text-[11px] text-zinc-400">{a.jobTitle}</p>}
          <p className="mt-1 text-[11px] text-zinc-500">Requested {fmtTime(a.requestedAt)}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-semibold tracking-tight text-white">{formatCents(a.netCents)}</p>
          <p className="text-[10px] uppercase tracking-industrial text-zinc-500">net now</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-zinc-400">
        <span>Gross <span className="font-mono text-zinc-200">{formatCents(a.grossCents)}</span></span>
        <span>Fee <span className="font-mono text-accent-amber">{formatCents(a.feeCents)}</span> ({(a.feeBps / 100).toFixed(2)}%)</span>
      </div>

      <form action={fundAdvance} className="mt-4 flex items-end gap-2 border-t border-white/[0.06] pt-3">
        <input type="hidden" name="id" value={a.id} />
        <label className="flex-1 sm:max-w-[200px]">
          <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">Funding source</span>
          <select
            name="fundedBy"
            defaultValue="platform"
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white focus:border-violet/60 focus:outline-none"
          >
            <option value="platform">Platform</option>
            <option value="partner">Financing partner</option>
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-[11px] font-semibold uppercase tracking-industrial text-white transition hover:bg-violet/90"
        >
          <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
          Fund advance
        </button>
      </form>
    </article>
  );
}

/* ─── primitives ─────────────────────────────────────────────────────────── */

function Stat({
  icon, label, value, sub, tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'violet' | 'cyan';
}) {
  const valueColor = tone === 'violet' ? 'text-violet-glow' : tone === 'cyan' ? 'text-cyan-glow' : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-industrial">{label}</p>
      </div>
      <p className={`mt-2 font-mono text-2xl font-semibold tracking-tight ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
      : status === 'rejected'
        ? 'border-accent-red/30 bg-accent-red/10 text-accent-red'
        : 'border-white/[0.06] bg-white/[0.04] text-zinc-400';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial ${tone}`}>
      {status}
    </span>
  );
}

function ReconPill({ status }: { status: ReconciliationRunRow['status'] }) {
  const map: Record<ReconciliationRunRow['status'], { tone: string; label: string }> = {
    solvent: { tone: 'border-accent-green/30 bg-accent-green/10 text-accent-green', label: 'solvent' },
    shortfall: { tone: 'border-accent-red/30 bg-accent-red/10 text-accent-red', label: 'shortfall' },
    snapshot_only: { tone: 'border-white/[0.06] bg-white/[0.04] text-zinc-400', label: 'snapshot' },
    error: { tone: 'border-amber-500/30 bg-amber-500/10 text-amber-400', label: 'error' },
  };
  const { tone, label } = map[status] ?? map.error;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial ${tone}`}>
      {label}
    </span>
  );
}

function Banner({
  tone, icon, children,
}: {
  tone: 'red' | 'green' | 'zinc';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes = {
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    zinc: 'border-white/[0.08] bg-white/[0.03] text-zinc-300',
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
