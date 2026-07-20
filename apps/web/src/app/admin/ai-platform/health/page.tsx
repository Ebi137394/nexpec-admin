'use client';
import { useAiOps, Card, SectionHeader, StatCard, AiTable, Loading, ErrorState, nf, type Column } from '@/components/admin/ai-platform/kit';

interface Overview { provisioned: boolean; totals: { images: number }; lifecycle: Record<string, number> }
interface QRow extends Record<string, unknown> { day: string; model_slug: string; avg_quality: number | null; low_quality_n: number }

const LIFE_TONE: Record<string, string> = { accepted: 'bg-accent-green', pending: 'bg-accent-amber', rejected: 'bg-accent-red', golden_sample: 'bg-violet', hard_example: 'bg-amber-500', training_candidate: 'bg-cyan-500' };

const qCols: Column<QRow>[] = [
  { key: 'day', label: 'Day', sortable: true, render: (r) => <span className="text-xs">{r.day}</span> },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'avg_quality', label: 'Avg quality', render: (r) => r.avg_quality == null ? '—' : `${(r.avg_quality * 100).toFixed(0)}%` },
  { key: 'low_quality_n', label: 'Low-quality', render: (r) => nf(r.low_quality_n) },
];

export default function DatasetHealthPage() {
  const { data, error, loading, reload } = useAiOps<Overview>('/api/ai-ops/overview');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const lc = data?.lifecycle ?? {};
  const total = Object.values(lc).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total samples" value={nf(data?.totals.images ?? 0)} />
        <StatCard label="Accepted" value={nf(lc['accepted'] ?? 0)} tone="green" />
        <StatCard label="Correction pool" value={nf((lc['hard_example'] ?? 0) + (lc['rejected'] ?? 0))} tone="amber" />
        <StatCard label="Training-ready" value={nf((lc['accepted'] ?? 0) + (lc['training_candidate'] ?? 0))} tone="violet" />
      </div>

      <Card>
        <SectionHeader title="Lifecycle distribution" subtitle="Balance across review states — a healthy dataset is not dominated by any one bucket." />
        {total === 0 ? (
          <p className="py-6 text-sm text-zinc-500">No samples yet. This chart fills in as captures and reviews flow through the pipeline.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(lc).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-xs capitalize text-zinc-400">{k.replace(/_/g, ' ')}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-950">
                  <div className={`h-full rounded-full ${LIFE_TONE[k] ?? 'bg-zinc-500'}`} style={{ width: `${Math.round((n / total) * 100)}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400">{nf(n)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div>
        <SectionHeader title="Image quality over time" subtitle="Daily quality rollups (blur/brightness/contrast/noise aggregated into a 0–100 score). Per-class correction and imbalance breakdowns populate here as labelled data grows." />
        <AiTable<QRow> resource="quality-stats" columns={qCols} defaultSort="day" searchable={false}
          emptyTitle="No quality statistics yet" emptyBody="Quality rollups are written nightly from captured image metrics." />
      </div>
    </div>
  );
}
