'use client';
import { useEffect, useState } from 'react';
import { useAiOps, Card, SectionHeader, StatusBadge, Loading, ErrorState, nf, dt } from '@/components/admin/ai-platform/kit';

interface ModelRow { slug: string; displayName: string }
interface Compare {
  view: string; model: string;
  runs: Array<{ target_version: number | null; status: string; metrics: Record<string, unknown> }>;
  deployments: Array<{ version: number; action: string; created_at: string }>;
}

export default function StatisticsPage() {
  const models = useAiOps<{ rows: ModelRow[] }>('/api/ai-ops/models');
  const [slug, setSlug] = useState<string>('');
  useEffect(() => { if (!slug && models.data?.rows?.[0]) setSlug(models.data.rows[0].slug); }, [models.data, slug]);
  const cmp = useAiOps<Compare>(slug ? `/api/ai-ops/statistics?view=compare&model=${encodeURIComponent(slug)}` : null);

  if (models.loading && !models.data) return <Loading />;
  if (models.error) return <ErrorState error={models.error} onRetry={models.reload} />;
  const rows = models.data?.rows ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-white">Compare model</label>
        <select value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-violet">
          {rows.map((m) => <option key={m.slug} value={m.slug}>{m.displayName}</option>)}
        </select>
      </div>

      {cmp.error ? <ErrorState error={cmp.error} onRetry={cmp.reload} /> : cmp.loading && !cmp.data ? <Loading /> : cmp.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <SectionHeader title="Deployment lineage" subtitle="Version history for this model." />
            {cmp.data.deployments.length === 0 ? <p className="text-sm text-zinc-500">No deployments recorded for this model yet.</p> : (
              <ul className="space-y-2">
                {cmp.data.deployments.map((d, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-sm">
                    <span className="tabular-nums text-white">v{d.version}</span>
                    <StatusBadge value={d.action} />
                    <span className="text-xs text-zinc-500">{dt(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <SectionHeader title="Training runs" subtitle="Externally-executed runs targeting this model." />
            {cmp.data.runs.length === 0 ? <p className="text-sm text-zinc-500">No training runs recorded for this model yet.</p> : (
              <ul className="space-y-2">
                {cmp.data.runs.map((r, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-sm">
                    <span className="text-white">{r.target_version ? `→ v${r.target_version}` : 'run'}</span>
                    <StatusBadge value={r.status} />
                    <span className="text-xs text-zinc-500">{Object.keys(r.metrics ?? {}).length ? `${nf(Object.keys(r.metrics).length)} metrics` : 'no metrics'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <p className="text-[11px] text-zinc-600">Comparison dimensions (version / dataset / project / inspector / class / month) draw from the same rollup tables; each populates as its data accrues.</p>
    </div>
  );
}
