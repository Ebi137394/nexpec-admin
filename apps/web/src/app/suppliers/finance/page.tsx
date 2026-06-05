'use client';
// /suppliers/finance — enterprise Supplier Finance dashboard.
//
// 100% read-only analytics over REAL rows (accepted quotes = contracted value,
// live bids = pipeline, transactions = settlement). No mutable balance exists —
// supplier payouts are admin-brokered (the platform money model). Premium, honest.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Landmark, TrendingUp, Wallet, Clock, ShieldCheck, ArrowDownLeft, ArrowUpRight,
  Trophy, Send, Rocket, MessageCircle, Target, BadgeDollarSign,
} from 'lucide-react';
import { fetchSupplierFinance, formatUsd, type SupplierFinance } from '@/lib/data/marketplace';
import { SupplierPayoutCard } from '@/components/marketplace/SupplierPayoutCard';

const STATUS_CLS: Record<string, string> = {
  completed: 'text-accent-green', pending: 'text-accent-amber', processing: 'text-accent-amber', failed: 'text-accent-red',
};
const POSITIVE = new Set(['earning', 'deposit', 'refund', 'payout']);

export default function SupplierFinancePage() {
  const [fin, setFin] = useState<SupplierFinance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSupplierFinance().then(setFin).catch(() => setFin(null)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-40 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.02]" />
        <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
      </div>
    );
  }

  const f = fin ?? EMPTY;
  const hasActivity = f.bidCount > 0 || f.transactions.length > 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">My Business</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">Finance</h1>
        <p className="mt-1 text-sm text-zinc-400">Contracted earnings, settlement and pipeline — derived from your awards and brokered payouts.</p>
      </header>

      {/* Hero — contracted value + settlement split */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-violet/[0.16] via-ink-900/40 to-ink-950 p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-violet-glow/20 blur-[100px]" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            <BadgeDollarSign size={14} /> Contracted value (awarded work)
          </div>
          <p className="mt-2 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">{formatUsd(f.contractedCents)}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <SubMetric icon={<ShieldCheck size={15} />} tone="text-accent-green" label="Settled to you" value={formatUsd(f.receivedCents)} />
            <SubMetric icon={<Clock size={15} />} tone="text-accent-amber" label="Outstanding (brokered)" value={formatUsd(f.outstandingCents)} />
            <SubMetric icon={<Target size={15} />} tone="text-cyan-glow" label="In-bid pipeline" value={formatUsd(f.inBidCents)} />
          </div>
        </div>
      </section>

      {/* Brokered explainer */}
      <div className="flex items-start gap-3 rounded-2xl border border-violet/20 bg-violet/[0.06] p-4">
        <Landmark size={18} className="mt-0.5 shrink-0 text-violet-glow" />
        <p className="text-sm text-zinc-400">
          <span className="font-semibold text-white">Admin-brokered settlement.</span> NEXPEC holds and releases supplier payments against verified milestones — there is no self-service balance. Outstanding amounts settle as milestones clear. Questions? Reach the team on the{' '}
          <Link href="/suppliers/messages" className="font-semibold text-violet-glow hover:text-white">Coordination Bridge</Link>.
        </p>
      </div>

      {/* Withdrawable balance + Stripe Connect payouts (mirror inspector wallet) */}
      <SupplierPayoutCard />

      {/* KPI rail */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Trophy size={18} />} tone="green" value={f.winRate == null ? '—' : `${f.winRate}%`} label="Win rate" sub={`${f.wonCount} won · ${f.lostCount} lost`} />
        <Kpi icon={<BadgeDollarSign size={18} />} tone="violet" value={f.avgAwardCents == null ? '—' : formatUsd(f.avgAwardCents)} label="Avg. award value" sub={f.wonCount > 0 ? `across ${f.wonCount}` : 'no awards yet'} />
        <Kpi icon={<Send size={18} />} tone="cyan" value={String(f.activeCount)} label="Active bids" sub={`${f.bidCount} total`} />
        <Kpi icon={<Clock size={18} />} tone="amber" value={formatUsd(f.pendingCents)} label="Pending settlement" sub="processing" />
      </section>

      {!hasActivity ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><Wallet size={22} className="text-violet-glow" /></div>
          <p className="mt-3 text-sm font-semibold text-white">No financial activity yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">Win your first contract and your earnings analytics, payout timeline and settlement tracking populate here automatically.</p>
          <Link href="/suppliers/opportunities" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-xs font-bold text-white hover:bg-violet-deep">Browse opportunities</Link>
        </div>
      ) : (
        <>
          {/* Earnings trend + funnel */}
          <section className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold text-white"><TrendingUp size={16} className="text-violet-glow" /> Earnings trend</h2>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 text-zinc-400"><i className="h-2 w-2 rounded-sm bg-violet" /> Awarded</span>
                  <span className="inline-flex items-center gap-1.5 text-zinc-400"><i className="h-2 w-2 rounded-sm bg-accent-green" /> Settled</span>
                </div>
              </div>
              <TrendChart months={f.months} />
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
              <h2 className="font-semibold text-white">Bid funnel</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Conversion across your bids</p>
              <Funnel funnel={f.funnel} />
            </div>
          </section>

          {/* Contracted work / payout tracking */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-white"><Rocket size={16} className="text-accent-green" /> Contracted work</h2>
            {f.awardedContracts.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-sm text-zinc-400">No awarded contracts yet — your wins will appear here with their dispatch status.</p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
                {f.awardedContracts.map((c) => (
                  <li key={c.id}>
                    <Link href={`/suppliers/opportunities/${c.rfq_id}`} className="flex items-center gap-3 px-4 py-4 transition hover:bg-white/[0.03]">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-green/12 text-accent-green"><Trophy size={18} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{c.title}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">Awarded {new Date(c.created_at).toLocaleDateString()}{c.dispatched ? ' · inspection dispatched' : ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-base font-semibold text-white">{formatUsd(c.amountCents)}</p>
                        <p className={`text-[11px] font-semibold ${c.dispatched ? 'text-accent-green' : 'text-accent-amber'}`}>{c.dispatched ? 'In delivery' : 'Mobilising'}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Transaction ledger */}
          <section>
            <h2 className="mb-3 font-semibold text-white">Settlement history</h2>
            {f.transactions.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-sm text-zinc-400">No settlements yet. Brokered payouts appear here as milestones clear.</p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
                {f.transactions.map((t) => {
                  const positive = POSITIVE.has(t.type);
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ${positive ? 'text-accent-green' : 'text-zinc-300'}`}>
                        {positive ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{t.description || t.type}</p>
                        <p className="mt-0.5 text-xs">
                          <span className="capitalize text-zinc-500">{t.type}</span><span className="text-white/20"> · </span>
                          <span className={`font-semibold capitalize ${STATUS_CLS[t.status] ?? 'text-zinc-400'}`}>{t.status}</span><span className="text-white/20"> · </span>
                          <span className="text-zinc-500">{new Date(t.created_at).toLocaleDateString()}</span>
                        </p>
                      </div>
                      <span className={`shrink-0 font-semibold ${positive ? 'text-accent-green' : 'text-zinc-200'}`}>{positive ? '+' : '−'}{formatUsd(Math.round(Math.abs(t.amount) * 100))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-zinc-600"><MessageCircle size={13} /> Settlement questions? Reach the brokerage team on the Coordination Bridge.</p>
    </div>
  );
}

const EMPTY: SupplierFinance = {
  contractedCents: 0, inBidCents: 0, receivedCents: 0, pendingCents: 0, outstandingCents: 0,
  wonCount: 0, activeCount: 0, lostCount: 0, bidCount: 0, winRate: null, avgAwardCents: null,
  funnel: { submitted: 0, shortlisted: 0, awarded: 0 }, months: [], awardedContracts: [], transactions: [],
};

function SubMetric({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-ink-950/40 p-3.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-industrial ${tone}`}>{icon} {label}</div>
      <p className="mt-1 font-display text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

const KTONE: Record<string, string> = {
  violet: 'bg-violet/12 text-violet-glow', cyan: 'bg-cyan/12 text-cyan-glow',
  green: 'bg-accent-green/12 text-accent-green', amber: 'bg-accent-amber/12 text-accent-amber',
};
function Kpi({ icon, tone, value, label, sub }: { icon: React.ReactNode; tone: string; value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${KTONE[tone] ?? KTONE.violet}`}>{icon}</span>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="text-sm font-medium text-zinc-300">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

// Dependency-free grouped bar chart (awarded vs settled, 6 months).
function TrendChart({ months }: { months: SupplierFinance['months'] }) {
  if (months.length === 0) return <p className="mt-6 text-sm text-zinc-500">Not enough history yet.</p>;
  const W = 560, H = 180, padB = 26, padT = 10;
  const max = Math.max(1, ...months.map((m) => Math.max(m.awardedCents, m.receivedCents)));
  const groupW = W / months.length;
  const barW = Math.min(18, groupW / 3);
  const scale = (c: number) => (c / max) * (H - padB - padT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="Awarded vs settled by month">
      {[0.25, 0.5, 0.75, 1].map((p) => (
        <line key={p} x1={0} x2={W} y1={padT + (H - padB - padT) * (1 - p)} y2={padT + (H - padB - padT) * (1 - p)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      ))}
      {months.map((m, i) => {
        const cx = i * groupW + groupW / 2;
        const aH = scale(m.awardedCents), rH = scale(m.receivedCents);
        return (
          <g key={m.key}>
            <rect x={cx - barW - 2} y={H - padB - aH} width={barW} height={aH} rx={3} fill="#7C3AED" />
            <rect x={cx + 2} y={H - padB - rH} width={barW} height={rH} rx={3} fill="#10B981" />
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.45)">{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Funnel({ funnel }: { funnel: SupplierFinance['funnel'] }) {
  const max = Math.max(1, funnel.submitted);
  const rows = [
    { label: 'Submitted', n: funnel.submitted, cls: 'bg-cyan' },
    { label: 'Shortlisted', n: funnel.shortlisted, cls: 'bg-accent-amber' },
    { label: 'Awarded', n: funnel.awarded, cls: 'bg-accent-green' },
  ];
  return (
    <div className="mt-4 space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between text-xs"><span className="text-zinc-400">{r.label}</span><span className="font-semibold text-white">{r.n}</span></div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-ink-950">
            <div className={`h-full rounded-full ${r.cls}`} style={{ width: `${(r.n / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
