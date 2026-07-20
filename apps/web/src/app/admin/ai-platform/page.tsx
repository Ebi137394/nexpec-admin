'use client';
import Link from 'next/link';
import { AlertTriangle, Info, XCircle, ArrowRight } from 'lucide-react';
import { useAiOps, StatCard, Card, SectionHeader, Loading, ErrorState, dt, dOnly, nf } from '@/components/admin/ai-platform/kit';

interface Overview {
  provisioned: boolean;
  models: { total: number; enabled: number; tasks: Record<string, number> };
  lifecycle: Record<string, number>;
  totals: { images: number; hardExamples: number; goldenDatasets: number; queue: number; trainingRuns: number; datasetVersions: number; exports: number; snapshots: number };
  latest: { snapshot: Record<string, unknown> | null; export: Record<string, unknown> | null; deployment: Record<string, unknown> | null };
  storage: { defaultProvider: string | null; providers: number };
  alerts: Array<{ level: 'info' | 'warn' | 'error'; code: string; message: string; href: string }>;
  generatedAt: string;
}
const B = '/admin/ai-platform';

export default function AiOverviewPage() {
  const { data, error, loading, reload } = useAiOps<Overview>('/api/ai-ops/overview');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const lc = data.lifecycle;

  return (
    <div className="space-y-6">
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((a) => {
            const Icon = a.level === 'error' ? XCircle : a.level === 'warn' ? AlertTriangle : Info;
            const cls = a.level === 'error' ? 'border-accent-red/30 bg-accent-red/[0.06] text-accent-red'
              : a.level === 'warn' ? 'border-accent-amber/30 bg-accent-amber/[0.06] text-accent-amber'
              : 'border-white/10 bg-white/[0.02] text-zinc-300';
            return (
              <Link key={a.code} href={a.href} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${cls}`}>
                <span className="inline-flex items-center gap-2"><Icon size={15} /> {a.message}</span>
                <ArrowRight size={14} className="opacity-70" />
              </Link>
            );
          })}
        </div>
      )}

      <div>
        <SectionHeader title="Models" subtitle={`${data.models.enabled} enabled of ${data.models.total} registered · ${Object.entries(data.models.tasks).map(([t, n]) => `${n} ${t}`).join(' · ')}`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Registered models" value={nf(data.models.total)} tone="violet" href={`${B}/models`} />
          <StatCard label="Enabled" value={nf(data.models.enabled)} tone="green" href={`${B}/models`} />
          <StatCard label="Dataset versions" value={nf(data.totals.datasetVersions)} href={`${B}/training`} />
          <StatCard label="Training runs" value={nf(data.totals.trainingRuns)} href={`${B}/training`} />
        </div>
      </div>

      <div>
        <SectionHeader title="Dataset lifecycle" subtitle="Every captured sample has a lifecycle state." action={<Link href={`${B}/datasets`} className="text-xs font-semibold text-violet-glow hover:text-white">Open dataset manager →</Link>} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total images" value={nf(data.totals.images)} href={`${B}/datasets`} />
          <StatCard label="Pending review" value={nf(lc['pending'] ?? 0)} tone="amber" href={`${B}/datasets?f.lifecycle=pending`} />
          <StatCard label="Accepted" value={nf(lc['accepted'] ?? 0)} tone="green" href={`${B}/datasets?f.lifecycle=accepted`} />
          <StatCard label="Rejected" value={nf(lc['rejected'] ?? 0)} tone="red" href={`${B}/datasets?f.lifecycle=rejected`} />
          <StatCard label="Training candidates" value={nf(lc['training_candidate'] ?? 0)} href={`${B}/training`} />
          <StatCard label="Golden samples" value={nf(lc['golden_sample'] ?? 0)} tone="violet" href={`${B}/golden`} />
        </div>
      </div>

      <div>
        <SectionHeader title="Continuous learning & storage" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active-learning queue" value={nf(data.totals.queue)} tone="violet" href={`${B}/active-learning`} />
          <StatCard label="Hard examples" value={nf(data.totals.hardExamples)} tone="amber" href={`${B}/hard-examples`} />
          <StatCard label="Golden datasets" value={nf(data.totals.goldenDatasets)} href={`${B}/golden`} />
          <StatCard label="Storage provider" value={data.storage.defaultProvider ?? '—'} sub={`${data.storage.providers} configured`} href={`${B}/storage`} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">Last monthly snapshot</p>
          <p className="mt-1 text-sm text-white">{data.latest.snapshot ? dOnly(String((data.latest.snapshot as { month?: string }).month)) : 'None yet'}</p>
          <Link href={`${B}/snapshots`} className="mt-2 inline-block text-xs font-semibold text-violet-glow hover:text-white">Snapshots →</Link>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">Last export</p>
          <p className="mt-1 text-sm text-white">{data.latest.export ? dt(String((data.latest.export as { created_at?: string }).created_at)) : 'None yet'}</p>
          <Link href={`${B}/exports`} className="mt-2 inline-block text-xs font-semibold text-violet-glow hover:text-white">Export center →</Link>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">Last deployment</p>
          <p className="mt-1 text-sm text-white">{data.latest.deployment ? dt(String((data.latest.deployment as { created_at?: string }).created_at)) : 'None yet'}</p>
          <Link href={`${B}/deployments`} className="mt-2 inline-block text-xs font-semibold text-violet-glow hover:text-white">Deployments →</Link>
        </Card>
      </div>
      <p className="text-[11px] text-zinc-600">Live data · generated {dt(data.generatedAt)}.</p>
    </div>
  );
}
