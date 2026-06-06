'use client';
// components/contracts/CommercialRevision.tsx — the Commercial Revision Ledger.
//   A formal, audit-ready price-revision docket (not a chat). Two exports:
//     CommercialRevision   — party panel (request / respond) + sealed ledger
//     AdminRevisionsPanel  — NEXPEC arbiter (accept / reject / counter)
import { useCallback, useEffect, useState } from 'react';
import { Scale, ShieldCheck, ArrowRight, Gavel, Clock, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import {
  fetchRevisionForAgreement, fetchDealRevisions, fetchRevisionEvents,
  requestPriceRevision, adminCounterRevision, adminDecideRevision, respondToCounter, withdrawRevision,
  formatUsd, REVISION_REASONS, type Revision, type RevisionEvent,
} from '@/lib/data/marketplace';

const inp = 'w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-violet-glow focus:outline-none';
const STATUS_TONE: Record<string, string> = {
  requested: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  countered: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
  applied: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
  rejected: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
  withdrawn: 'border-white/10 bg-white/[0.05] text-zinc-400',
};
const ACTION_LABEL: Record<string, string> = {
  propose: 'Proposed', counter: 'NEXPEC countered', accept: 'Accepted', reject: 'Declined', withdraw: 'Withdrawn', apply: 'Contract superseded',
};
const usd = (c: number | null | undefined) => (c == null ? '—' : formatUsd(c));

export function RevisionLedger({ events }: { events: RevisionEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="mt-3 space-y-2">
      {events.map((e) => {
        const nexpec = e.actor_role === 'nexpec';
        return (
          <li key={e.id} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${nexpec ? 'bg-violet-500/15 text-violet-200' : 'bg-white/[0.06] text-zinc-300'}`}>
              {e.action === 'apply' ? <Gavel className="h-3.5 w-3.5" /> : e.action === 'counter' ? <ArrowRight className="h-3.5 w-3.5" /> : e.action === 'reject' ? <XCircle className="h-3.5 w-3.5" /> : e.action === 'accept' ? <CheckCircle2 className="h-3.5 w-3.5" /> : e.action === 'withdraw' ? <RotateCcw className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold text-white">{ACTION_LABEL[e.action] ?? e.action}{e.amount_cents != null ? <span className="font-mono text-zinc-300"> · {usd(e.amount_cents)}</span> : null}</p>
                <span className="text-[11px] text-zinc-500">{new Date(e.created_at).toLocaleString()}</span>
              </div>
              {e.reason_code && <p className="mt-0.5 text-[11px] uppercase tracking-industrial text-zinc-500">{REVISION_REASONS[e.reason_code] ?? e.reason_code}</p>}
              {e.note && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-300">{e.note}</p>}
              {e.content_sha256 && <p className="mt-1 flex items-center gap-1 break-all text-[10px] text-zinc-600"><ShieldCheck className="h-3 w-3 shrink-0" /> sealed:{e.content_sha256.slice(0, 16)}…</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Party panel: request a revision / respond to a counter, with the sealed ledger ──
export function CommercialRevision({ agreementId, currency = 'USD' }: { agreementId: string; currency?: string }) {
  const [rev, setRev] = useState<Revision | null>(null);
  const [events, setEvents] = useState<RevisionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'idle' | 'request' | 'counter'>('idle');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('scope_change');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchRevisionForAgreement(agreementId);
    setRev(r);
    setEvents(r ? await fetchRevisionEvents(r.id) : []);
    setLoading(false);
  }, [agreementId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="mt-5 h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />;

  const cents = () => Math.round(parseFloat(amount || '0') * 100);
  const open = rev && (rev.status === 'requested' || rev.status === 'countered');
  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key); setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setMode('idle'); setAmount(''); setNote(''); await load();
  };

  return (
    <div className="mt-5 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-ink-800/50 to-ink-900/30 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-bold text-white"><Scale size={17} className="text-violet-glow" /> Commercial revision</h2>
        {rev && <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_TONE[rev.status]}`}>{rev.status}</span>}
      </div>

      {!open && mode !== 'request' && (
        <>
          <p className="mt-1 text-sm text-zinc-400">Request a formal, reason-coded price revision. NEXPEC reviews and may accept, decline, or counter — every step is a sealed record.</p>
          <button onClick={() => setMode('request')} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/[0.08] px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-500/[0.16]">
            <Scale size={15} /> Request a revision
          </button>
        </>
      )}

      {mode === 'request' && (
        <div className="mt-3 space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-industrial text-zinc-400">Proposed amount ({currency})</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" className={`${inp} mt-1`} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-industrial text-zinc-400">Reason</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${inp} mt-1`}>
                {Object.entries(REVISION_REASONS).map(([k, v]) => <option key={k} value={k} className="bg-ink-900">{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-industrial text-zinc-400">Formal justification</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="State the specific, substantive basis for this revision (min 20 characters)." className={`${inp} mt-1`} />
          </div>
          {err && <p className="text-sm text-accent-red">{err}</p>}
          <div className="flex gap-2">
            <button disabled={busy === 'req' || !amount.trim() || note.trim().length < 20} onClick={() => run('req', () => requestPriceRevision(agreementId, cents(), reason, note.trim()))} className="inline-flex items-center gap-1.5 rounded-xl bg-violet px-4 py-2 text-sm font-bold text-white hover:bg-violet/90 disabled:opacity-60"><ShieldCheck size={15} /> Submit sealed request</button>
            <button onClick={() => { setMode('idle'); setErr(null); }} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/[0.04]">Cancel</button>
          </div>
        </div>
      )}

      {rev && rev.status === 'requested' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <p className="inline-flex items-center gap-1.5 text-sm text-zinc-200"><Clock size={14} className="text-amber-300" /> Submitted ({usd(rev.proposed_amount_cents)}) — awaiting NEXPEC review.</p>
          <button disabled={busy === 'wd'} onClick={() => run('wd', () => withdrawRevision(rev.id))} className="text-xs font-semibold text-zinc-400 hover:text-white">Withdraw</button>
        </div>
      )}

      {rev && rev.status === 'countered' && mode !== 'counter' && (
        <div className="mt-3 space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
          <p className="text-sm text-zinc-200">NEXPEC countered at <span className="font-mono font-bold text-white">{usd(rev.counter_amount_cents)}</span> (your proposal: {usd(rev.proposed_amount_cents)}).</p>
          {err && <p className="text-sm text-accent-red">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy} onClick={() => run('acc', () => respondToCounter(rev.id, 'accept'))} className="inline-flex items-center gap-1.5 rounded-xl bg-accent-green/90 px-4 py-2 text-sm font-bold text-ink-950 hover:bg-accent-green disabled:opacity-60"><CheckCircle2 size={15} /> Accept counter</button>
            <button disabled={!!busy} onClick={() => setMode('counter')} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/[0.08] px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-500/[0.16]"><ArrowRight size={15} /> Counter back</button>
            <button disabled={!!busy} onClick={() => run('dec', () => respondToCounter(rev.id, 'reject'))} className="inline-flex items-center gap-1.5 rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-2 text-sm font-semibold text-accent-red hover:bg-accent-red/20 disabled:opacity-60"><XCircle size={15} /> Decline</button>
          </div>
        </div>
      )}

      {rev && rev.status === 'countered' && mode === 'counter' && (
        <div className="mt-3 space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <label className="block text-xs font-bold uppercase tracking-industrial text-zinc-400">Your counter-proposal ({currency})</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" className={inp} />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional note for the record." className={inp} />
          {err && <p className="text-sm text-accent-red">{err}</p>}
          <div className="flex gap-2">
            <button disabled={busy === 'cb' || !amount.trim()} onClick={() => run('cb', () => respondToCounter(rev.id, 'counter', cents(), note.trim() || undefined))} className="inline-flex items-center gap-1.5 rounded-xl bg-violet px-4 py-2 text-sm font-bold text-white hover:bg-violet/90 disabled:opacity-60"><ShieldCheck size={15} /> Send counter</button>
            <button onClick={() => { setMode('idle'); setErr(null); }} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/[0.04]">Cancel</button>
          </div>
        </div>
      )}

      {rev && rev.status === 'applied' && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-accent-green/20 bg-accent-green/[0.06] p-3 text-sm text-zinc-200"><Gavel size={15} className="text-accent-green" /> Revision applied at <span className="font-mono font-bold text-white">{usd(rev.agreed_amount_cents)}</span>; a superseding contract was issued and sealed.</p>
      )}

      <RevisionLedger events={events} />
    </div>
  );
}

// ── Admin arbiter panel: NEXPEC accepts / rejects / counters open cases ───────
export function AdminRevisionsPanel({ dealId, currency = 'USD' }: { dealId: string; currency?: string }) {
  const [revs, setRevs] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => { setLoading(true); setRevs(await fetchDealRevisions(dealId)); setLoading(false); }, [dealId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (revs.length === 0) return null;
  const cents = () => Math.round(parseFloat(amount || '0') * 100);
  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key); setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setCounterFor(null); setAmount(''); setNote(''); await load();
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-white"><Gavel className="h-3.5 w-3.5 text-violet-glow" /> Commercial revisions</p>
      <div className="mt-2 space-y-2">
        {revs.map((r) => (
          <div key={r.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-300"><span className="uppercase tracking-industrial text-zinc-500">{r.kind.replace(/_/g, ' ')}</span> · {REVISION_REASONS[r.reason_code] ?? r.reason_code}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_TONE[r.status]}`}>{r.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">Current {usd(r.current_amount_cents)} → proposed <span className="font-mono text-white">{usd(r.proposed_amount_cents)}</span>{r.counter_amount_cents != null ? ` · countered ${usd(r.counter_amount_cents)}` : ''}{r.agreed_amount_cents != null ? ` · agreed ${usd(r.agreed_amount_cents)}` : ''}</p>
            {r.justification && <p className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-300">{r.justification}</p>}
            {r.status === 'requested' && (
              counterFor === r.id ? (
                <div className="mt-2 space-y-2">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Counter (${currency})`} inputMode="decimal" className={inp} />
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inp} />
                  <div className="flex gap-2">
                    <button disabled={busy === `c-${r.id}` || !amount.trim()} onClick={() => run(`c-${r.id}`, () => adminCounterRevision(r.id, cents(), note.trim() || undefined))} className="rounded-lg border border-violet-500/30 bg-violet-500/[0.08] px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/[0.16] disabled:opacity-60">Send counter</button>
                    <button onClick={() => { setCounterFor(null); setErr(null); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button disabled={!!busy} onClick={() => run(`a-${r.id}`, () => adminDecideRevision(r.id, 'accept'))} className="inline-flex items-center gap-1 rounded-lg border border-accent-green/30 bg-accent-green/10 px-3 py-1.5 text-xs font-semibold text-accent-green disabled:opacity-60"><CheckCircle2 className="h-3 w-3" /> Accept</button>
                  <button disabled={!!busy} onClick={() => setCounterFor(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] px-3 py-1.5 text-xs font-semibold text-violet-200"><ArrowRight className="h-3 w-3" /> Counter</button>
                  <button disabled={!!busy} onClick={() => run(`r-${r.id}`, () => adminDecideRevision(r.id, 'reject'))} className="inline-flex items-center gap-1 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-1.5 text-xs font-semibold text-accent-red disabled:opacity-60"><XCircle className="h-3 w-3" /> Reject</button>
                </div>
              )
            )}
            {r.status === 'countered' && <p className="mt-2 text-[11px] text-zinc-500">Awaiting counterparty response to your counter.</p>}
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-accent-red">{err}</p>}
    </div>
  );
}
