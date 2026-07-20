'use client';
import { AiTable, StatusBadge, dt, type Column } from '@/components/admin/ai-platform/kit';

interface Hard extends Record<string, unknown> { image_id: string; model_slug: string; reason: string; flagged_at: string }

const columns: Column<Hard>[] = [
  { key: 'reason', label: 'Failure type', render: (r) => <StatusBadge value={r.reason} /> },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'image_id', label: 'Image', render: (r) => <span className="font-mono text-xs text-zinc-500">{String(r.image_id).slice(0, 8)}…</span> },
  { key: 'flagged_at', label: 'Flagged', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.flagged_at)}</span> },
];

export default function HardExamplesPage() {
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-400">Samples where the model failed — false positives, false negatives, low confidence, or cross‑model disagreement — grouped by model and failure type. Each carries the reason it was flagged. Approve for training or promote to a golden set from the sample detail view.</p>
      <AiTable<Hard>
        resource="hard-examples"
        columns={columns}
        defaultSort="flagged_at"
        searchable={false}
        emptyTitle="No hard examples flagged"
        emptyBody="Hard examples are captured automatically when inspectors correct or reject an AI finding, and manually from the sample review screen."
      />
    </div>
  );
}
