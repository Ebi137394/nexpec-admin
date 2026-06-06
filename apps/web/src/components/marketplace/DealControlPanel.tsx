'use client';
// components/marketplace/DealControlPanel.tsx — admin control for a brokered deal.
//   Drives the P2 wiring end-to-end: present the supplier_supply leg, assign the
//   inspector (creates the inspector_engagement leg), accept goods, and release
//   each payout — every release gated server-side (contract-before-money +
//   milestone). Shows "no deal yet" until the client signs the supply agreement.
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserPlus, FileSignature, PackageCheck, Banknote } from 'lucide-react';
import {
  fetchDealByRfq, fetchDealAgreements, fetchDealMoneyLegs, assignInspector, presentAgreement,
  acceptGoods, releaseSupplierPayout, releaseInspectorPayout, formatUsd,
  type DealRow, type DealAgreement, type MoneyLeg,
} from '@/lib/data/marketplace';

export function DealControlPanel({ rfqId }: { rfqId: string }) {
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [agrs, setAgrs] = useState<DealAgreement[]>([]);
  const [legs, setLegs] = useState<MoneyLeg[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspId, setInspId] = useState('');
  const [payout, setPayout] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetchDealByRfq(rfqId);
    setDeal(d);
    if (d) { setAgrs(await fetchDealAgreements(d.id)); setLegs(await fetchDealMoneyLegs(d.id)); }
    setLoading(false);
  }, [rfqId]);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key); setMsg(null);
    const { error } = await fn();
    setBusy(null);
    if (error) { setMsg(error.message); return; }
    await load();
  };

  if (loading) return <div className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />;
  if (!deal) return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-500">
      No brokered deal yet. It appears once the client accepts an offer and signs the supply agreement.
    </div>
  );

  const supplier = agrs.find((a) => a.kind === 'supplier_supply');
  const inspector = agrs.find((a) => a.kind === 'inspector_engagement');
  const leg = (k: string) => legs.find((l) => l.kind === k);

  const Badge = ({ s }: { s: string }) => (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-300">{s}</span>
  );
  const inp = 'w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-violet-glow focus:outline-none';
  const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] px-3 py-1.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/[0.16] disabled:opacity-50';

  return (
    <section className="space-y-4 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80"><ShieldCheck className="h-3 w-3" /> Brokered deal control</p>
        <Badge s={deal.status} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-white">Supplier supply</p>
          {supplier ? (
            <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
              <span>{formatUsd(supplier.amount_cents)} cost</span><Badge s={supplier.status} />
            </div>
          ) : <p className="mt-1 text-xs text-zinc-500">not created</p>}
          {supplier && supplier.status === 'draft' && (
            <button disabled={busy === 'present'} onClick={() => run('present', () => presentAgreement(supplier.id))} className={`${btn} mt-2`}><FileSignature className="h-3 w-3" /> Present to supplier</button>
          )}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-white">Inspector engagement</p>
          {inspector ? (
            <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
              <span>{formatUsd(inspector.amount_cents)} payout</span><Badge s={inspector.status} />
            </div>
          ) : <p className="mt-1 text-xs text-zinc-500">not assigned</p>}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-xs font-semibold text-white">Assign inspector</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={inspId} onChange={(e) => setInspId(e.target.value)} placeholder="Inspector user ID (UUID)" className={inp} />
          <input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="Payout (USD)" inputMode="decimal" className={`${inp} sm:w-44`} />
          <button disabled={busy === 'assign' || !inspId.trim() || !payout.trim()} onClick={() => run('assign', () => assignInspector(deal.id, inspId.trim(), Math.round(parseFloat(payout || '0') * 100)))} className={`${btn} shrink-0`}><UserPlus className="h-3 w-3" /> Assign and present</button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">The full credential-dossier picker lands in P3; for now paste the inspector ID.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-white">Supplier payout</p>
          <p className="mt-1 text-[11px] text-zinc-500">Gate: supplier signed + goods accepted.</p>
          <div className="mt-2 flex gap-2">
            <button disabled={busy === 'goods' || !!deal.goods_accepted_at} onClick={() => run('goods', () => acceptGoods(deal.id))} className={btn}><PackageCheck className="h-3 w-3" /> {deal.goods_accepted_at ? 'Goods accepted' : 'Accept goods'}</button>
            <button disabled={busy === 'relS' || leg('supplier_payout')?.status === 'released'} onClick={() => run('relS', () => releaseSupplierPayout(deal.id))} className={btn}><Banknote className="h-3 w-3" /> {leg('supplier_payout')?.status === 'released' ? 'Released' : 'Release'}</button>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-white">Inspector payout</p>
          <p className="mt-1 text-[11px] text-zinc-500">Gate: inspector signed + report admin-confirmed.</p>
          <button disabled={busy === 'relI' || leg('inspector_payout')?.status === 'released'} onClick={() => run('relI', () => releaseInspectorPayout(deal.id))} className={`${btn} mt-2`}><Banknote className="h-3 w-3" /> {leg('inspector_payout')?.status === 'released' ? 'Released' : 'Release'}</button>
        </div>
      </div>

      {msg && <p className="text-xs text-accent-red">{msg}</p>}
    </section>
  );
}
