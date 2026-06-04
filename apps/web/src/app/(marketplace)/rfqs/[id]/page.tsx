'use client';
// /rfqs/[id] — detail: quotes, client award (auto-spawns inspection), supplier bid
// (price-blind by RLS). Mirrors mobile app/rfqs/[id].tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Ribbon, Send, Rocket, ShieldCheck } from 'lucide-react';
import { fetchRfqDetail, getUserId, submitQuote, awardQuote, formatUsd, toCents, type Rfq, type Quote } from '@/lib/data/marketplace';
import { MeetingsPanel } from '@/components/marketplace/MeetingsPanel';

const inp = 'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';
const QSTATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-cyan/15 text-cyan-glow' },
  shortlisted: { label: 'Shortlisted', cls: 'bg-accent-amber/15 text-accent-amber' },
  accepted: { label: 'Awarded', cls: 'bg-accent-green/15 text-accent-green' },
  declined: { label: 'Lost', cls: 'bg-accent-red/15 text-accent-red' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-white/10 text-white/60' },
};

export default function RfqDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(''); const [lead, setLead] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [awarding, setAwarding] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, u] = await Promise.all([fetchRfqDetail(id), getUserId()]);
    setRfq(d.rfq); setQuotes(d.quotes); setUid(u); setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const isOwner = !!uid && !!rfq && uid === rfq.client_id;
  const myQuote = useMemo(() => (uid ? quotes.find((q) => q.supplier_id === uid) : undefined), [quotes, uid]);
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
      setAmount(''); setLead(''); setNote(''); await load(); setMsg('Quote submitted.');
    } finally { setBusy(false); }
  };

  const doAward = async (q: Quote) => {
    if (!window.confirm(rfq?.requires_source_inspection
      ? 'Award this quote? NEXPEC will auto-create a source/FAT inspection job and dispatch a discipline-matched inspector.'
      : 'Award this quote?')) return;
    setMsg(null); setAwarding(q.id);
    try {
      const { error } = await awardQuote(q.id);
      if (error) { setMsg(error.message); return; }
      await load();
    } finally { setAwarding(null); }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />;
  if (!rfq) return <p className="text-white/60">RFQ not found.</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold">{rfq.title}</h1>
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
            <p className="text-xs text-white/60">A source/FAT job is in admin dispatch for the awarded supplier.</p>
          </div>
        </div>
      )}

      {/* Brokered War Room — meetings on this RFQ workspace */}
      <div className="mt-6">
        <MeetingsPanel rfqId={rfq.id} parties={[{ id: rfq.client_id, label: 'Client', role: 'client' }]} />
      </div>

      {!isOwner && awardable && (
        <div className="mt-6 rounded-xl border border-ink-600 bg-ink-800 p-4">
          <h2 className="mb-3 font-bold">{myQuote ? 'Update your quote' : 'Submit a quote'}</h2>
          <div className="space-y-3">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount (USD) — e.g. 4200" className={inp} />
            <input value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Lead time — e.g. 3 weeks" className={inp} />
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note — compliance, incoterms…" className={inp} />
            <button onClick={doSubmit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-bold hover:bg-violet-deep disabled:opacity-60">
              <Send size={15} /> {busy ? 'Submitting…' : myQuote ? 'Resubmit quote' : 'Submit quote'}
            </button>
          </div>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-cyan-glow">{msg}</p>}

      <h2 className="mb-3 mt-8 font-bold">{isOwner ? `Quotes (${quotes.length})` : 'Your quote'}</h2>
      {quotes.length === 0 ? (
        <p className="text-sm text-white/50">{isOwner ? 'No quotes yet.' : 'You haven’t quoted yet.'}</p>
      ) : (
        <ul className="space-y-3">
          {quotes.map((q) => {
            const st = QSTATUS[q.status] ?? QSTATUS.submitted;
            const won = q.status === 'accepted'; const lost = q.status === 'declined';
            const cents = q.quote?.amount_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : null);
            return (
              <li key={q.id} className={`rounded-xl border bg-ink-800 p-4 ${won ? 'border-accent-green/60' : 'border-ink-600'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-extrabold">{cents != null ? formatUsd(cents) : '—'}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                </div>
                {q.quote?.lead_time && <p className="mt-1 text-xs text-white/60">Lead time · {q.quote.lead_time}</p>}
                {q.quote?.note && <p className="mt-1 text-sm text-white/70">{q.quote.note}</p>}
                {isOwner && awardable && !lost && (
                  <button onClick={() => doAward(q)} disabled={!!awarding} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-bold hover:bg-violet-deep disabled:opacity-60">
                    <Ribbon size={15} /> {awarding === q.id ? 'Awarding…' : 'Award & dispatch'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Tag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border border-ink-600 px-2 py-0.5 font-semibold text-white/70 ${className}`}>{children}</span>;
}
