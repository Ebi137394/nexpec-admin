'use client';
// /rfqs/[id] — role-aware RFQ detail.
//   CLIENT (owner): sees ONLY admin-curated offers (marked-up price + NX- handle).
//     The raw supplier price is unreachable — RLS blocks the base table and the
//     client reads rfq_client_offers_view. Award is gated to PRESENTED offers.
//   SUPPLIER: sees their OWN bid (raw, their own number) + submit form.
// Mirrors mobile app/rfqs/[id].tsx.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Ribbon, Send, Rocket, ShieldCheck, Sparkles, Hourglass } from 'lucide-react';
import {
  fetchRfq, fetchClientOffers, fetchMyQuote, getUserId, submitQuote, awardQuote,
  formatUsd, toCents, type Rfq, type Quote, type ClientOffer,
} from '@/lib/data/marketplace';
import { MeetingsPanel } from '@/components/marketplace/MeetingsPanel';

const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';

// Client-facing offer statuses (the client never sees "submitted").
const OFFER_STATUS: Record<string, { label: string; cls: string }> = {
  presented: { label: 'Offer ready', cls: 'bg-violet/15 text-violet-glow' },
  accepted: { label: 'Accepted', cls: 'bg-accent-green/15 text-accent-green' },
  declined: { label: 'Closed', cls: 'bg-white/10 text-white/60' },
};
// Supplier-facing statuses for their own bid.
const BID_STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Under NEXPEC review', cls: 'bg-cyan/15 text-cyan-glow' },
  shortlisted: { label: 'Shortlisted', cls: 'bg-accent-amber/15 text-accent-amber' },
  presented: { label: 'With the client', cls: 'bg-violet/15 text-violet-glow' },
  accepted: { label: 'Awarded', cls: 'bg-accent-green/15 text-accent-green' },
  declined: { label: 'Not selected', cls: 'bg-accent-red/15 text-accent-red' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-white/10 text-white/60' },
};

export default function RfqDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? '') as string;
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [offers, setOffers] = useState<ClientOffer[]>([]);     // client (owner) view
  const [myQuote, setMyQuote] = useState<Quote | null>(null);  // supplier view
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(''); const [lead, setLead] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [awarding, setAwarding] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const u = await getUserId();
    const r = await fetchRfq(id);
    setUid(u); setRfq(r);
    const owner = !!u && !!r && u === r.client_id;
    if (owner) {
      setOffers(await fetchClientOffers(id));
    } else {
      setMyQuote(await fetchMyQuote(id));
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const isOwner = !!uid && !!rfq && uid === rfq.client_id;
  const awardable = !!rfq && (rfq.status === 'open' || rfq.status === 'quoted') && !rfq.spawned_job_id;

  const doSubmit = async () => {
    setMsg(null);
    if (!amount.trim()) { setMsg('Enter a quote amount.'); return; }
    setBusy(true);
    try {
      const quote: any = { amount_cents: toCents(amount) };
      if (lead.trim()) quote.lead_time = lead.trim();
      if (note.trim()) quote.note = note.trim();
      const { error } = await submitQuote(id, quote);
      if (error) { setMsg(error.message); return; }
      setAmount(''); setLead(''); setNote(''); await load(); setMsg('Quote submitted. NEXPEC will review it.');
    } finally { setBusy(false); }
  };

  const doAccept = async (offer: ClientOffer) => {
    if (!window.confirm(rfq?.requires_source_inspection
      ? 'Accept this offer? NEXPEC will proceed and auto-create a source/FAT inspection job, dispatching a discipline-matched inspector.'
      : 'Accept this offer and proceed?')) return;
    setMsg(null); setAwarding(offer.id);
    try {
      const { error } = await awardQuote(offer.id);
      if (error) { setMsg(error.message); return; }
      await load();
    } finally { setAwarding(null); }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />;
  if (!rfq) return (
    <div className="mx-auto max-w-2xl">
      <BackToRfqs />
      <p className="mt-6 text-white/60">RFQ not found.</p>
    </div>
  );

  const presentedOffers = offers.filter((o) => o.status === 'presented');

  return (
    <div className="mx-auto max-w-2xl">
      <BackToRfqs />
      <h1 className="mt-4 text-2xl font-extrabold">{rfq.title}</h1>
      {rfq.spec?.details && <p className="mt-2 text-sm leading-relaxed text-white/70">{rfq.spec.details}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {rfq.spec?.quantity && <Tag>{rfq.spec.quantity}</Tag>}
        <Tag>{rfq.status}</Tag>
        {rfq.requires_source_inspection && <Tag className="border-violet/60 text-violet-glow"><ShieldCheck size={11} /> Source / FAT</Tag>}
      </div>

      {rfq.spawned_job_id && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent-green/60 bg-accent-green/10 p-4">
          <Rocket size={18} className="text-accent-green" />
          <div>
            <p className="text-sm font-bold text-accent-green">Inspection dispatched</p>
            <p className="text-xs text-white/60">A source/FAT job is in admin dispatch for the awarded engagement.</p>
          </div>
        </div>
      )}

      {/* Brokered War Room — meetings on this RFQ workspace */}
      <div className="mt-6">
        <MeetingsPanel rfqId={rfq.id} parties={[{ id: rfq.client_id, label: 'Client', role: 'client' }]} />
      </div>

      {/* ───────────── SUPPLIER VIEW — submit + own bid ───────────── */}
      {!isOwner && (
        <>
          {awardable && (
            <div className="mt-6 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <h2 className="mb-3 font-bold">{myQuote ? 'Update your quote' : 'Submit a quote'}</h2>
              <div className="space-y-3">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount in USD (e.g. 4200)" className={inp} />
                <input value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Lead time (e.g. 3 weeks)" className={inp} />
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Notes (compliance, incoterms…)" className={inp} />
                <button onClick={doSubmit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-bold hover:bg-violet-deep disabled:opacity-60">
                  <Send size={15} /> {busy ? 'Submitting…' : myQuote ? 'Resubmit quote' : 'Submit quote'}
                </button>
              </div>
            </div>
          )}
          {msg && <p className="mt-3 text-sm text-cyan-glow">{msg}</p>}
          <h2 className="mb-3 mt-8 font-bold">Your quote</h2>
          {!myQuote ? (
            <p className="text-sm text-white/50">You haven&rsquo;t quoted yet.</p>
          ) : (
            <BidRow quote={myQuote} />
          )}
          <p className="mt-3 text-[11px] text-white/40">NEXPEC reviews every quote and brokers the award. You&rsquo;ll be notified if yours is selected.</p>
        </>
      )}

      {/* ───────────── CLIENT (OWNER) VIEW — curated offers only ───────────── */}
      {isOwner && (
        <>
          {msg && <p className="mt-6 text-sm text-cyan-glow">{msg}</p>}
          <h2 className="mb-3 mt-8 font-bold">Offers</h2>
          {offers.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <Hourglass size={18} className="mt-0.5 shrink-0 text-cyan-glow" />
              <div>
                <p className="text-sm font-semibold text-white">NEXPEC is sourcing your offer</p>
                <p className="mt-0.5 text-xs text-white/60">Our team is reviewing the market and preparing a curated offer for you. It will appear here for your approval.</p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {offers.map((o) => {
                const st = OFFER_STATUS[o.status] ?? { label: o.status, cls: 'bg-white/10 text-white/60' };
                const won = o.status === 'accepted';
                return (
                  <li key={o.id} className={`rounded-xl border bg-ink-800 p-4 ${won ? 'border-accent-green/60' : 'border-ink-600'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-extrabold">{o.price_cents != null ? formatUsd(o.price_cents) : '—'}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                      {o.supplier_handle && <span className="inline-flex items-center gap-1"><Sparkles size={11} className="text-violet-glow" /> {o.supplier_handle}</span>}
                      {o.lead_time && <span><span className="text-white/40">Lead time</span> {o.lead_time}</span>}
                    </div>
                    {o.status === 'presented' && awardable && (
                      <button onClick={() => doAccept(o)} disabled={!!awarding} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-bold hover:bg-violet-deep disabled:opacity-60">
                        <Ribbon size={15} /> {awarding === o.id ? 'Processing…' : 'Accept & proceed'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {presentedOffers.length > 0 && (
            <p className="mt-3 text-[11px] text-white/40">Pricing is brokered by NEXPEC. Accepting an offer authorizes us to proceed and (where required) dispatch a source/FAT inspection.</p>
          )}
        </>
      )}
    </div>
  );
}

function BidRow({ quote }: { quote: Quote }) {
  const st = BID_STATUS[quote.status] ?? { label: quote.status, cls: 'bg-white/10 text-white/60' };
  const cents = quote.quote?.amount_cents ?? (quote.quote?.amount != null ? toCents(quote.quote.amount) : null);
  return (
    <li className="list-none rounded-xl border border-ink-600 bg-ink-800 p-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-extrabold">{cents != null ? formatUsd(cents) : '—'}</span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
      </div>
      {quote.quote?.lead_time && <p className="mt-1 text-xs text-white/60"><span className="text-white/40">Lead time</span> {quote.quote.lead_time}</p>}
      {quote.quote?.note && <p className="mt-1 text-sm text-white/70">{quote.quote.note}</p>}
    </li>
  );
}

function Tag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border border-ink-600 px-2 py-0.5 font-semibold text-white/70 ${className}`}>{children}</span>;
}

function BackToRfqs() {
  return (
    <Link href="/rfqs" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/60 transition hover:text-white">
      <ArrowLeft size={15} /> RFQs
    </Link>
  );
}
