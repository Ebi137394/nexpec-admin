'use client';
// /suppliers/opportunities/[id] — supplier RFQ detail + bid (price-blind by RLS).
// Suppliers see only their OWN quote; the buyer + competing quotes stay hidden.
// Award happens on the buyer side; suppliers submit/update and watch status.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Send, Rocket, ShieldCheck, Package, CheckCircle2, MessageSquare } from 'lucide-react';
import { fetchRfqDetail, getUserId, submitQuote, formatUsd, toCents, type Rfq, type Quote } from '@/lib/data/marketplace';
import { MeetingsPanel } from '@/components/marketplace/MeetingsPanel';
import { openJobChat } from '@/lib/actions/messages';

const inp = 'w-full rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-violet';
const QSTATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-cyan/15 text-cyan-glow' },
  shortlisted: { label: 'Shortlisted', cls: 'bg-accent-amber/15 text-accent-amber' },
  accepted: { label: 'Awarded', cls: 'bg-accent-green/15 text-accent-green' },
  declined: { label: 'Not selected', cls: 'bg-accent-red/15 text-accent-red' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-white/10 text-white/60' },
};

export default function SupplierOpportunityPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? '') as string;
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(''); const [lead, setLead] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, u] = await Promise.all([fetchRfqDetail(id), getUserId()]);
    setRfq(d.rfq); setQuotes(d.quotes); setUid(u); setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const myQuote = useMemo(() => (uid ? quotes.find((q) => q.supplier_id === uid) : undefined), [quotes, uid]);
  const biddable = !!rfq && (rfq.status === 'open' || rfq.status === 'quoted') && !rfq.spawned_job_id;
  const myCents = myQuote?.quote?.amount_cents ?? (myQuote?.quote?.amount != null ? toCents(myQuote.quote.amount) : null);
  const st = myQuote ? (QSTATUS[myQuote.status] ?? QSTATUS.submitted) as { label: string; cls: string } : null;

  const doSubmit = async () => {
    setMsg(null);
    if (!amount.trim()) { setMsg('Enter a quote amount.'); return; }
    setBusy(true);
    try {
      const quote: Record<string, unknown> = { amount_cents: toCents(amount) };
      if (lead.trim()) quote.lead_time = lead.trim();
      if (note.trim()) quote.note = note.trim();
      const { error } = await submitQuote(id, quote);
      if (error) { setMsg(error.message); return; }
      setAmount(''); setLead(''); setNote(''); await load(); setMsg('Quote submitted — admin will review and broker the award.');
    } finally { setBusy(false); }
  };

  if (loading) return <div className="h-48 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />;
  if (!rfq) return (
    <div>
      <BackLink />
      <p className="mt-6 text-zinc-400">Opportunity not found, or it&rsquo;s no longer open to your account.</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      {/* RFQ header */}
      <header className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-violet/[0.1] to-ink-950 p-6">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">
          {rfq.requires_source_inspection ? <><ShieldCheck size={13} /> Source / FAT inspection</> : <><Package size={13} /> Procurement only</>}
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">{rfq.title}</h1>
        {rfq.spec?.details && <p className="mt-2 text-sm leading-relaxed text-zinc-300">{rfq.spec.details}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          {rfq.spec?.quantity && <Tag>{rfq.spec.quantity}</Tag>}
          <Tag>{rfq.status}</Tag>
          <Tag>Posted {new Date(rfq.created_at).toLocaleDateString()}</Tag>
        </div>
      </header>

      {rfq.spawned_job_id && (
        <div className="flex items-center gap-3 rounded-2xl border border-accent-green/40 bg-accent-green/10 p-4">
          <Rocket size={18} className="shrink-0 text-accent-green" />
          <div>
            <p className="text-sm font-bold text-accent-green">Inspection dispatched</p>
            <p className="text-xs text-zinc-400">This RFQ has been awarded and a source/FAT job is in admin dispatch.</p>
          </div>
        </div>
      )}

      {/* Project chat — awarded supplier ↔ NEXPEC admin (job_supplier_admin).
          Mirrors the inspector job room; client/inspector can't see it. */}
      {rfq.spawned_job_id && myQuote?.status === 'accepted' && (
        <form action={openJobChat} className="rounded-2xl border border-violet/30 bg-violet/[0.07] p-4">
          <input type="hidden" name="jobId" value={rfq.spawned_job_id} />
          <input type="hidden" name="kind" value="job_supplier_admin" />
          <input type="hidden" name="returnToBase" value="/suppliers/messages" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Project coordination chat</p>
              <p className="mt-0.5 text-xs text-zinc-400">A private, admin-brokered room for this awarded job. The buyer and inspector cannot see it.</p>
            </div>
            <button type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-violet px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-deep">
              <MessageSquare size={15} /> Open chat
            </button>
          </div>
        </form>
      )}

      {/* My quote status */}
      {myQuote && st && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-cyan-glow" />
              <h2 className="font-semibold text-white">Your bid</h2>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
          </div>
          <p className="mt-3 font-display text-2xl font-semibold text-white">{myCents != null ? formatUsd(myCents) : '—'}</p>
          {myQuote.quote?.lead_time && <p className="mt-1 text-xs text-zinc-500">Lead time · {myQuote.quote.lead_time}</p>}
          {myQuote.quote?.note && <p className="mt-2 text-sm text-zinc-300">{myQuote.quote.note}</p>}
        </div>
      )}

      {/* Bid form */}
      {biddable ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h2 className="font-semibold text-white">{myQuote ? 'Update your quote' : 'Submit a quote'}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Your price is private — NEXPEC brokers the award. Buyers never see competing bids.</p>
          <div className="mt-4 space-y-3">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount (USD) — e.g. 4200" className={inp} />
            <input value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Lead time — e.g. 3 weeks" className={inp} />
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note — compliance, incoterms, scope clarifications…" className={inp} />
            <button onClick={doSubmit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2.5 text-sm font-bold text-white transition hover:bg-violet-deep disabled:opacity-60">
              <Send size={15} /> {busy ? 'Submitting…' : myQuote ? 'Resubmit quote' : 'Submit quote'}
            </button>
            {msg && <p className="text-sm text-cyan-glow">{msg}</p>}
          </div>
        </div>
      ) : (
        !rfq.spawned_job_id && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-sm text-zinc-400">
            This opportunity is no longer accepting quotes.
          </div>
        )
      )}

      {/* Brokered War Room — supplier sees admin-convened meetings (no direct client invites) */}
      <MeetingsPanel rfqId={rfq.id} />
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] px-2.5 py-0.5 font-semibold text-zinc-300">{children}</span>;
}

function BackLink() {
  return (
    <Link href="/suppliers/opportunities" className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-400 transition hover:text-white">
      <ArrowLeft size={15} /> Opportunities
    </Link>
  );
}
