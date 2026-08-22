// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/wallet/page.tsx — Inspector two-bucket wallet (web)
//
//  Available  = cleared, withdrawable now (→ Request Payout)
//  Pending    = accrued on net-terms jobs; clears when the client settles
//  In review  = a payout you've requested, awaiting admin processing
//
//  Payouts are manual: requesting one reserves the funds and queues it for the
//  admin Treasury Control Tower. No automated Stripe payout. Brand tokens only.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import {
  Wallet,
  Clock,
  Hourglass,
  TrendingUp,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { formatCents } from '@nexpec/shared-core';
import { fetchInspectorWallet } from '@/lib/data/inspectorWallet';
import { EarningsByJob } from './EarningsByJob';
import { requestWithdrawal } from '@/lib/actions/inspectorWallet';

export const metadata: Metadata = { title: 'Wallet' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ error?: string; requested?: string }>;
}

export default async function InspectorWalletPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const w = await fetchInspectorWallet();

  const available = w?.availableCents ?? 0;
  const accrued = w?.accruedCents ?? 0;
  const inFlight = w?.inFlightCents ?? 0;
  const totalEarned = w?.totalEarnedCents ?? 0;
  const openRequest = w?.openRequest ?? null;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal, Wallet
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Your earnings
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Track what you&apos;ve earned and request a payout when funds clear. Payouts
          are reviewed and released by the NEXPEC team.
        </p>
      </header>

      {sp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>{sp.error}</Banner>
      )}
      {sp.requested && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Payout requested. We&apos;ll review and release it, you&apos;ll see it update here.
        </Banner>
      )}

      {/* Available — the hero */}
      <section className="rounded-3xl border border-violet/30 bg-gradient-to-b from-violet/[0.10] to-ink-900/40 p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
              <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
              Available to withdraw
            </p>
            <p className="mt-2 font-mono text-5xl font-semibold tracking-tight text-white">
              {formatCents(available)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">Cleared funds, ready to pay out.</p>
          </div>
        </div>
      </section>

      {/* Secondary buckets */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          label="Pending (accrued)"
          value={formatCents(accrued)}
          sub="clears when your client settles"
        />
        <Tile
          icon={<Hourglass className="h-4 w-4" strokeWidth={1.75} />}
          label="In review"
          value={formatCents(inFlight)}
          sub="payout requested, awaiting release"
          tone="cyan"
        />
        <Tile
          icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}
          label="Total earned"
          value={formatCents(totalEarned)}
          sub="lifetime, all jobs"
        />
      </section>

      {/* Available vs Pending explainer */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <Info className="h-4 w-4 text-cyan-glow" strokeWidth={2} />
          Available vs. Pending
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-violet/20 bg-violet/[0.05] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">Available</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              Money that has fully cleared. You can request a payout of any amount up to your Available balance.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">Pending</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              Earnings from jobs whose client is on payment terms (e.g. Net-30). They move to Available the moment the client settles, then you can withdraw.
            </p>
          </div>
        </div>
      </section>

      {/* Request payout */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">Request a payout</h2>

        {openRequest ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-glow/30 bg-cyan-glow/[0.06] p-4">
            <div className="flex items-center gap-3">
              <Hourglass className="h-5 w-5 text-cyan-glow" strokeWidth={2} />
              <div>
                <p className="text-sm font-semibold text-white">
                  Payout in review, {formatCents(openRequest.amountCents)}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Requested {fmtTime(openRequest.requestedAt)}. The team will release it shortly.
                </p>
              </div>
            </div>
            <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
              {openRequest.status}
            </span>
          </div>
        ) : available <= 0 ? (
          <p className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-500">
            No cleared funds yet. Once a job&apos;s earnings clear, you can request a payout here.
          </p>
        ) : (
          <form action={requestWithdrawal} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                  Amount (USD)
                </span>
                <input
                  type="number"
                  name="amount"
                  min={1}
                  max={available / 100}
                  step="0.01"
                  required
                  placeholder={(available / 100).toFixed(2)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/30"
                />
                <span className="mt-1 block text-[11px] text-zinc-500">
                  Available: {formatCents(available)}
                </span>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                  Payout method
                </span>
                <select
                  name="method"
                  defaultValue="bank_transfer"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white focus:border-violet/60 focus:outline-none"
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="stripe_manual">Stripe</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                Payout details / note (optional)
              </span>
              <input
                type="text"
                name="note"
                maxLength={200}
                placeholder="e.g. account ending 4321, or any instructions for the team"
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/30"
              />
            </label>
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <p className="text-xs text-zinc-500">
                Requesting reserves the amount and queues it for the NEXPEC team to release.
              </p>
              <button type="submit" className="btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap">
                Request payout
                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Per-job earnings from the settlement ledger (my_earnings_view) */}
      <EarningsByJob />

      {/* Recent activity */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Recent activity
        </p>
        {(!w || w.recent.length === 0) ? (
          <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-500">
            No transactions yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {w.recent.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">
                    {t.description ?? labelForType(t.type)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                    <span className="font-mono uppercase tracking-industrial">{t.type}</span>
                    <span>·</span>
                    <time>{fmtTime(t.createdAt)}</time>
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className={`font-mono text-sm ${signClass(t.type)}`}>
                    {signPrefix(t.type)}{formatCents(t.amountCents)}
                  </span>
                  <TxnStatus status={t.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ─── primitives ─────────────────────────────────────────────────────────── */

function Tile({
  icon, label, value, sub, tone = 'default',
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'default' | 'cyan';
}) {
  const valueColor = tone === 'cyan' ? 'text-cyan-glow' : 'text-white';
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

function TxnStatus({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
      : status === 'processing' || status === 'pending'
        ? 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber'
        : 'border-white/[0.06] bg-white/[0.04] text-zinc-400';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial ${tone}`}>
      {status}
    </span>
  );
}

function Banner({
  tone, icon, children,
}: {
  tone: 'red' | 'cyan'; icon: React.ReactNode; children: React.ReactNode;
}) {
  const classes = tone === 'red'
    ? 'border-accent-red/30 bg-accent-red/10 text-accent-red'
    : 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function labelForType(type: string): string {
  if (type === 'earning') return 'Inspection earning';
  if (type === 'payout') return 'Payout';
  if (type === 'settlement') return 'Client settlement';
  if (type === 'advance') return 'Early-payout advance';
  return type.replace(/_/g, ' ');
}
function signPrefix(type: string): string {
  return type === 'payout' || type === 'withdrawal' ? '−' : '+';
}
function signClass(type: string): string {
  return type === 'payout' || type === 'withdrawal' ? 'text-zinc-400' : 'text-accent-green';
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
