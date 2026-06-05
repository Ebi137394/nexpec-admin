'use client';
// /admin/rfqs — Quote Review & Markup console (admin only). Lists every RFQ with
// its quote/markup state. Admin opens one to see raw supplier prices, set a
// client-facing markup, and present a curated offer to the client.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, ChevronRight, Inbox, Tag } from 'lucide-react';
import { fetchAdminRfqs, type AdminRfqRow } from '@/lib/data/marketplace';

const STATUS_CLS: Record<string, string> = {
  open: 'bg-cyan/15 text-cyan-glow',
  quoted: 'bg-accent-amber/15 text-accent-amber',
  awarded: 'bg-accent-green/15 text-accent-green',
  closed: 'bg-white/10 text-white/60',
  cancelled: 'bg-accent-red/15 text-accent-red',
};

export default function AdminRfqsPage() {
  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminRfqs().then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const actionable = rows.filter((r) => (r.status === 'open' || r.status === 'quoted') && r.quote_count > 0);
  const rest = rows.filter((r) => !((r.status === 'open' || r.status === 'quoted') && r.quote_count > 0));

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">Operations · Brokerage</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">Quote Review &amp; Markup</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Suppliers&rsquo; raw quotes land here for review. Set your client-facing markup and present a curated offer —
          the client never sees the supplier&rsquo;s raw price. They can only accept what you present.
        </p>
      </header>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-zinc-500" />
          <p className="mt-3 text-sm font-semibold text-white">No RFQs yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">When a client posts an RFQ and suppliers quote, it appears here for markup.</p>
        </div>
      ) : (
        <>
          {actionable.length > 0 && (
            <section>
              <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
                <Tag className="h-4 w-4" /> Awaiting markup
              </h2>
              <ul className="space-y-3">{actionable.map((r) => <RfqRow key={r.id} r={r} />)}</ul>
            </section>
          )}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-industrial text-zinc-400">All RFQs</h2>
            <ul className="space-y-3">{rest.map((r) => <RfqRow key={r.id} r={r} />)}</ul>
          </section>
        </>
      )}
    </div>
  );
}

function RfqRow({ r }: { r: AdminRfqRow }) {
  const cls = STATUS_CLS[r.status] ?? 'bg-white/10 text-white/60';
  return (
    <li>
      <Link
        href={`/admin/rfqs/${r.id}`}
        className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/30 hover:bg-white/[0.04] sm:p-5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow"><FileText size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{r.title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {r.quote_count} quote{r.quote_count === 1 ? '' : 's'}
            {r.presented_count > 0 ? ` · ${r.presented_count} presented` : ''}
            {' · '}{new Date(r.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`}>{r.status}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-glow" />
      </Link>
    </li>
  );
}
