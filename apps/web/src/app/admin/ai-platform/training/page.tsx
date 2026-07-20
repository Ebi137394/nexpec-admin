'use client';
import { useAiOps, SectionHeader, StatCard, AiTable, StatusBadge, Loading, ErrorState, nf, dt, type Column } from '@/components/admin/ai-platform/kit';

interface Overview { lifecycle: Record<string, number>; totals: { datasetVersions: number; trainingRuns: number } }
interface Ver extends Record<string, unknown> { id: string; name: string; semver: string; model_slug: string | null; frozen: boolean; image_count: number; created_at: string }
interface Run extends Record<string, unknown> { id: string; model_slug: string; status: string; environment: string; target_version: number | null; created_at: string }

const verCols: Column<Ver>[] = [
  { key: 'name', label: 'Version', sortable: true, render: (r) => <span className="font-semibold text-white">{r.name} <span className="font-mono text-xs text-zinc-500">{r.semver}</span></span> },
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug ?? '—'}</span> },
  { key: 'image_count', label: 'Images', render: (r) => nf(r.image_count) },
  { key: 'frozen', label: 'State', render: (r) => <StatusBadge value={r.frozen ? 'completed' : 'draft'} /> },
  { key: 'created_at', label: 'Created', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];
const runCols: Column<Run>[] = [
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  { key: 'environment', label: 'Env', render: (r) => <span className="text-xs">{r.environment}</span> },
  { key: 'target_version', label: 'Target', render: (r) => r.target_version ? `v${r.target_version}` : '—' },
  { key: 'created_at', label: 'Created', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];

export default function TrainingPage() {
  const { data, error, loading, reload } = useAiOps<Overview>('/api/ai-ops/overview');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const lc = data?.lifecycle ?? {};

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-400">Training <span className="text-white">preparation</span> — dataset versioning, candidate curation, export packaging, and records of externally‑run training. This is not a cloud‑training launcher: NEXPEC has no remote executor, so no page here claims to train a model. Packages are generated for training in Colab/GPU, and the resulting model version is attached back here.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Training candidates" value={nf(lc['training_candidate'] ?? 0)} tone="violet" />
        <StatCard label="Accepted samples" value={nf(lc['accepted'] ?? 0)} tone="green" />
        <StatCard label="Dataset versions" value={nf(data?.totals.datasetVersions ?? 0)} />
        <StatCard label="Training runs" value={nf(data?.totals.trainingRuns ?? 0)} />
      </div>

      <div>
        <SectionHeader title="Dataset versions" subtitle="Freeze a version to make its membership immutable, then export a training package." />
        <AiTable<Ver> resource="dataset-versions" columns={verCols} defaultSort="created_at"
          emptyTitle="No dataset versions" emptyBody="Create a dataset version to snapshot the current training‑ready set, then freeze it before export." />
      </div>
      <div>
        <SectionHeader title="Training runs" subtitle="Records of training executed externally, with metrics and the resulting artifact SHA." />
        <AiTable<Run> resource="training-runs" columns={runCols} defaultSort="created_at" searchable={false}
          emptyTitle="No training runs recorded" emptyBody="Record a run when you train a new model version externally; attach its exported .tflite SHA to link it to the registry." />
      </div>
    </div>
  );
}
