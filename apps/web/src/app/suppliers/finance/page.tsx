'use client';
// /suppliers/finance — read-only earnings ledger. Supplier payouts are brokered
// by NEXPEC admin (no client-writable balances — see the platform money model),
// so this surfaces the verified transaction history honestly without inventing a
// mutable wallet. Settlement & payout setup happen through the Coordination Bridge.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Clock, ShieldCheck, MessageCircle, Landmark,
} from 'lucide-react';
import { fetchSupplierTransactions, formatUsd, toCents, type SupplierTransaction } from '@/lib/data/marketplace';

const POSITIVE = new Set(['earning', 'deposit', 'refund', 'payout']);
const STATUS_CLS: Record<string, string> = {
  completed: 'text-accent-green', pending: 'text-accent-amber', processing: 'text-accent-amber',
  failed: 'text-accent-red',
};

export default function SupplierFinancePage() {
  const [txns, setTxns] = useState<SupplierTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSupplierTransactions().then(setTxns).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    let received = 0, pending = 0;
    for (const t of txns) {
      const cents = toCents(Math.abs(t.amount));
      if (t.status === 'pending' || t.status === 'processing') pending += cents;
      else if (t.status === 'completed' && POSITIVE.has(t.type)) received += cents;
    }
    return { received, pending, count: txns.length };
  }, [txns]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">My Business</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">Finance</h1>
        <p className="mt-1 text-sm text-zinc-400">Your verified settlement history. Payouts on awarded supply are brokered by NEXPEC.</p>
      </header>

      {/* Brokered-payout explainer */}
      <div className="flex items-start gap-3 rounded-2xl border border-violet/20 bg-violet/[0.06] p-4">
        <Landmark size={18} className="mt-0.5 shrink-0 text-violet-glow" />
        <div className="text-sm text-zinc-300">
          <p className="font-semibold text-white">Admin-brokered settlement</p>
          <p className="mt-0.5 text-zinc-400">
            NEXPEC holds and releases supplier payments against verified milestones — there is no self-service balance to top up or withdraw. To arrange a payout method or query a settlement, message the team on the{' '}
            <Link href="/suppliers/messages" className="font-semibold text-violet-glow hover:text-white">Coordination Bridge</Link>.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<ShieldCheck size={18} />} tone="text-accent-green" value={formatUsd(totals.received)} label="Lifetime received" />
        <Stat icon={<Clock size={18} />} tone="text-accent-amber" value={formatUsd(totals.pending)} label="Pending settlement" />
        <Stat icon={<Wallet size={18} />} tone="text-violet-glow" value={String(totals.count)} label="Ledger entries" />
      </div>

      {/* Ledger */}
      <section>
        <h2 className="mb-3 font-semibold text-white">Transaction history</h2>
        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
        ) : txns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><Wallet size={22} className="text-violet-glow" /></div>
            <p className="mt-3 text-sm font-semibold text-white">No transactions yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">When a buyer awards your quote and milestones clear, brokered settlements appear here — each one traceable to its source RFQ.</p>
            <Link href="/suppliers/opportunities" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-xs font-bold text-white hover:bg-violet-deep">Browse opportunities</Link>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
            {txns.map((t) => {
              const positive = POSITIVE.has(t.type);
              const cls = STATUS_CLS[t.status] ?? 'text-zinc-400';
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ${positive ? 'text-accent-green' : 'text-zinc-300'}`}>
                    {positive ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{t.description || t.type}</p>
                    <p className="mt-0.5 text-xs">
                      <span className="capitalize text-zinc-500">{t.type}</span>
                      <span className="text-white/20"> · </span>
                      <span className={`font-semibold capitalize ${cls}`}>{t.status}</span>
                      <span className="text-white/20"> · </span>
                      <span className="text-zinc-500">{new Date(t.created_at).toLocaleDateString()}</span>
                    </p>
                  </div>
                  <span className={`shrink-0 font-semibold ${positive ? 'text-accent-green' : 'text-zinc-200'}`}>
                    {positive ? '+' : '−'}{formatUsd(toCents(Math.abs(t.amount)))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="flex items-center gap-1.5 text-xs text-zinc-600">
        <MessageCircle size={13} /> Questions about a payout? Reach the brokerage team on the Coordination Bridge.
      </p>
    </div>
  );
}

function Stat({ icon, tone, value, label }: { icon: React.ReactNode; tone: string; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] ${tone}`}>{icon}</span>
      <p className="mt-2.5 font-display text-2xl font-semibold text-white">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
