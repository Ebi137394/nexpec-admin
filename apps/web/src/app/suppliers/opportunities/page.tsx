'use client';
// /suppliers/opportunities — open RFQs the supplier can bid on (RLS-shaped).
// Matched-to-capability first; search + filter. Mirrors mobile open-opportunities.
//
// NOTE: the rfq_supplier_browse RLS only exposes open RFQs to suppliers with an
// ACTIVE supplier_profiles row. So if the vendor isn't listed yet, the marketplace
// is empty *by policy* — we detect that and guide them to create a profile rather
// than show a misleading "nothing open" state.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Megaphone, ShieldCheck, Store, ArrowRight, Sparkles } from 'lucide-react';
import { fetchOpenOpportunities, fetchMyVendorProfile, type Opportunity, type VendorProfile } from '@/lib/data/marketplace';

type Filter = 'all' | 'matched' | 'inspection' | 'procurement';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched to me' },
  { key: 'inspection', label: 'Source / FAT' },
  { key: 'procurement', label: 'Procurement' },
];

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    Promise.all([
      fetchOpenOpportunities().catch(() => []),
      fetchMyVendorProfile().catch(() => null),
    ]).then(([o, p]) => { setItems(o); setProfile(p); }).finally(() => setLoading(false));
  }, []);

  const list = useMemo(
    () =>
      items.filter((o) => {
        if (filter === 'matched' && !o.matched) return false;
        if (filter === 'inspection' && !o.requires_source_inspection) return false;
        if (filter === 'procurement' && o.requires_source_inspection) return false;
        if (q.trim() && !o.title.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [items, filter, q],
  );

  const notListed = !loading && (!profile || !profile.is_active);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">Marketplace</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">Opportunities</h1>
        <p className="mt-1 text-sm text-zinc-400">Brokered RFQs open for bidding. Pricing is blind — buyers never see competing quotes.</p>
      </header>

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
      ) : notListed ? (
        /* Vendor not listed/active → the marketplace is empty by RLS, not by chance. */
        <div className="relative overflow-hidden rounded-3xl border border-violet/25 bg-gradient-to-br from-violet/[0.12] to-ink-950 p-8 text-center">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-violet-glow/20 blur-[80px]" />
          <div className="relative mx-auto max-w-md">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet/15"><Sparkles size={26} className="text-violet-glow" /></div>
            <h2 className="mt-4 font-display text-xl font-semibold text-white">List your company to unlock the marketplace</h2>
            <p className="mt-2 text-sm text-zinc-400">
              {profile && !profile.is_active
                ? 'Your vendor profile is currently paused, so open RFQs are hidden. Reactivate it to start bidding again.'
                : 'Open RFQs are visible to active vendors only. Create your vendor profile — name your company and pick at least one capability — and live opportunities appear here instantly.'}
            </p>
            <Link href="/suppliers/profile" className="mt-5 inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet/20 transition hover:bg-violet-deep">
              <Store size={16} /> {profile && !profile.is_active ? 'Reactivate my profile' : 'Create vendor profile'}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5">
            <Search size={16} className="shrink-0 text-white/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search opportunities…" className="h-11 w-full bg-transparent text-sm text-white placeholder-white/40 outline-none" />
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = f.key === filter;
              return (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                  className={active
                    ? 'rounded-full border border-violet bg-violet px-3.5 py-1.5 text-xs font-bold text-white'
                    : 'rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-1.5 text-xs font-semibold text-zinc-400 transition hover:text-white'}>
                  {f.label}
                </button>
              );
            })}
          </div>

          {list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><Megaphone size={22} className="text-violet-glow" /></div>
              <p className="mt-3 text-sm font-semibold text-white">
                {items.length === 0 ? 'No open opportunities right now' : 'Nothing matches these filters'}
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
                {items.length === 0
                  ? 'New brokered RFQs appear here the moment buyers post them — we surface the ones matching your capabilities first.'
                  : 'Try clearing your search or switching filters.'}
              </p>
              {items.length === 0 && (
                <Link href="/suppliers/profile" className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-violet px-4 py-2 text-xs font-bold text-violet-glow hover:bg-violet/10"><Store size={14} /> Refine my capabilities</Link>
              )}
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {list.map((o) => (
                <li key={o.id}>
                  <Link href={`/suppliers/opportunities/${o.id}`} className="group flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/50 hover:bg-white/[0.04]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow">
                      {o.requires_source_inspection ? <ShieldCheck size={18} /> : <Store size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">{o.title}</p>
                        {o.matched && <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-industrial text-violet-glow">Match</span>}
                        {o.alreadyQuoted && <span className="rounded-full border border-cyan/50 px-2 py-0.5 text-[9px] font-bold text-cyan-glow">You bid</span>}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {o.requires_source_inspection ? 'Source / FAT inspection' : 'Procurement only'} · posted {new Date(o.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <ArrowRight size={16} className="mt-1 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-glow" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
