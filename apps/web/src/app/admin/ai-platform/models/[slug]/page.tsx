'use client';
import { use } from 'react';
import Link from 'next/link';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { useAiOps, Card, SectionHeader, StatusBadge, Loading, ErrorState, dt } from '@/components/admin/ai-platform/kit';

interface VersionHistory {
  slug: string;
  current: { version: number; sha256: string; enabled: boolean } | null;
  deployments: Array<{ version: number; action: string; environment: string; created_at: string }>;
  rollbacks: Array<{ from_version: number; to_version: number; reason: string; created_at: string }>;
}

export default function ModelDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, loading, reload } = useAiOps<VersionHistory>(`/api/ai-ops/versions/${encodeURIComponent(slug)}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="space-y-5">
      <Link href="/admin/ai-platform/models" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ChevronLeft size={15} /> All models</Link>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">{slug}</h2>
            <p className="mt-0.5 font-mono text-xs text-zinc-500">{data?.current ? `v${data.current.version}` : 'not in registry'}</p>
          </div>
          {data?.current && <StatusBadge value={data.current.enabled ? 'connected' : 'unconfigured'} />}
        </div>
        {data?.current && (
          <p className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-zinc-500"><ShieldCheck size={12} className="text-accent-green" /> {data.current.sha256}</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Deployment history" />
          {(data?.deployments.length ?? 0) === 0 ? <p className="text-sm text-zinc-500">No deployments recorded yet.</p> : (
            <ul className="space-y-2">
              {data!.deployments.map((d, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-sm">
                  <span className="tabular-nums text-white">v{d.version}</span>
                  <StatusBadge value={d.action} />
                  <span className="text-xs text-zinc-500">{d.environment} · {dt(d.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionHeader title="Rollback history" />
          {(data?.rollbacks.length ?? 0) === 0 ? <p className="text-sm text-zinc-500">No rollbacks — this model has never been reverted.</p> : (
            <ul className="space-y-2">
              {data!.rollbacks.map((r, i) => (
                <li key={i} className="rounded-lg border border-accent-amber/20 bg-accent-amber/[0.04] px-3 py-2 text-sm">
                  <span className="text-white">v{r.from_version} → v{r.to_version}</span>
                  <p className="mt-0.5 text-xs text-zinc-400">{r.reason} · {dt(r.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="text-[11px] text-zinc-600">Classes, dataset versions, inference/quality statistics and export history join in here as each accrues data; identity (SHA/version/labels) is the shared registry.</p>
    </div>
  );
}
