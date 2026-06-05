'use client';
// /rfqs — RFQ & Procurement hub (role-shaped by RLS, mirrors mobile app/rfqs/index.tsx)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ShieldCheck, Package, Rocket } from 'lucide-react';
import { fetchRfqs, type Rfq } from '@/lib/data/marketplace';

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-violet/15 text-violet-glow' },
  quoted: { label: 'Quoted', cls: 'bg-cyan/15 text-cyan-glow' },
  awarded: { label: 'Awarded', cls: 'bg-accent-green/15 text-accent-green' },
  closed: { label: 'Closed', cls: 'bg-white/10 text-white/60' },
  cancelled: { label: 'Cancelled', cls: 'bg-accent-red/15 text-accent-red' },
};

export default function RfqHubPage() {
  const [items, setItems] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchRfqs().then(setItems).catch(() => {}).finally(() => setLoading(false)); }, []);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">RFQs &amp; Procurement</h1>
          <p className="mt-1 text-sm text-white/60">Source anything. Inspection auto-dispatches on award.</p>
        </div>
        <Link href="/rfqs/new" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-sm font-bold hover:bg-violet-deep">
          <Plus size={16} /> New RFQ
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-ink-600 bg-ink-800 p-10 text-center">
          <p className="text-white/60">No RFQs yet.</p>
          <Link href="/rfqs/new" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-sm font-bold hover:bg-violet-deep"><Plus size={16} /> Post your first RFQ</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => {
            const st = (STATUS[r.status] ?? STATUS.open) as { label: string; cls: string };
            return (
              <li key={r.id}>
                <Link href={`/rfqs/${r.id}`} className="block rounded-xl border border-ink-600 bg-ink-800 p-4 transition hover:border-violet/60">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate font-semibold">{r.title}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {r.requires_source_inspection
                      ? <span className="inline-flex items-center gap-1 rounded-full border border-ink-600 px-2 py-0.5 font-semibold text-violet-glow"><ShieldCheck size={11} /> Source / FAT inspection</span>
                      : <span className="inline-flex items-center gap-1 rounded-full border border-ink-600 px-2 py-0.5 font-semibold text-white/50"><Package size={11} /> Procurement only</span>}
                    {r.spawned_job_id && <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/60 px-2 py-0.5 font-semibold text-accent-green"><Rocket size={11} /> Inspection dispatched</span>}
                    <span className="ml-auto text-white/40">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
