// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/inspector/SegEditorOverlay.tsx
//
//  Web HITL twin of the mobile SegOverlay: an absolutely-positioned <svg> over
//  the reviewed image. Same "polygon is the toolbar" paradigm — no toolbar, no
//  new controls:
//    • CLICK a polygon        → select (vertex handles appear)
//    • DRAG a vertex handle    → adjust (isUserCorrected)
//    • DELETE / BACKSPACE key  → remove the selected hallucination
//  Geometry is normalized [0,1]; the overlay computes the object-contain fit
//  from the image's natural size so polygons land pixel-accurate. Corrections
//  bubble to `onPersist` (parent calls pi_record_ai_feedback). Uses the SAME
//  decodeYoloSeg output as mobile → guaranteed parity.
// ════════════════════════════════════════════════════════════════════════════
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface SegEditDetection {
  classId: number;
  score: number;
  box: [number, number, number, number];
  polygon: Array<[number, number]>;
  label?: string;
  /** Pristine AI geometry — carried untouched so onPersist can report drift
   *  even after the live box/polygon are edited in place. */
  aiBox?: [number, number, number, number];
  aiPolygon?: Array<[number, number]>;
}

export type SegVerdict = 'accepted' | 'false_positive';

interface Props {
  imageUrl: string;
  detections: SegEditDetection[];
  /** Match the underlying <img> object-fit so polygons align. Default 'contain'. */
  fitMode?: 'contain' | 'cover';
  /** Fired on delete (false_positive, polygon=null) or drag-commit (accepted). */
  onPersist?: (det: SegEditDetection, verdict: SegVerdict, correctedPolygon: Array<[number, number]> | null) => void;
}

const CLASS_COLOR = ['#7C3AED', '#FBBF24'];
const colorFor = (c: number): string => CLASS_COLOR[c] ?? '#7C3AED';
const HIT_R = 0.03; // normalized grab radius

function bboxOf(poly: Array<[number, number]>): [number, number, number, number] {
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const [x, y] of poly) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
  return [x1, y1, x2, y2];
}

export function SegEditorOverlay({ imageUrl, detections, fitMode = 'contain', onPersist }: Props): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [dets, setDets] = useState<SegEditDetection[]>(detections);
  const [selected, setSelected] = useState<number | null>(null);
  const drag = useRef<{ det: number; vtx: number; moved: boolean } | null>(null);

  useEffect(() => { setDets(detections); setSelected(null); }, [detections]);

  // measure container (object-contain fit needs both container + intrinsic size)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const im = new Image();
    im.onload = () => setImg({ w: im.naturalWidth, h: im.naturalHeight });
    im.src = imageUrl;
  }, [imageUrl]);

  let fit: { x: number; y: number; w: number; h: number } | null = null;
  if (box && img && img.w > 0 && img.h > 0 && box.w > 0 && box.h > 0) {
    const s = fitMode === 'cover' ? Math.max(box.w / img.w, box.h / img.h) : Math.min(box.w / img.w, box.h / img.h);
    const w = img.w * s, h = img.h * s;
    fit = { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  }

  const toNorm = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const el = wrapRef.current; if (!el || !fit) return null;
    const r = el.getBoundingClientRect();
    return [(clientX - r.left - fit.x) / fit.w, (clientY - r.top - fit.y) / fit.h];
  }, [fit]);

  const del = useCallback((i: number): void => {
    const d = dets[i]; if (!d) return;
    onPersist?.(d, 'false_positive', null);
    setDets((prev) => prev.filter((_, k) => k !== i));
    setSelected(null);
  }, [dets, onPersist]);

  // Delete / Backspace removes the selected polygon
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) { e.preventDefault(); del(selected); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, del]);

  const onVertexDown = (detIdx: number, vtx: number) => (e: React.PointerEvent): void => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { det: detIdx, vtx, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const g = drag.current; if (!g) return;
    const n = toNorm(e.clientX, e.clientY); if (!n) return;
    g.moved = true;
    const nx = Math.max(0, Math.min(1, n[0])), ny = Math.max(0, Math.min(1, n[1]));
    setDets((prev) => prev.map((d, i) => (i !== g.det ? d
      : { ...d, polygon: d.polygon.map((p, k) => (k === g.vtx ? [nx, ny] as [number, number] : p)) })));
  };
  const onPointerUp = (): void => {
    const g = drag.current; drag.current = null;
    if (!g || !g.moved) return;
    const d = dets[g.det]; if (d) onPersist?.({ ...d, box: bboxOf(d.polygon) }, 'accepted', d.polygon);
  };

  if (!fit) return <div ref={wrapRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;

  return (
    <div
      ref={wrapRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: dets.length ? 'auto' : 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onClick={() => setSelected(null)}
    >
      <svg
        style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fit.h, overflow: 'visible' }}
        viewBox={`0 0 ${fit.w} ${fit.h}`}
      >
        {dets.map((d, i) => {
          const col = colorFor(d.classId);
          const sel = i === selected;
          return (
            <g key={i}>
              <polygon
                points={d.polygon.map(([x, y]) => `${(x * fit!.w).toFixed(1)},${(y * fit!.h).toFixed(1)}`).join(' ')}
                fill={`${col}${sel ? '3D' : '2E'}`}
                stroke={col}
                strokeWidth={sel ? 3 : 2}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setSelected(i); }}
              />
              {sel && d.polygon.map(([x, y], k) => (
                <circle
                  key={k}
                  cx={x * fit!.w}
                  cy={y * fit!.h}
                  r={6}
                  fill="#FFFFFF"
                  stroke={col}
                  strokeWidth={2}
                  style={{ cursor: 'grab' }}
                  onPointerDown={onVertexDown(i, k)}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
