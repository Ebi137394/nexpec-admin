'use client';
import { SectionHeader, AiTable, nf, type Column } from '@/components/admin/ai-platform/kit';

interface Inf extends Record<string, unknown> { day: string; model_slug: string; platform: string; runs: number; detections: number; mean_conf: number | null; p50_ms: number | null; p95_ms: number | null }
interface Sync extends Record<string, unknown> { day: string; platform: string; queued: number; synced: number; failed: number }

const infCols: Column<Inf>[] = [
  { key: 'day', label: 'Day', sortable: true, render: (r) => <span className="text-xs">{r.day}</span> },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'platform', label: 'Platform', render: (r) => <span className="text-xs">{r.platform}</span> },
  { key: 'runs', label: 'Runs', sortable: true, render: (r) => nf(r.runs) },
  { key: 'mean_conf', label: 'Avg conf', render: (r) => r.mean_conf == null ? '—' : `${(r.mean_conf * 100).toFixed(0)}%` },
  { key: 'p95_ms', label: 'p95 ms', render: (r) => r.p95_ms == null ? '—' : `${r.p95_ms}ms` },
];
const syncCols: Column<Sync>[] = [
  { key: 'day', label: 'Day', sortable: true, render: (r) => <span className="text-xs">{r.day}</span> },
  { key: 'platform', label: 'Platform', render: (r) => <span className="text-xs">{r.platform}</span> },
  { key: 'synced', label: 'Synced', render: (r) => <span className="text-accent-green">{nf(r.synced)}</span> },
  { key: 'queued', label: 'Queued', render: (r) => nf(r.queued) },
  { key: 'failed', label: 'Failed', render: (r) => <span className={r.failed > 0 ? 'text-accent-red' : ''}>{nf(r.failed)}</span> },
];

export default function MonitoringPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-400">Inference volume, confidence, latency and sync health over time. Compare across models and date ranges. All rollups are real — no simulated series.</p>
      <div>
        <SectionHeader title="Inference" subtitle="Per model / platform / day." />
        <AiTable<Inf> resource="inference-stats" columns={infCols} defaultSort="day" searchable={false}
          emptyTitle="No inference telemetry yet" emptyBody="Populated as the mobile and web co‑inspector record predictions to ai_prediction_history and the nightly rollup runs." />
      </div>
      <div>
        <SectionHeader title="Sync health" subtitle="Offline outbox → server reconciliation." />
        <AiTable<Sync> resource="sync-stats" columns={syncCols} defaultSort="day" searchable={false}
          emptyTitle="No sync telemetry yet" emptyBody="Populated from the offline outbox reconciliation counters." />
      </div>
    </div>
  );
}
