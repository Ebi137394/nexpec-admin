'use client';
// /suppliers/bids — every quote the supplier has submitted, with live status.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Send, Rocket, Clock, Trophy, ArrowRight } from 'lucide-react';
import { fetchMyQuotes, formatUsd, toCents, type MyQuote } from '@/lib/data/marketplace';

const QSTATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-cyan/15 text-cyan-glow' },
  shortlisted: { label: 'Shortlisted', cls: 'bg-accent-amber/15 text-accent-amber' },
  accepted: { label: 'Awarded', cls: 'bg-accent-green/15 text-accent-green' },
  declined: { label: 'Not selected', cls: 'bg-accent-red/15 text-accent-red' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-white/10 text-white/60' },
};

type Tab = 'active' | 'won' | 'all';

export default function BidsPage() {
  const [quotes, setQuotes] = useState<MyQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('active');

  useEffect(() => {
    fetchMyQuotes().then(setQuotes).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    active: quotes.filter((q) => q.status === 'submitted' || q.status === 'shortlisted').length,
    won: quotes.filter((q) => q.status === 'accepted').length,
    all: quotes.length,
  }), [quotes]);

  const list = useMemo(() => {
    if (tab === 'active') return quotes.filter((q) => q.status === 'submitted' || q.status === 'shortlisted');
    if (tab === 'won') return quotes.filter((q) => q.status === 'accepted');
    return quotes;
  }, [quotes, tab]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">Marketplace</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">My Bids</h1>
        <p className="mt-1 text-sm text-zinc-400">Track every quote you&rsquo;ve submitted and its brokered outcome.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {([['active', 'Active', counts.active], ['won', 'Awarded', counts.won], ['all', 'All', counts.all]] as const).map(([key, label, n]) => {
          const active = key === tab;
          return (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={active
                ? 'inline-flex items-center gap-1.5 rounded-full border border-violet bg-violet px-3.5 py-1.5 text-xs font-bold text-white'
                : 'inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-1.5 text-xs font-semibold text-zinc-400 transition hover:text-white'}>
              {label}
              <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-white/[0.06]'}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><Send size={22} className="text-cyan-glow" /></div>
          <p className="mt-3 text-sm font-semibold text-white">{tab === 'won' ? 'No awards yet' : tab === 'active' ? 'No active bids' : 'No bids yet'}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">Browse open opportunities and submit a quote, awarded bids auto-dispatch source inspection.</p>
          <Link href="/suppliers/opportunities" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-xs font-bold text-white hover:bg-violet-deep">Browse opportunities <ArrowRight size={13} /></Link>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
          {list.map((q) => {
            const st = (QSTATUS[q.status] ?? QSTATUS.submitted) as { label: string; cls: string };
            const cents = q.quote?.amount_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : null);
            const Icon = q.status === 'accepted' ? Rocket : q.status === 'shortlisted' ? Trophy : Clock;
            return (
              <li key={q.id}>
                <Link href={`/suppliers/opportunities/${q.rfq_id}`} className="flex items-center gap-3 px-4 py-4 transition hover:bg-white/[0.03]">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] ${q.status === 'accepted' ? 'text-accent-green' : q.status === 'shortlisted' ? 'text-accent-amber' : 'text-zinc-300'}`}>
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{q.rfq_title || 'RFQ'}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {cents != null ? formatUsd(cents) : 'Quote on file'}, submitted {new Date(q.created_at).toLocaleDateString()}
                      {q.status === 'accepted' && q.spawned_job_id ? ', inspection dispatched' : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
