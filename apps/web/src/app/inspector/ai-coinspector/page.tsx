'use client';
// /inspector/ai-coinspector — office-side AI Co-inspector.
//
// Sleek capture studio (drag-and-drop high-res / drone photos + webcam) for
// visual review, paired with the LIVE AI findings the NEXPEC vision pipeline
// produced for the selected job (ai_detections). Accepting a finding calls the
// exact same provable-AI recorder the Expo app uses (pi_record_ai_detection,
// p_accepted=true) — the detection stays cryptographically bound to its signed model.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScanEye, UploadCloud, Camera, X, ShieldCheck, CheckCircle2, AlertCircle,
  Sparkles, ImageOff, Loader2, Cpu,
} from 'lucide-react';
import {
  fetchInspectorJobs, fetchJobDetections, acceptDetection, analyzeImage,
  type InspectorJobLite, type AiDetection,
} from '@/lib/data/aiCoinspector';

interface Staged { id: string; url: string; name: string; size: number }

// Downscale to a sane inference resolution (longest side) before sending — the
// inspector keeps the full-res photo for review; the model only needs ~1280px.
async function downscale(url: string, max = 1280): Promise<{ base64: string; mime: string }> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
  const w = Math.max(1, Math.round((img.width || max) * scale));
  const h = Math.max(1, Math.round((img.height || max) * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')?.drawImage(img, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/jpeg', 0.9);
  return { base64: dataUrl.split(',')[1] ?? '', mime: 'image/jpeg' };
}

const sevCls = (s: string | null): string => {
  const v = (s ?? '').toLowerCase();
  if (v.includes('crit') || v.includes('high')) return 'bg-accent-red/15 text-accent-red';
  if (v.includes('med') || v.includes('mod')) return 'bg-accent-amber/15 text-accent-amber';
  if (v.includes('low') || v.includes('minor')) return 'bg-accent-green/15 text-accent-green';
  return 'bg-white/10 text-zinc-300';
};

export default function AiCoinspectorPage() {
  const [jobs, setJobs] = useState<InspectorJobLite[]>([]);
  const [jobId, setJobId] = useState('');
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dets, setDets] = useState<AiDetection[]>([]);
  const [detLoading, setDetLoading] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { fetchInspectorJobs().then(setJobs).catch(() => {}); }, []);

  const loadDets = useCallback((id: string) => {
    if (!id) { setDets([]); return; }
    setDetLoading(true);
    fetchJobDetections(id).then(setDets).catch(() => setDets([])).finally(() => setDetLoading(false));
  }, []);
  useEffect(() => { loadDets(jobId); }, [jobId, loadDets]);

  // ── Staging (drag-drop + file picker + webcam) ──
  const addFiles = useCallback((files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setStaged((prev) => [
      ...prev,
      ...imgs.map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`, url: URL.createObjectURL(f), name: f.name, size: f.size })),
    ]);
  }, []);
  const removeStaged = (id: string) => setStaged((prev) => {
    const t = prev.find((x) => x.id === id); if (t) URL.revokeObjectURL(t.url);
    return prev.filter((x) => x.id !== id);
  });
  useEffect(() => () => { staged.forEach((s) => URL.revokeObjectURL(s.url)); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 3840 } } });
      streamRef.current = stream; setCamOn(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } });
    } catch { setMsg({ kind: 'err', text: 'Camera unavailable or permission denied.' }); }
  };
  const stopCam = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCamOn(false); };
  const capture = () => {
    const v = videoRef.current; if (!v) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => { if (b) addFiles([new File([b], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })]); }, 'image/jpeg', 0.95);
  };

  const onAccept = async (d: AiDetection) => {
    setAccepting(d.id); setMsg(null);
    try {
      const res = await acceptDetection(d);
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Could not record finding.' }); return; }
      setMsg({ kind: 'ok', text: `Recorded "${d.label}" as a finding — provably bound to ${d.model_slug} v${d.model_version}.` });
      loadDets(jobId);
    } finally { setAccepting(null); }
  };

  const analyzeOne = async (s: Staged) => {
    if (!jobId) { setMsg({ kind: 'err', text: 'Select a job above first.' }); return; }
    setAnalyzingId(s.id); setMsg(null);
    try {
      const { base64, mime } = await downscale(s.url);
      const res = await analyzeImage(jobId, base64, mime);
      if (!res.ok) { setMsg({ kind: 'err', text: res.detail || 'Analysis failed.' }); return; }
      setMsg({ kind: 'ok', text: `AI recorded ${res.recorded ?? 0} finding${res.recorded === 1 ? '' : 's'}.` });
      loadDets(jobId);
    } catch { setMsg({ kind: 'err', text: 'Could not process the image.' }); }
    finally { setAnalyzingId(null); }
  };
  const analyzeAll = async () => {
    if (!jobId) { setMsg({ kind: 'err', text: 'Select a job above first.' }); return; }
    setAnalyzingAll(true); setMsg(null);
    let total = 0; let err: string | null = null;
    try {
      for (const s of staged) {
        const { base64, mime } = await downscale(s.url);
        const res = await analyzeImage(jobId, base64, mime);
        if (!res.ok) { err = res.detail || 'Analysis failed.'; break; }
        total += res.recorded ?? 0;
      }
      setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: `AI recorded ${total} finding${total === 1 ? '' : 's'} across ${staged.length} photo${staged.length === 1 ? '' : 's'}.` });
      loadDets(jobId);
    } finally { setAnalyzingAll(false); }
  };

  const pending = useMemo(() => dets.filter((d) => !d.accepted_by_human), [dets]);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow"><ScanEye size={22} /></span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">Inspector · Vision</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">AI Co-inspector</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">Stage high-res or drone imagery for review, and accept the AI detections NEXPEC&rsquo;s vision pipeline produced for a job — each one cryptographically sealed to its signed model.</p>
        </div>
      </header>

      {/* Job picker */}
      <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="text-sm font-semibold text-white">Job context</label>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet sm:w-96">
          <option value="">Select an assigned job…</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </div>

      {msg && (
        <p className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-accent-green/30 bg-accent-green/10 text-accent-green' : 'border-accent-red/30 bg-accent-red/10 text-accent-red'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {msg.text}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Capture studio ── */}
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold text-white"><Camera size={16} className="text-violet-glow" /> Capture studio</h2>

          {camOn ? (
            <div className="overflow-hidden rounded-2xl border border-violet/40 bg-black">
              <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
              <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-ink-950 p-3">
                <button onClick={capture} className="inline-flex items-center gap-2 rounded-full bg-violet px-4 py-2 text-sm font-bold text-white hover:bg-violet-deep"><Camera size={15} /> Capture frame</button>
                <button onClick={stopCam} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-sm font-semibold text-zinc-300 hover:text-white"><X size={14} /> Stop</button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition ${dragOver ? 'border-violet bg-violet/[0.08]' : 'border-white/[0.12] bg-white/[0.02] hover:border-violet/50'}`}
            >
              <UploadCloud size={30} className="text-violet-glow" />
              <p className="text-sm font-semibold text-white">Drag &amp; drop photos here</p>
              <p className="text-xs text-zinc-500">High-res industrial or drone imagery · or click to browse</p>
              <button onClick={(e) => { e.stopPropagation(); startCam(); }} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-violet/40 hover:text-white"><Camera size={13} /> Use webcam</button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          )}

          {staged.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={analyzeAll} disabled={!jobId || analyzingAll}
                  className="inline-flex items-center gap-2 rounded-full bg-violet px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-deep disabled:opacity-60">
                  {analyzingAll ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {analyzingAll ? 'Analysing…' : `Analyse ${staged.length} with AI`}
                </button>
                {!jobId && <span className="text-[11px] text-accent-amber">Select a job above to run analysis.</span>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {staged.map((s) => (
                  <div key={s.id} className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-ink-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.name} className="aspect-square w-full object-cover" />
                    <button onClick={() => removeStaged(s.id)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"><X size={13} /></button>
                    <button onClick={() => analyzeOne(s)} disabled={!jobId || analyzingId === s.id}
                      className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded-md bg-violet/90 py-1 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-60">
                      {analyzingId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Analyse
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-600"><Cpu size={12} /> Dropped photos are analysed by NEXPEC&rsquo;s secured in-house vision worker; recorded findings appear under AI findings →</p>
        </section>

        {/* ── AI findings ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-white"><Sparkles size={16} className="text-violet-glow" /> AI findings</h2>
            {jobId && <span className="text-xs text-zinc-500">{pending.length} to review</span>}
          </div>

          {!jobId ? (
            <Empty icon={<ScanEye size={22} className="text-violet-glow" />} title="Select a job" body="Choose an assigned job to load the AI detections produced for it." />
          ) : detLoading ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
          ) : dets.length === 0 ? (
            <Empty icon={<ImageOff size={22} className="text-zinc-500" />} title="No detections yet" body="The vision worker hasn't recorded detections for this job. They'll appear here once field captures are analysed." />
          ) : (
            <ul className="space-y-3">
              {dets.map((d) => (
                <li key={d.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">{d.label}</p>
                        {d.severity && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-industrial ${sevCls(d.severity)}`}>{d.severity}</span>}
                      </div>
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500"><ShieldCheck size={11} className="text-accent-green" /> {d.model_slug} v{d.model_version}{d.model_sha256 ? ` · ${d.model_sha256.slice(0, 8)}…` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg font-semibold text-white">{Math.round(d.confidence * 100)}%</p>
                      <p className="text-[10px] text-zinc-500">confidence</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-950"><div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-glow" style={{ width: `${Math.round(d.confidence * 100)}%` }} /></div>
                  <div className="mt-3 flex items-center justify-between">
                    {d.standard_refs && d.standard_refs.length > 0 && <p className="truncate text-[11px] text-zinc-500">{d.standard_refs.join(' · ')}</p>}
                    {d.accepted_by_human ? (
                      <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-accent-green"><CheckCircle2 size={15} /> Accepted</span>
                    ) : (
                      <button onClick={() => onAccept(d)} disabled={accepting === d.id} className="ml-auto inline-flex items-center gap-2 rounded-full bg-violet px-4 py-1.5 text-xs font-bold text-white transition hover:bg-violet-deep disabled:opacity-60">
                        {accepting === d.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Accept as finding
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">{icon}</div>
      <p className="mt-3 text-sm font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500">{body}</p>
    </div>
  );
}
