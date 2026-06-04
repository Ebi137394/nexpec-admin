'use client';
// /directory — Supplier Directory (buyer-facing browse; mirrors mobile app/suppliers/index.tsx).
// Relocated here from /suppliers so the Supplier *portal* can own /suppliers/*.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ShieldCheck, Star, Store } from 'lucide-react';
import { fetchSupplierDirectory, fetchCapabilityCatalog, type SupplierCard, type CapabilityOption } from '@/lib/data/marketplace';

export default function SupplierDirectoryPage() {
  const [items, setItems] = useState<SupplierCard[]>([]);
  const [caps, setCaps] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cap, setCap] = useState('all');

  useEffect(() => {
    Promise.all([fetchSupplierDirectory().catch(() => []), fetchCapabilityCatalog().catch(() => [])])
      .then(([d, c]) => { setItems(d); setCaps(c); })
      .finally(() => setLoading(false));
  }, []);

  const capLabel = useMemo(() => Object.fromEntries(caps.map((c) => [c.key, c.label])), [caps]);
  const list = useMemo(() => items.filter((s) =>
    (cap === 'all' || (s.capabilities ?? []).includes(cap)) &&
    (q.trim() === '' || `${s.legal_name} ${s.headline ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [items, cap, q]);

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Find Suppliers</h1>
          <p className="mt-1 text-sm text-white/60">Source equipment, labs &amp; materials — any discipline.</p>
        </div>
        <Link href="/suppliers/profile" className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet px-4 py-2 text-sm font-bold text-violet-glow hover:bg-violet/10"><Store size={15} /> Become a supplier</Link>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3">
        <Search size={16} className="text-white/40" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers…" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder-white/40" />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {['all', ...caps.map((c) => c.key)].map((c) => {
          const active = c === cap;
          return <button key={c} onClick={() => setCap(c)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-violet bg-violet text-white' : 'border-ink-600 bg-ink-800 text-white/70 hover:text-white'}`}>{c === 'all' ? 'All' : (capLabel[c] ?? c)}</button>;
        })}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-ink-600 bg-ink-800 p-10 text-center">
          <p className="text-white/60">No suppliers yet.</p>
          <Link href="/suppliers/profile" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-violet px-4 py-2 text-sm font-bold text-violet-glow hover:bg-violet/10"><Store size={15} /> Become a supplier</Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet/20 text-lg font-extrabold text-violet-glow">{(s.legal_name ?? '?').slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate font-semibold">{s.legal_name}</h3>
                  {s.verified && <ShieldCheck size={14} className="shrink-0 text-accent-green" />}
                </div>
                {s.headline && <p className="truncate text-xs text-white/60">{s.headline}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(s.capabilities ?? []).slice(0, 3).map((k) => <span key={k} className="rounded border border-ink-600 bg-ink-950 px-1.5 py-0.5 text-[10px] font-semibold text-white/60">{capLabel[k] ?? k}</span>)}
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-white/50">
                  <Star size={11} className="text-accent-amber" />{Number(s.rating_avg ?? 0).toFixed(1)} ({s.rating_count ?? 0}){s.country_code && <span>· {s.country_code}</span>}
                </div>
              </div>
              <Link href="/rfqs/new" className="shrink-0 rounded-lg border border-violet px-3 py-1.5 text-xs font-bold text-violet-glow hover:bg-violet/10">Request</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
