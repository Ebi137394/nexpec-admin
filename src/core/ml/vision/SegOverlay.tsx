// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/vision/SegOverlay.tsx — HITL-editable seg polygon overlay
//
//  "The polygon IS the toolbar." Zero new UI: every affordance lives on the SVG.
//    • TAP a polygon        → select it (vertex handles appear, stroke thickens)
//    • DRAG a vertex handle  → adjust the mask (isUserCorrected = true)
//    • LONG-PRESS a polygon  → delete a hallucination (false-positive)
//  Corrections persist through the OFFLINE outbox (enqueueAiFeedback → the
//  existing pi_record_ai_feedback flywheel), geometry packed in `raw` — no
//  migration, harvestable in 6 months via raw->>'is_user_corrected'='true'.
//
//  Passive (read-only) unless BOTH jobId and mode are supplied. Scaling stays on
//  the GPU (SVG); one Pan gesture hit-tests vertices in normalized space so we
//  never fight react-native-svg's own touch handling. Requires a
//  GestureHandlerRootView at the app root + the reanimated babel plugin (present).
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { aiFeedbackToRpcArgs, getModel, type AiAssist } from '@nexpec/shared-core';
import { enqueueAiFeedback } from '@/src/core/offline';

// The engine's exported mode→slug map keeps provenance on the SAME registry
// identity (slug/version/sha256) as web — never an ad-hoc string.
import { modeSlug, type SegMode } from './segModelManager';

export interface SegOverlayDetection {
  classId: number;
  score: number;
  box: [number, number, number, number];
  polygon: Array<[number, number]>;
  label?: string;
}

interface Props {
  imageUri: string;
  detections: SegOverlayDetection[];
  /** Persistence context — when jobId + mode are set the overlay becomes editable. */
  jobId?: string;
  captureId?: string | null;
  mode?: SegMode;
  modelVersion?: number;
}

const CLASS_COLOR = ['#7C3AED', '#FBBF24']; // primary brand + the AI-card amber
const colorFor = (c: number): string => CLASS_COLOR[c] ?? '#7C3AED';
const HIT_R = 0.04; // normalized vertex grab radius

/** Ray-cast point-in-polygon, normalized coords. */
function pointInPoly(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bboxOf(poly: Array<[number, number]>): [number, number, number, number] {
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const [x, y] of poly) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
  return [x1, y1, x2, y2];
}

export function SegOverlay({ imageUri, detections, jobId, captureId, mode, modelVersion = 1 }: Props): React.ReactElement {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [dets, setDets] = useState<SegOverlayDetection[]>(detections);
  const [selected, setSelected] = useState<number | null>(null);
  const drag = useRef<{ det: number; vtx: number; moved: boolean } | null>(null);

  useEffect(() => { setDets(detections); setSelected(null); }, [detections]);
  useEffect(() => {
    let alive = true; setImg(null);
    Image.getSize(imageUri, (w, h) => { if (alive) setImg({ w, h }); }, () => {});
    return () => { alive = false; };
  }, [imageUri]);

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout; setBox({ w: width, h: height });
  };

  // contain-fit rect of the image inside its container
  let fit: { x: number; y: number; w: number; h: number } | null = null;
  if (box && img && img.w > 0 && img.h > 0 && box.w > 0 && box.h > 0) {
    const s = Math.min(box.w / img.w, box.h / img.h);
    const w = img.w * s, h = img.h * s;
    fit = { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  }

  const editable = !!(jobId && mode);

  // local px (within the GestureDetector view) → normalized to the fitted image
  const toNorm = (px: number, py: number): [number, number] | null => {
    if (!fit) return null;
    return [(px - fit.x) / fit.w, (py - fit.y) / fit.h];
  };

  // ── persistence (offline outbox → pi_record_ai_feedback) ─────────────────────
  const persist = (
    det: SegOverlayDetection,
    verdict: 'false_positive' | 'accepted',
    correctedPolygon: Array<[number, number]> | null,
  ): void => {
    if (!editable) return;
    const label = det.label ?? `class ${det.classId}`;
    const defectId = `${mode}:${label.toLowerCase().replace(/\s+/g, '_')}`;
    // Registry identity for THIS mode — the exact model that produced the mask.
    const reg = getModel(modeSlug(mode!));
    const assist: AiAssist = {
      modelSlug: reg?.slug ?? `${mode}_yolo26s_seg`,
      modelVersion: reg?.version ?? modelVersion,
      modelSha256: reg?.sha256,
      defectId,
      label,
      confidence: det.score,
      acceptedByHuman: verdict !== 'false_positive',
    };
    const raw: Record<string, unknown> = {
      is_user_corrected: true,
      source: 'user',
      class_id: det.classId,
      // Provenance of the producing model (sha binds the geometry to the exact
      // signed artifact — the feedback RPC omits sha, so we carry it here).
      model_slug: assist.modelSlug,
      model_version: assist.modelVersion,
      model_sha256: reg?.sha256 ?? null,
      ai_box: det.box,
      ai_polygon: det.polygon,
      corrected_box: correctedPolygon ? bboxOf(correctedPolygon) : null,
      corrected_polygon: correctedPolygon, // null = deleted hallucination
      // stable per-detection key so the 6-month export can take the latest edit
      det_key: `${captureId ?? ''}:${det.classId}:${det.box.map((v) => v.toFixed(3)).join(',')}`,
      mode,
    };
    const args = aiFeedbackToRpcArgs(assist, jobId!, verdict, {
      captureId: captureId ?? undefined,
      aiDefectId: defectId,
      raw,
    });
    void enqueueAiFeedback(args as Record<string, unknown>);
  };

  // ── gesture handlers (run on JS via runOnJS) ─────────────────────────────────
  const hitDet = (px: number, py: number): number | null => {
    const n = toNorm(px, py); if (!n) return null;
    for (let i = 0; i < dets.length; i++) if (pointInPoly(n[0], n[1], dets[i]!.polygon)) return i;
    return null;
  };

  const onTap = (px: number, py: number): void => { setSelected(hitDet(px, py)); };

  const onLongPress = (px: number, py: number): void => {
    if (!editable) return;
    const i = hitDet(px, py); if (i == null) return;
    persist(dets[i]!, 'false_positive', null); // delete = hard negative
    setDets((prev) => prev.filter((_, k) => k !== i));
    setSelected(null);
  };

  const onGrab = (px: number, py: number): void => {
    drag.current = null;
    if (!editable || selected == null || !fit) return;
    const n = toNorm(px, py); if (!n) return;
    const poly = dets[selected]!.polygon;
    let bestK = -1, bestD = HIT_R;
    for (let k = 0; k < poly.length; k++) {
      const d = Math.hypot(poly[k]![0] - n[0], poly[k]![1] - n[1]);
      if (d < bestD) { bestD = d; bestK = k; }
    }
    if (bestK >= 0) drag.current = { det: selected, vtx: bestK, moved: false };
  };

  const onMove = (px: number, py: number): void => {
    const g = drag.current; if (!g) return;
    const n = toNorm(px, py); if (!n) return;
    const nx = Math.max(0, Math.min(1, n[0])), ny = Math.max(0, Math.min(1, n[1]));
    g.moved = true;
    setDets((prev) => prev.map((d, i) => {
      if (i !== g.det) return d;
      const polygon = d.polygon.map((p, k) => (k === g.vtx ? [nx, ny] as [number, number] : p));
      return { ...d, polygon };
    }));
  };

  const onRelease = (): void => {
    const g = drag.current; drag.current = null;
    if (!g || !g.moved) return;
    const d = dets[g.det]; if (d) persist(d, 'accepted', d.polygon); // corrected geometry
  };

  const pan = Gesture.Pan().minDistance(2)
    .onStart((e) => { runOnJS(onGrab)(e.x, e.y); })
    .onUpdate((e) => { runOnJS(onMove)(e.x, e.y); })
    .onEnd(() => { runOnJS(onRelease)(); });
  const longPress = Gesture.LongPress().minDuration(450).onStart((e) => { runOnJS(onLongPress)(e.x, e.y); });
  const tap = Gesture.Tap().maxDuration(250).onEnd((e) => { runOnJS(onTap)(e.x, e.y); });
  const gesture = Gesture.Exclusive(longPress, pan, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View pointerEvents={editable ? 'auto' : 'none'} style={StyleSheet.absoluteFill} onLayout={onLayout}>
        {fit && dets.length > 0 && (
          <Svg style={{ position: 'absolute', left: fit.x, top: fit.y }} width={fit.w} height={fit.h}>
            {dets.map((d, i) => {
              const col = colorFor(d.classId);
              const sel = i === selected;
              return (
                <React.Fragment key={i}>
                  <Polygon
                    points={d.polygon.map(([x, y]) => `${(x * fit!.w).toFixed(1)},${(y * fit!.h).toFixed(1)}`).join(' ')}
                    fill={`${col}${sel ? '3D' : '2E'}`}
                    stroke={col}
                    strokeWidth={sel ? 3 : 2}
                  />
                  {editable && sel && d.polygon.map(([x, y], k) => (
                    <Circle key={k} cx={x * fit!.w} cy={y * fit!.h} r={6} fill="#FFFFFF" stroke={col} strokeWidth={2} />
                  ))}
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>
    </GestureDetector>
  );
}
