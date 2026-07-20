'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AiTable, StatusBadge, dt, short, type Column } from '@/components/admin/ai-platform/kit';

const LIFECYCLES = ['', 'pending', 'reviewed', 'accepted', 'rejected', 'hard_example', 'golden_sample', 'training_candidate', 'archived'];

interface Img extends Record<string, unknown> {
  id: string; model_slug: string | null; lifecycle: string; source: string;
  quality_score: number | null; sha256: string | null; created_at: string;
}

const columns: Column<Img>[] = [
  { key: 'lifecycle', label: 'Lifecycle', render: (r) => <StatusBadge value={r.lifecycle} /> },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug ?? '—'}</span> },
  { key: 'source', label: 'Source', render: (r) => <span className="text-xs">{r.source}</span> },
  { key: 'quality_score', label: 'Quality', sortable: true, render: (r) => r.quality_score == null ? '—' : <span className={r.quality_score < 0.4 ? 'text-accent-amber' : 'text-zinc-200'}>{(r.quality_score * 100).toFixed(0)}%</span> },
  { key: 'sha256', label: 'SHA', render: (r) => <span className="font-mono text-xs text-zinc-500">{short(r.sha256, 10)}</span> },
  { key: 'created_at', label: 'Captured', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];

export default function DatasetsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const [lifecycle, setLifecycle] = useState(sp?.get('f.lifecycle') ?? '');
  const filters: Record<string, string> = lifecycle ? { lifecycle } : {};

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lifecycle</span>
        {LIFECYCLES.map((l) => (
          <button key={l || 'all'} onClick={() => setLifecycle(l)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${lifecycle === l ? 'bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40' : 'bg-white/[0.03] text-zinc-400 hover:text-white'}`}>
            {l ? l.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </div>
      <AiTable<Img>
        resource="images"
        columns={columns}
        defaultSort="created_at"
        initialFilters={filters}
        onRowClick={(r) => router.push(`/admin/ai-platform/datasets/${r.id}`)}
        emptyTitle="No dataset images yet"
        emptyBody="Images populate here as inspectors capture in the field and reviews sync through the HITL pipeline. Provenance (original AI prediction + inspector correction) is preserved on every record."
      />
    </div>
  );
}
