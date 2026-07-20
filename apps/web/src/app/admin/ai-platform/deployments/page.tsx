'use client';
import { AiTable, StatusBadge, dt, type Column } from '@/components/admin/ai-platform/kit';

interface Dep extends Record<string, unknown> {
  id: string; model_slug: string; version: number; action: string; environment: string; created_at: string;
}

const columns: Column<Dep>[] = [
  { key: 'model_slug', label: 'Model', render: (r) => <span className="font-mono text-xs">{r.model_slug}</span> },
  { key: 'version', label: 'Version', render: (r) => <span className="tabular-nums">v{r.version}</span> },
  { key: 'action', label: 'Action', render: (r) => <StatusBadge value={r.action} /> },
  { key: 'environment', label: 'Environment', render: (r) => <span className="text-xs">{r.environment}</span> },
  { key: 'created_at', label: 'When', sortable: true, render: (r) => <span className="text-xs text-zinc-500">{dt(r.created_at)}</span> },
];

export default function DeploymentsPage() {
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-400">Immutable deployment history per model version — registered, published, hosted, rolled back, retired. Rollback and activation are recorded through the audited backend (VersionService); this view never mutates deployment state through client‑only logic.</p>
      <AiTable<Dep>
        resource="deployments"
        columns={columns}
        defaultSort="created_at"
        searchable={false}
        emptyTitle="No deployments recorded yet"
        emptyBody="Deployment events are written when a model is registered/published via scripts/ml/register-nexpec-models.sh or promoted through the platform."
      />
    </div>
  );
}
