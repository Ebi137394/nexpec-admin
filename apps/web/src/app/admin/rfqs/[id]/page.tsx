'use client';
// /admin/rfqs/[id] — review raw supplier quotes, set the client markup, and
// present a curated offer. Admin sees EVERYTHING (cost, supplier identity,
// margin); the client only ever sees what admin presents.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Store, Send, CheckCircle2, ShieldCheck, Rocket } from 'lucide-react';
import {
  fetchAdminRfqQuotes, presentQuote, awardQuote, formatUsd, toCents,
  type Rfq, type AdminQuote,
} from '@/lib/data/marketplace';
import { useParams } from 'next/navigation';
import { DealControlPanel } from '@/components/marketplace/DealControlPanel';

export default function AdminRfqDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? '') as string;
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<AdminQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { rfq, quotes } = await fetchAdminRfqQuotes(id);
    setRfq(rfq); setQuotes(quotes); setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const awardable = !!rfq && (rfq.status === 'open' || rfq.status === 'quoted') && !rfq.spawned_job_id;

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />;
  if (!rfq) return (
    <div>
      <Link href="/admin/rfqs" className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> RFQs</Link>
      <p className="mt-6 text-zinc-400">RFQ not found.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/admin/rfqs" className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition hover:text-violet-glow"><ArrowLeft className="h-3.5 w-3.5" /> Quote Review</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Brokerage Markup</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">{rfq.title}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {quotes.length} quote{quotes.length === 1 ? '' : 's'}<span className="ml-3">status <span className="text-zinc-200">{rfq.status}</span></span>
          {rfq.requires_source_inspection && <span className="ml-2 inline-flex items-center gap-1 text-violet-glow"><ShieldCheck className="h-3.5 w-3.5" /> Source / FAT</span>}
        </p>
      </header>

      <DealControlPanel rfqId={id} />

      {rfq.spawned_job_id && (
        <div className="flex items-center gap-3 rounded-2xl border border-accent-green/40 bg-accent-green/10 p-4">
          <Rocket size={18} className="text-accent-green" />
          <p className="text-sm font-semibold text-accent-green">Awarded. Inspection dispatched. Pricing is locked.</p>
        </div>
      )}

      {msg && <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">{msg}</div>}

      {quotes.length === 0 ? (
        <p className="text-sm text-zinc-500">No supplier quotes yet.</p>
      ) : (
        <ul className="space-y-4">
          {quotes.map((q) => (
            <QuoteCard key={q.id} q={q} awardable={awardable} onChange={load} onError={setMsg} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteCard({ q, awardable, onChange, onError }: {
  q: AdminQuote; awardable: boolean; onChange: () => void; onError: (m: string | null) => void;
}) {
  const costCents = useMemo<number>(() => {
    const v = q.quote?.amount_cents ?? q.quote?.price_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : 0);
    return Number(v) || 0;
  }, [q.quote]);

  const presented = q.status === 'presented';
  const accepted = q.status === 'accepted';
  const declined = q.status === 'declined' || q.status === 'withdrawn';

  // Prefill the markup input with the existing client price (re-price) or a
  // suggested +20% markup over cost.
  const initial = q.client_price_cents != null ? q.client_price_cents : Math.round(costCents * 1.2);
  const [priceStr, setPriceStr] = useState(((initial || 0) / 100).toFixed(2));
  const [busy, setBusy] = useState(false);

  const clientCents = toCents(priceStr);
  const marginCents = clientCents - costCents;
  const marginPct = costCents > 0 ? (marginCents / costCents) * 100 : 0;
  const belowCost = costCents > 0 && clientCents < costCents;

  const present = async () => {
    onError(null);
    if (!clientCents || clientCents <= 0) { onError('Enter a client price.'); return; }
    if (belowCost) { onError('Client price is below supplier cost.'); return; }
    setBusy(true);
    try {
      const { error } = await presentQuote(q.id, clientCents);
      if (error) { onError(error.message); return; }
      onChange();
    } finally { setBusy(false); }
  };

  const awardOnBehalf = async () => {
    if (!window.confirm('Award this offer on the client&rsquo;s behalf? This dispatches the engagement.')) return;
    onError(null); setBusy(true);
    try {
      const { error } = await awardQuote(q.id);
      if (error) { onError(error.message); return; }
      onChange();
    } finally { setBusy(false); }
  };

  return (
    <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/12 text-cyan-glow"><Store size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{q.supplier_name ?? 'Supplier'}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {q.quote?.lead_time ? <><span className="text-zinc-500">Lead time</span> {q.quote.lead_time}</> : 'No lead time'}<span className="ml-2">{new Date(q.created_at).toLocaleDateString()}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-base font-semibold text-white">{formatUsd(costCents)}</p>
          <p className="text-[11px] text-zinc-500">supplier cost</p>
        </div>
      </div>
      {q.quote?.note && <p className="mt-2 rounded-lg border border-white/[0.05] bg-ink-950 p-2 text-xs text-zinc-400">{q.quote.note}</p>}

      {accepted ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-green">
          <CheckCircle2 size={15} /> Accepted, client paid {q.client_price_cents != null ? formatUsd(q.client_price_cents) : '—'}
        </p>
      ) : declined ? (
        <p className="mt-3 text-sm font-semibold text-zinc-500">Not selected</p>
      ) : !awardable ? (
        <p className="mt-3 text-xs text-zinc-500">This RFQ is no longer open for pricing.</p>
      ) : (
        <div className="mt-3 rounded-xl border border-violet/20 bg-violet/[0.05] p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">Client price (USD)</span>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-ink-950 px-3">
                <span className="text-sm text-white/40">$</span>
                <input value={priceStr} onChange={(e) => setPriceStr(e.target.value)} inputMode="decimal" className="h-10 w-full bg-transparent text-sm text-white outline-none" />
              </div>
            </label>
            <button
              onClick={present}
              disabled={busy || belowCost}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet px-4 text-sm font-bold text-white transition hover:bg-violet-deep disabled:opacity-50"
            >
              <Send size={15} /> {busy ? 'Saving…' : presented ? 'Re-price' : 'Present to client'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className={belowCost ? 'text-accent-red' : 'text-accent-green'}>
              <span className="text-zinc-500">Margin</span> {formatUsd(marginCents)} ({marginPct.toFixed(0)}%)
            </span>
            {presented && (
              <span className="inline-flex items-center gap-1 text-violet-glow">
                <CheckCircle2 size={12} /> Presented at {formatUsd(q.client_price_cents ?? 0)}, awaiting client
              </span>
            )}
          </div>
          {presented && (
            <button onClick={awardOnBehalf} disabled={busy} className="mt-2 text-[11px] font-semibold text-zinc-400 underline hover:text-white disabled:opacity-50">
              Award on the client&rsquo;s behalf
            </button>
          )}
        </div>
      )}
    </li>
  );
}
