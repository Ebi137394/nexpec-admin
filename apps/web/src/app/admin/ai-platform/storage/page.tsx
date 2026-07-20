'use client';
import { HardDrive, Cloud } from 'lucide-react';
import { useAiOps, Card, StatusBadge, Loading, ErrorState, nf } from '@/components/admin/ai-platform/kit';

interface Provider { key: string; display_name: string; kind: string; enabled: boolean; is_default: boolean; config: Record<string, unknown> }
interface Quota { provider_key: string; used_bytes: number; quota_bytes: number | null; object_count: number }

const gb = (b: number | null | undefined) => (b == null ? '—' : `${(b / 1e9).toFixed(1)} GB`);

export default function StoragePage() {
  const { data, error, loading, reload } = useAiOps<{ providers: Provider[]; quotas: Quota[] }>('/api/ai-ops/storage');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const providers = data?.providers ?? [];
  const quotas = new Map((data?.quotas ?? []).map((q) => [q.provider_key, q]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">Dataset bytes are stored behind a provider‑switchable abstraction. Only the default provider is operational; others are shown truthfully as <span className="text-white">unconfigured</span> until a credentialed worker is wired. Secrets are never displayed.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => {
          const q = quotas.get(p.key);
          const status = p.is_default && p.enabled ? 'connected' : p.enabled ? 'configured' : 'unconfigured';
          return (
            <Card key={p.key} className={p.is_default ? 'border-violet/30' : ''}>
              <div className="flex items-start justify-between">
                <div className="inline-flex items-center gap-2">
                  {p.kind === 'supabase' ? <HardDrive size={16} className="text-violet-glow" /> : <Cloud size={16} className="text-zinc-400" />}
                  <div>
                    <p className="font-semibold text-white">{p.display_name}</p>
                    <p className="font-mono text-[11px] text-zinc-500">{p.kind}{p.is_default ? ' · default' : ''}</p>
                  </div>
                </div>
                <StatusBadge value={status} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-[11px] uppercase text-zinc-500">Used</dt><dd className="text-zinc-200">{gb(q?.used_bytes)}</dd></div>
                <div><dt className="text-[11px] uppercase text-zinc-500">Quota</dt><dd className="text-zinc-200">{gb(q?.quota_bytes)}</dd></div>
                <div><dt className="text-[11px] uppercase text-zinc-500">Objects</dt><dd className="text-zinc-200">{nf(q?.object_count ?? 0)}</dd></div>
              </dl>
              {status === 'unconfigured' && <p className="mt-3 text-xs text-zinc-500">Add a credentialed signing worker (see scripts/ops/ai-model-env.md) to enable {p.display_name}. No secrets are stored in the browser.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
