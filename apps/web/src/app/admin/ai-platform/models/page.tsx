'use client';
import Link from 'next/link';
import { useAiOps, Card, StatusBadge, Loading, ErrorState, nf, dt, short } from '@/components/admin/ai-platform/kit';

interface ModelRow {
  slug: string; version: number; displayName: string; task: string; sha256: string;
  inputSize: number; classCount: number; enabled: boolean; parser: string;
  inferences: number; lastDeployment: string | null;
}

export default function ModelsPage() {
  const { data, error, loading, reload } = useAiOps<{ rows: ModelRow[] }>('/api/ai-ops/models');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const rows = data?.rows ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((m) => (
        <Link key={m.slug} href={`/admin/ai-platform/models/${m.slug}`} className="block">
        <Card className="hover:border-violet/30">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-display text-base font-semibold text-white">{m.displayName}</h3>
                <StatusBadge value={m.enabled ? 'connected' : 'unconfigured'} />
              </div>
              <p className="mt-0.5 font-mono text-xs text-zinc-500">{m.slug} · v{m.version}</p>
            </div>
            <span className="shrink-0 rounded-full bg-violet/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-glow">{m.task === 'detection' ? 'Detection' : 'Segmentation'}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Kv k="Input size" v={`${m.inputSize}²`} />
            <Kv k="Classes" v={nf(m.classCount)} />
            <Kv k="Decoder" v={m.parser} />
            <Kv k="Inferences" v={nf(m.inferences)} />
            <Kv k="Last deployment" v={dt(m.lastDeployment)} />
            <Kv k="SHA‑256" v={<span className="font-mono" title={m.sha256}>{short(m.sha256, 12)}</span>} />
          </dl>
          <div className="mt-4 flex items-center gap-4 text-[11px] text-zinc-500">
            <span title="Bundled into the mobile app via Metro">📱 Mobile: bundled</span>
            <span title="Served same-origin under /models, SHA-verified on load">🖥️ Web: hosted</span>
          </div>
        </Card>
        </Link>
      ))}
      <p className="col-span-full text-[11px] text-zinc-600">
        Identity (slug / version / SHA‑256 / labels / decoder) is the shared registry — the single source of truth for web + mobile. Runtime rollups populate as inferences are recorded.
      </p>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
      <dd className="mt-0.5 text-zinc-200">{v}</dd>
    </div>
  );
}
