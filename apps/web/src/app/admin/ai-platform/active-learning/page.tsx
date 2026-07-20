'use client';
import { AiTable, nf, dt, type Column } from '@/components/admin/ai-platform/kit';

interface Score extends Record<string, unknown> {
  image_id: string; model_slug: string; priority: number | null; confidence: number | null;
  novelty: number | null; rarity: number | null; disagreement: number | null; correction_frequency: number | null; scored_at: string;
}

const bar = (v: number | null) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-950"><div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-glow" style={{ width: `${Math.round((v ?? 0) * 100)}%` }} /></div>
    <span className="text-xs tabular-nums text-zinc-400">{v == null ? '—' : (v * 100).toFixed(0)}</span>
  </div>
);

const columns: Column<Score>[] = [
  { key: 'priority', label: 'Priority', sortable: true, render: (r) => bar(r.priority) },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'confidence', label: 'Uncertainty', render: (r) => <span className="text-xs">{r.confidence == null ? '—' : `${((1 - r.confidence) * 100).toFixed(0)}% unsure`}</span> },
  { key: 'disagreement', label: 'Disagreement', render: (r) => <span className="text-xs">{r.disagreement == null ? '—' : `${(r.disagreement * 100).toFixed(0)}%`}</span> },
  { key: 'novelty', label: 'Novelty', render: (r) => <span className="text-xs">{r.novelty == null ? '—' : `${(r.novelty * 100).toFixed(0)}%`}</span> },
  { key: 'rarity', label: 'Rarity', render: (r) => <span className="text-xs">{r.rarity == null ? '—' : `${(r.rarity * 100).toFixed(0)}%`}</span> },
  { key: 'scored_at', label: 'Scored', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.scored_at)}</span> },
];

export default function ActiveLearningPage() {
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-400">Samples ranked by <span className="text-white">training value</span>. Priority is computed from real stored components — uncertainty (low confidence), model disagreement, embedding novelty, class rarity, and correction frequency — gated down by image quality so blurry frames never top the queue.</p>
      <AiTable<Score>
        resource="queue"
        columns={columns}
        defaultSort="priority"
        searchable={false}
        emptyTitle="Active-learning queue is empty"
        emptyBody="Scores populate as predictions and corrections accumulate. The highest-value samples for the next training cycle surface at the top."
      />
    </div>
  );
}
