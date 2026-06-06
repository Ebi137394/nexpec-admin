'use client';
// /agreements — a counterparty's own legs (supplier_supply / inspector_engagement /
//   client_supply). Top-level route so suppliers AND inspectors can reach it. RLS
//   scopes rows to the signed-in counterparty, so each party sees only their own.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSignature, ArrowRight } from 'lucide-react';
import { fetchMyAgreements, formatUsd, type MyAgreement } from '@/lib/data/marketplace';

const KIND_LABEL: Record<string, string> = {
  client_supply: 'Supply & Inspection',
  supplier_supply: 'Supplier Supply',
  inspector_engagement: 'Inspector Engagement',
};
const ACTIONABLE = new Set(['presented']);

function Row({ r }: { r: MyAgreement }) {
  return (
    <Link href={`/agreements/${r.id}/sign`} className="flex items-center justify-between rounded-xl border border-ink-600 bg-ink-800 p-4 transition hover:border-violet/60">
      <div>
        <p className="font-semibold text-white">{KIND_LABEL[r.kind] ?? r.kind}</p>
        <p className="mt-0.5 text-xs text-white/50">
          {formatUsd(r.amount_cents)}
          <span className="ml-2 rounded border border-white/10 px-1.5 py-0.5 capitalize text-white/60">{r.status}</span>
        </p>
      </div>
      <ArrowRight size={16} className="text-white/40" />
    </Link>
  );
}

export default function MyAgreementsPage() {
  const [rows, setRows] = useState<MyAgreement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyAgreements().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  const toSign = rows.filter((r) => ACTIONABLE.has(r.status));
  const rest = rows.filter((r) => !ACTIONABLE.has(r.status));

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <FileSignature size={20} className="text-violet-glow" /> My agreements
        </h1>
        <p className="mt-1 text-sm text-white/50">Every agreement is between you and NEXPEC. Review and sign the ones awaiting you.</p>

        {loading ? (
          <div className="mt-6 h-24 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />
        ) : rows.length === 0 ? (
          <p className="mt-6 text-white/60">No agreements yet.</p>
        ) : (
          <div className="mt-6 space-y-6">
            {toSign.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-industrial text-amber-300">Awaiting your signature</h2>
                <div className="space-y-2">{toSign.map((r) => <Row key={r.id} r={r} />)}</div>
              </section>
            )}
            {rest.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-industrial text-white/50">All agreements</h2>
                <div className="space-y-2">{rest.map((r) => <Row key={r.id} r={r} />)}</div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
