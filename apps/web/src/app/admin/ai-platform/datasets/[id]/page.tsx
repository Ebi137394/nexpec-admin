'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ImageOff } from 'lucide-react';
import { SegEditorOverlay, type SegEditDetection } from '@/components/inspector/SegEditorOverlay';
import { confirmDialog, alertDialog } from '@/components/ui/AppDialog';
import { LIFECYCLE_TRANSITIONS, type ImageLifecycle } from '@nexpec/shared-core';
import { useAiOps, Card, SectionHeader, StatusBadge, Loading, ErrorState, dt, pct } from '@/components/admin/ai-platform/kit';

interface SampleDetail {
  image: Record<string, unknown> & { id: string; lifecycle: ImageLifecycle; model_slug: string | null; sha256: string | null; source: string; created_at: string; storage_provider: string; storage_path: string };
  imageUrl: string | null;
  ai: SegEditDetection[];
  corrected: SegEditDetection[];
  quality: Record<string, number | null>;
  lifecycle: ImageLifecycle;
  history: Array<{ id: number; action: string; created_at: string }>;
}

function Canvas({ imageUrl, detections, label }: { imageUrl: string | null; detections: SegEditDetection[]; label: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">{label}</p>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/[0.08] bg-ink-950">
        {imageUrl ? (
          <>
            <img src={imageUrl} alt={label} className="absolute inset-0 h-full w-full object-contain" />
            <SegEditorOverlay imageUrl={imageUrl} detections={detections} fitMode="contain" />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600"><ImageOff size={22} /></div>
        )}
      </div>
    </div>
  );
}

export default function SampleReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useAiOps<SampleDetail>(`/api/ai-ops/images/${id}`);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const nexts = (LIFECYCLE_TRANSITIONS[data.lifecycle] ?? []).filter((s) => s !== 'deleted');
  const transition = async (to: ImageLifecycle) => {
    const destructive = to === 'archived' || to === 'rejected';
    if (!(await confirmDialog({ title: `Move to “${to.replace(/_/g, ' ')}”?`, body: `This changes the sample's lifecycle state${destructive ? ' and removes it from active curation' : ''}. The database enforces legal transitions and records an audit entry.`, tone: destructive ? 'danger' : 'default', confirmText: 'Apply' }))) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/ai-ops/images/${id}/lifecycle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      reload();
    } catch (e) {
      await alertDialog({ title: 'Could not update', body: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <Link href="/admin/ai-platform/datasets" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ChevronLeft size={15} /> Dataset manager</Link>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <SectionHeader title="Prediction vs correction" subtitle="The original AI output and the inspector's correction are shown separately — provenance is never overwritten." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Canvas imageUrl={data.imageUrl} detections={data.ai} label={`AI prediction · ${data.ai.length} region(s)`} />
              <Canvas imageUrl={data.imageUrl} detections={data.corrected} label={`Inspector correction · ${data.corrected.length} region(s)`} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <SectionHeader title="Lifecycle" />
              <StatusBadge value={data.lifecycle} />
            </div>
            {nexts.length === 0 ? <p className="text-sm text-zinc-500">No further transitions from this state.</p> : (
              <div className="flex flex-wrap gap-2">
                {nexts.map((s) => (
                  <button key={s} disabled={busy} onClick={() => transition(s)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-violet/40 hover:text-white disabled:opacity-50">
                    → {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeader title="Metadata" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Kv k="Model" v={data.image.model_slug ?? '—'} />
              <Kv k="Source" v={data.image.source} />
              <Kv k="Storage" v={data.image.storage_provider} />
              <Kv k="Captured" v={dt(data.image.created_at)} />
              <Kv k="SHA" v={<span className="font-mono text-xs">{data.image.sha256 ? String(data.image.sha256).slice(0, 12) + '…' : '—'}</span>} />
            </dl>
          </Card>

          <Card>
            <SectionHeader title="Image quality" />
            <div className="space-y-1.5">
              {(['quality_score', 'blur_score', 'brightness', 'contrast', 'noise_score', 'resolution_score'] as const).map((k) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">{k.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums text-zinc-200">{data.quality[k] == null ? '—' : pct(data.quality[k])}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <SectionHeader title="Audit timeline" subtitle="Immutable — every change to this sample." />
        {data.history.length === 0 ? <p className="text-sm text-zinc-500">No audit events recorded for this sample yet.</p> : (
          <ul className="space-y-1.5">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-sm">
                <span className="font-mono text-xs text-violet-glow">{h.action}</span>
                <span className="text-xs text-zinc-500">{dt(h.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt><dd className="mt-0.5 text-zinc-200">{v}</dd></div>;
}
