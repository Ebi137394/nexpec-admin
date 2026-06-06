'use client';
// components/marketplace/DealControlPanel.tsx — admin control for a brokered deal.
//   Drives the P2 wiring end-to-end: present the supplier_supply leg, assign the
//   inspector (creates the inspector_engagement leg), accept goods, and release
//   each payout — every release gated server-side (contract-before-money +
//   milestone). Shows "no deal yet" until the client signs the supply agreement.
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserPlus, FileSignature, PackageCheck, Banknote, Search, Check, AlertTriangle, Wallet, Truck, FileWarning, Clock } from 'lucide-react';
import {
  fetchDealByRfq, fetchDealAgreements, fetchDealMoneyLegs, assignInspector, presentAgreement,
  acceptGoods, releaseSupplierPayout, releaseInspectorPayout, fetchInspectors, formatUsd,
  fetchPaymentSchedule, fetchNonconformances, fundDealBalance, markGoodsDelivered, markReportDelivered, raiseNonconformance,
  type DealRow, type DealAgreement, type MoneyLeg, type InspectorOption, type PaymentTranche, type Nonconformance,
} from '@/lib/data/marketplace';

export function DealControlPanel({ rfqId }: { rfqId: string }) {
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [agrs, setAgrs] = useState<DealAgreement[]>([]);
  const [legs, setLegs] = useState<MoneyLeg[]>([]);
  const [inspectors, setInspectors] = useState<InspectorOption[]>([]);
  const [sched, setSched] = useState<PaymentTranche[]>([]);
  const [ncrs, setNcrs] = useState<Nonconformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspId, setInspId] = useState('');
  const [inspQuery, setInspQuery] = useState('');
  const [payout, setPayout] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetchDealByRfq(rfqId);
    setDeal(d);
    if (d) {
      setAgrs(await fetchDealAgreements(d.id));
      setLegs(await fetchDealMoneyLegs(d.id));
      setInspectors(await fetchInspectors());
      setSched(await fetchPaymentSchedule(d.id));
      setNcrs(await fetchNonconformances(d.id));
    }
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

  const fileNcr = (kind: 'goods' | 'report') => {
    const citation = window.prompt(`Substantive Non-Conformance (${kind}) — cite the specific Schedule A spec or ASME/API code deviation (min 20 chars):`);
    if (citation == null || !deal) return;
    void run(`ncr-${kind}`, () => raiseNonconformance(deal.id, kind, citation));
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

  const term = inspQuery.trim().toLowerCase();
  const selected = inspectors.find((i) => i.id === inspId) ?? null;
  const matches = (term
    ? inspectors.filter((i) =>
        (i.full_name ?? '').toLowerCase().includes(term) ||
        (i.specialty_slugs ?? []).some((sg) => sg.toLowerCase().includes(term)) ||
        (i.certifications ?? []).some((sg) => sg.toLowerCase().includes(term)))
    : inspectors
  ).slice(0, 8);

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

      {supplier && !inspector && (
        <a
          href="#assign-inspector"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-3 transition-colors hover:bg-accent-amber/[0.16]"
        >
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-accent-amber">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Action needed: this awarded deal has no inspector yet. Assign one to generate and present their engagement contract.
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-amber/20 px-3 py-1.5 text-xs font-bold text-accent-amber">
            <UserPlus className="h-3 w-3" /> Assign inspector
          </span>
        </a>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-white"><Wallet className="h-3.5 w-3.5 text-violet-glow/80" /> Escrow &amp; milestone funding</p>
          <span className="text-[11px] text-zinc-500">{formatUsd(deal.client_price_cents)} total</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${deal.deposit_funded_at ? 'border-accent-green/30 bg-accent-green/10 text-accent-green' : 'border-white/10 bg-white/[0.04] text-zinc-400'}`}>Deposit 30% {deal.deposit_funded_at ? 'funded' : 'due on signature'}</span>
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${deal.balance_funded_at ? 'border-accent-green/30 bg-accent-green/10 text-accent-green' : 'border-white/10 bg-white/[0.04] text-zinc-400'}`}>Balance 70% {deal.balance_funded_at ? 'funded' : 'due at FAT-readiness'}</span>
        </div>
        {deal.deposit_funded_at && !deal.balance_funded_at && (
          <button disabled={busy === 'balance'} onClick={() => run('balance', () => fundDealBalance(deal.id))} className={`${btn} mt-2`}><Wallet className="h-3 w-3" /> Fund balance (70%)</button>
        )}
        {sched.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-white/[0.03] text-zinc-500"><tr><th className="px-2 py-1 font-medium">Tranche</th><th className="px-2 py-1 font-medium">Trigger</th><th className="px-2 py-1 text-right font-medium">Amount</th></tr></thead>
              <tbody>
                {sched.map((t) => (
                  <tr key={t.id} className="border-t border-white/[0.05] text-zinc-300">
                    <td className="px-2 py-1">{t.label} ({Math.round(t.pct_bps / 100)}%)</td>
                    <td className="px-2 py-1 text-zinc-500">{t.trigger_basis}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatUsd(t.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      <div id="assign-inspector" className="scroll-mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-xs font-semibold text-white">Assign inspector</p>

        {selected ? (
          <div className="mt-2 rounded-lg border border-violet-glow/30 bg-violet-500/[0.06] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{selected.full_name ?? 'Unnamed inspector'}</p>
                <p className="truncate text-[11px] text-zinc-400">{(selected.specialty_slugs ?? []).slice(0, 4).join(', ') || 'No specialties listed'}</p>
                {(selected.certifications ?? []).length > 0 && (
                  <p className="truncate text-[11px] text-zinc-500">Certs: {(selected.certifications ?? []).slice(0, 4).join(', ')}</p>
                )}
              </div>
              <button onClick={() => setInspId('')} className="shrink-0 text-[11px] font-semibold text-violet-200 hover:underline">Change</button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input value={inspQuery} onChange={(e) => setInspQuery(e.target.value)} placeholder="Search by name, specialty, or certification" className={`${inp} pl-8`} />
            </div>
            {matches.length > 0 ? (
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {matches.map((i) => (
                  <button key={i.id} onClick={() => { setInspId(i.id); setInspQuery(''); }} className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-violet-glow/40 hover:bg-white/[0.04]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{i.full_name ?? 'Unnamed inspector'}</p>
                      <p className="truncate text-[11px] text-zinc-500">{(i.specialty_slugs ?? []).slice(0, 3).join(', ') || 'No specialties listed'}{i.country_of_residence ? ` (${i.country_of_residence})` : ''}</p>
                    </div>
                    <Check className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-500">{inspectors.length === 0 ? 'No inspectors found.' : 'No matches for that search.'}</p>
            )}
          </>
        )}

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="Payout (USD)" inputMode="decimal" className={`${inp} sm:w-44`} />
          <button disabled={busy === 'assign' || !inspId || !payout.trim()} onClick={() => run('assign', () => assignInspector(deal.id, inspId, Math.round(parseFloat(payout || '0') * 100)))} className={`${btn} shrink-0`}><UserPlus className="h-3 w-3" /> Assign and present</button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">Selecting an inspector seals their A/B/C dossier into the deal and opens the client review window.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-white">Supplier payout</p>
          <p className="mt-1 text-[11px] text-zinc-500">Gate: supplier signed + goods accepted (or 10-business-day deemed acceptance).</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy === 'gdel' || !!deal.goods_delivered_at} onClick={() => run('gdel', () => markGoodsDelivered(deal.id))} className={btn}><Truck className="h-3 w-3" /> {deal.goods_delivered_at ? 'Delivered' : 'Mark delivered'}</button>
            <button disabled={busy === 'goods' || !!deal.goods_accepted_at} onClick={() => run('goods', () => acceptGoods(deal.id))} className={btn}><PackageCheck className="h-3 w-3" /> {deal.goods_accepted_at ? 'Goods accepted' : 'Accept goods'}</button>
            <button disabled={busy === 'relS' || leg('supplier_payout')?.status === 'released'} onClick={() => run('relS', () => releaseSupplierPayout(deal.id))} className={btn}><Banknote className="h-3 w-3" /> {leg('supplier_payout')?.status === 'released' ? 'Released' : 'Release'}</button>
            <button disabled={busy === 'ncr-goods'} onClick={() => fileNcr('goods')} className={btn}><FileWarning className="h-3 w-3" /> Reject (NCR)</button>
          </div>
          {deal.goods_delivered_at && !deal.goods_accepted_at && (
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500"><Clock className="h-3 w-3" /> Deemed-acceptance clock running (10 business days) unless an NCR is open.</p>
          )}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-white">Inspector payout</p>
          <p className="mt-1 text-[11px] text-zinc-500">Gate: inspector signed + report admin-confirmed (or 10-business-day deemed acceptance).</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy === 'rdel' || !!deal.report_delivered_at} onClick={() => run('rdel', () => markReportDelivered(deal.id))} className={btn}><Truck className="h-3 w-3" /> {deal.report_delivered_at ? 'Report delivered' : 'Mark report delivered'}</button>
            <button disabled={busy === 'relI' || leg('inspector_payout')?.status === 'released'} onClick={() => run('relI', () => releaseInspectorPayout(deal.id))} className={btn}><Banknote className="h-3 w-3" /> {leg('inspector_payout')?.status === 'released' ? 'Released' : 'Release'}</button>
            <button disabled={busy === 'ncr-report'} onClick={() => fileNcr('report')} className={btn}><FileWarning className="h-3 w-3" /> Reject (NCR)</button>
          </div>
          {deal.report_delivered_at && (
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500"><Clock className="h-3 w-3" /> Deemed-acceptance clock running (10 business days) unless an NCR is open.</p>
          )}
        </div>
      </div>

      {ncrs.length > 0 && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/[0.06] p-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-red"><FileWarning className="h-3.5 w-3.5" /> Open non-conformances freeze escrow release</p>
          <ul className="mt-1 space-y-1">
            {ncrs.map((n) => (
              <li key={n.id} className="text-[11px] text-zinc-300"><span className="font-semibold uppercase">{n.kind}</span> <span className="text-zinc-500">({n.status})</span> — {n.citation}{n.code_ref ? ` [${n.code_ref}]` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="text-xs text-accent-red">{msg}</p>}
    </section>
  );
}
