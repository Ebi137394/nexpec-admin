'use client';
// /inspector/ai-coinspector — office-side AI Co-inspector with $0 CLIENT-SIDE
// inference. Mirrors the Expo app's on-device model: the browser downloads the
// vision model (TensorFlow.js) and runs inference locally on CPU/WebGL. No
// backend, no GPU worker. Accepted findings record via pi_record_ai_detection,
// provably bound to the active signed model — identical to the mobile contract.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScanEye, UploadCloud, Camera, X, ShieldCheck, CheckCircle2, AlertCircle,
  Sparkles, ImageOff, Loader2, Cpu, Wand2,
} from 'lucide-react';
import {
  fetchInspectorJobs, fetchJobDetections, recordDetection, fetchVisionModelRef,
  recordSegFeedback,
  type InspectorJobLite, type AiDetection, type VisionModelRef,
} from '@/lib/data/aiCoinspector';
import { segment, loadModel } from '@/lib/ai/visionModel';
import { isCorrosionDefectClass, corrosionLabelFor } from '@nexpec/shared-core';
import { SegEditorOverlay, type SegEditDetection } from '@/components/inspector/SegEditorOverlay';

interface Staged { id: string; url: string; name: string }
interface Suggestion {
  id: string; stagedId: string; thumbUrl: string;
  classId: number; defectId: string; label: string; confidence: number;
  box: [number, number, number, number]; polygon: Array<[number, number]>;
}
type ModelStatus = 'checking' | 'unconfigured' | 'ready' | 'error';

const imgFromUrl = (url: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image load failed')); i.src = url;
});
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [modelRef, setModelRef] = useState<VisionModelRef | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('checking');
  const [modelError, setModelError] = useState<string | null>(null);
  // Seg polygons per staged image (empty for classifier models → overlay is inert).
  const [segByStaged, setSegByStaged] = useState<Record<string, SegEditDetection[]>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { fetchInspectorJobs().then(setJobs).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    fetchVisionModelRef()
      .then((ref) => {
        if (!alive) return;
        if (!ref) { setModelStatus('unconfigured'); return; }
        setModelRef(ref); setModelStatus('checking');
        // Warm + SHA-verify before declaring ready. A mismatch/404 surfaces as
        // an actionable configuration error (never silently "ready").
        loadModel(ref.url, ref.sha256)
          .then(() => { if (alive) setModelStatus('ready'); })
          .catch((e) => {
            if (!alive) return;
            setModelError(e instanceof Error ? e.message : 'model load failed');
            setModelStatus('error');
          });
      })
      .catch(() => { if (alive) setModelStatus('error'); });
    return () => { alive = false; };
  }, []);

  const loadDets = useCallback((id: string) => {
    if (!id) { setDets([]); return; }
    setDetLoading(true);
    fetchJobDetections(id).then(setDets).catch(() => setDets([])).finally(() => setDetLoading(false));
  }, []);
  useEffect(() => { loadDets(jobId); }, [jobId, loadDets]);

  // ── Staging ──
  const addFiles = useCallback((files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setStaged((prev) => [...prev, ...imgs.map((f) => ({ id: `${f.name}-${Date.now()}-${Math.random()}`, url: URL.createObjectURL(f), name: f.name }))]);
  }, []);
  const removeStaged = (id: string) => setStaged((prev) => {
    const t = prev.find((x) => x.id === id); if (t) URL.revokeObjectURL(t.url);
    setSuggestions((sg) => sg.filter((x) => x.stagedId !== id));
    setSegByStaged((m) => { const n = { ...m }; delete n[id]; return n; });
    return prev.filter((x) => x.id !== id);
  });
  useEffect(() => () => { staged.forEach((s) => URL.revokeObjectURL(s.url)); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

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

  // ── Client-side inference (instance segmentation, YOLO26-seg) ──
  //  Runs the SAME segment()/decodeYoloSeg pipeline as mobile. Each valid
  //  SegDetection (defect class, above threshold) becomes an actionable
  //  suggestion carrying classId + normalized label + confidence + box + mask.
  const analyzeOne = async (s: Staged) => {
    if (modelStatus !== 'ready' || !modelRef) { setMsg({ kind: 'err', text: 'On-device model is not ready.' }); return; }
    if (!jobId) { setMsg({ kind: 'err', text: 'Select a job above first.' }); return; }
    setAnalyzingId(s.id); setMsg(null);
    try {
      const img = await imgFromUrl(s.url);
      const segs = await segment(img, modelRef.url, { expectedSha256: modelRef.sha256 });

      // Interactive overlay polygons (all detections, so reviewers see everything).
      setSegByStaged((prev) => ({
        ...prev,
        [s.id]: segs.map((d) => ({
          classId: d.classId, score: d.score, box: d.box, polygon: d.polygon,
          label: corrosionLabelFor(d.classId, modelRef.labels), aiBox: d.box, aiPolygon: d.polygon,
        })),
      }));

      // Actionable suggestions: real defect classes only (drops the 'car'
      // non-defect class), highest confidence first.
      const cands = segs
        .filter((d) => isCorrosionDefectClass(d.classId))
        .sort((a, b) => b.score - a.score);
      if (cands.length === 0) {
        setMsg({ kind: 'ok', text: 'No defects above the confidence threshold.' });
        return;
      }
      setSuggestions((prev) => [
        ...prev.filter((x) => x.stagedId !== s.id),
        ...cands.map((d, i) => ({
          id: `${s.id}-${d.classId}-${i}`,
          stagedId: s.id,
          thumbUrl: s.url,
          classId: d.classId,
          defectId: `cls_${d.classId}`,
          label: corrosionLabelFor(d.classId, modelRef.labels),
          confidence: d.score,
          box: d.box,
          polygon: d.polygon,
        })),
      ]);
      setMsg({ kind: 'ok', text: `${cands.length} on-device detection${cands.length === 1 ? '' : 's'}, ${modelRef.slug} v${modelRef.version}.` });
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Inference failed.' }); }
    finally { setAnalyzingId(null); }
  };
  const accept = async (sug: Suggestion) => {
    if (!jobId || !modelRef) return;
    setAcceptingId(sug.id); setMsg(null);
    try {
      const res = await recordDetection(
        jobId,
        {
          defectId: sug.defectId, label: sug.label, confidence: sug.confidence,
          classId: sug.classId, box: sug.box, polygon: sug.polygon,
        },
        modelRef,
      );
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Could not record finding.' }); return; }
      setSuggestions((prev) => prev.filter((x) => x.id !== sug.id));
      setMsg({ kind: 'ok', text: `Recorded "${sug.label}", bound to ${modelRef.slug} v${modelRef.version}.` });
      loadDets(jobId);
    } finally { setAcceptingId(null); }
  };
  // Reject: dismiss a suggestion without recording it (reviewer control).
  const reject = (sug: Suggestion) => setSuggestions((prev) => prev.filter((x) => x.id !== sug.id));

  const recorded = useMemo(() => dets, [dets]);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow"><ScanEye size={22} /></span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">Inspector, Vision</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">AI Co-inspector</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">Upload high-resolution or drone imagery for automated anomaly detection. All processing is <span className="text-zinc-200">strictly confidential and securely handled</span>.</p>
        </div>
      </header>

      {/* Model status */}
      {modelStatus === 'ready' && modelRef ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-accent-green/30 bg-accent-green/10 px-3 py-1.5 text-xs font-semibold text-accent-green">
          <Cpu size={13} /> On-device model ready, {modelRef.slug} v{modelRef.version}
        </div>
      ) : modelStatus === 'unconfigured' ? (
        // On-device AI runs natively in the mobile app (TFLite, private on-device).
        // On web the model is optional; present its absence as an intentional
        // state, never a developer config error, and never leak env-var names.
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <span>Automated AI analysis is currently in manual mode. You can still upload imagery and manually record findings for this job below.</span>
        </div>
      ) : modelStatus === 'error' ? (
        <div className="flex items-start gap-2 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Could not load the on-device model.{modelError ? ` ${modelError}` : ''} Check the model URL and that its SHA-256 matches the registered artifact.</span>
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={13} className="animate-spin" /> Checking on-device model…</div>
      )}

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
              <p className="text-xs text-zinc-500">High-res industrial or drone imagery, or click to browse</p>
              <button onClick={(e) => { e.stopPropagation(); startCam(); }} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-violet/40 hover:text-white"><Camera size={13} /> Use webcam</button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          )}

          {staged.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {staged.map((s) => (
                <div key={s.id} className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-ink-950">
                  <img src={s.url} alt={s.name} className="aspect-square w-full object-cover" />
                  <SegEditorOverlay
                    imageUrl={s.url}
                    detections={segByStaged[s.id] ?? []}
                    fitMode="cover"
                    onPersist={(d, v, poly) => {
                      if (!jobId || !modelRef) return;
                      void recordSegFeedback(
                        jobId,
                        { classId: d.classId, score: d.score, box: d.box, polygon: poly, label: d.label },
                        v,
                        modelRef,
                        { box: d.aiBox ?? d.box, polygon: d.aiPolygon ?? d.polygon },
                      );
                    }}
                  />
                  <button onClick={() => removeStaged(s.id)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"><X size={13} /></button>
                  <button onClick={() => analyzeOne(s)} disabled={modelStatus !== 'ready' || !jobId || analyzingId === s.id}
                    className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded-md bg-violet/90 py-1 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-60">
                    {analyzingId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Analyse
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-600"><Cpu size={12} /> Inference runs locally in your browser, images are never uploaded for analysis.</p>
        </section>

        {/* ── Suggestions + recorded findings ── */}
        <section className="space-y-5">
          {suggestions.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-white"><Wand2 size={16} className="text-violet-glow" /> On-device suggestions</h2>
              <ul className="space-y-2">
                {suggestions.map((sg) => (
                  <li key={sg.id} className="flex items-center gap-3 rounded-2xl border border-violet/25 bg-violet/[0.05] p-3">
                    <img src={sg.thumbUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{sg.label}</p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-950"><div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-glow" style={{ width: `${Math.round(sg.confidence * 100)}%` }} /></div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-white">{Math.round(sg.confidence * 100)}%</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button onClick={() => accept(sg)} disabled={acceptingId === sg.id} className="inline-flex items-center gap-1.5 rounded-full bg-violet px-3 py-1.5 text-xs font-bold text-white transition hover:bg-violet-deep disabled:opacity-60">
                        {acceptingId === sg.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Accept
                      </button>
                      <button onClick={() => reject(sg)} disabled={acceptingId === sg.id} aria-label="Reject suggestion" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-accent-red/40 hover:text-white disabled:opacity-60">
                        <X size={13} /> Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold text-white"><Sparkles size={16} className="text-violet-glow" /> Recorded findings</h2>
              {jobId && <span className="text-xs text-zinc-500">{recorded.length} on file</span>}
            </div>
            {!jobId ? (
              <Empty icon={<ScanEye size={22} className="text-violet-glow" />} title="Select a job" body="Choose an assigned job to analyse imagery and record findings against it." />
            ) : detLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>
            ) : recorded.length === 0 ? (
              <Empty icon={<ImageOff size={22} className="text-zinc-500" />} title="No findings yet" body="Analyse a photo on the left and accept a suggestion to record your first finding." />
            ) : (
              <ul className="space-y-3">
                {recorded.map((d) => (
                  <li key={d.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-white">{d.label}</p>
                          {d.severity && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-industrial ${sevCls(d.severity)}`}>{d.severity}</span>}
                        </div>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500"><ShieldCheck size={11} className="text-accent-green" /> {d.model_slug} v{d.model_version}{d.model_sha256 ? `, ${d.model_sha256.slice(0, 8)}…` : ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-lg font-semibold text-white">{Math.round(d.confidence * 100)}%</p>
                        <p className="text-[10px] text-zinc-500">confidence</p>
                      </div>
                    </div>
                    {d.accepted_by_human && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-accent-green"><CheckCircle2 size={13} /> Accepted finding</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
