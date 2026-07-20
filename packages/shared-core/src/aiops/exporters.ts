// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/aiops/exporters — pure dataset-export generation:
//  YOLO label files, COCO JSON, and versioned manifests. No I/O — callers
//  (services / Colab packager / ZIP builder) decide where bytes land, which is
//  what keeps this identical across node tooling and the web backend.
// ════════════════════════════════════════════════════════════════════════════

/** One normalized annotation (geometry in [0,1] of the image). */
export interface ExportAnnotation {
  classId: number;
  /** xyxy normalized. */
  box: [number, number, number, number];
  /** Optional normalized polygon → emitted as YOLO-seg / COCO segmentation. */
  polygon?: Array<[number, number]>;
}

export interface ExportImage {
  /** Stable id (uuid) — becomes the exported file stem. */
  id: string;
  fileName: string;          // e.g. "3f2a….jpg" (relative, provider-agnostic)
  widthPx: number;
  heightPx: number;
  sha256?: string | null;
  annotations: ExportAnnotation[];
}

/** YOLO: one .txt per image. Detection rows `cls cx cy w h`; when a polygon is
 *  present emits YOLO-seg rows `cls x1 y1 x2 y2 …` instead (Ultralytics spec). */
export function toYoloLabelFile(img: ExportImage, precision = 6): string {
  const f = (v: number): string => v.toFixed(precision);
  return img.annotations.map((a) => {
    if (a.polygon && a.polygon.length >= 3) {
      return [a.classId, ...a.polygon.flatMap(([x, y]) => [f(x), f(y)])].join(' ');
    }
    const [x1, y1, x2, y2] = a.box;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, w = x2 - x1, h = y2 - y1;
    return [a.classId, f(cx), f(cy), f(w), f(h)].join(' ');
  }).join('\n') + (img.annotations.length ? '\n' : '');
}

/** Ultralytics data.yaml for a packaged set. */
export function toYoloDataYaml(labels: readonly string[], opts?: { train?: string; val?: string; test?: string }): string {
  const names = labels.map((l, i) => `  ${i}: ${l}`).join('\n');
  return [
    `train: ${opts?.train ?? 'images/train'}`,
    `val: ${opts?.val ?? 'images/val'}`,
    ...(opts?.test ? [`test: ${opts.test}`] : []),
    `nc: ${labels.length}`,
    'names:',
    names,
    '',
  ].join('\n');
}

/** COCO instances JSON (detection + optional segmentation). */
export function toCocoJson(
  images: readonly ExportImage[],
  labels: readonly string[],
  meta?: { description?: string; versionTag?: string },
): string {
  const cocoImages = images.map((img, i) => ({
    id: i + 1, file_name: img.fileName, width: img.widthPx, height: img.heightPx,
  }));
  const annotations: Array<Record<string, unknown>> = [];
  let annId = 0;
  images.forEach((img, i) => {
    for (const a of img.annotations) {
      const [x1, y1, x2, y2] = a.box;
      const bx = x1 * img.widthPx, by = y1 * img.heightPx;
      const bw = (x2 - x1) * img.widthPx, bh = (y2 - y1) * img.heightPx;
      annotations.push({
        id: ++annId,
        image_id: i + 1,
        category_id: a.classId + 1, // COCO ids are 1-based
        bbox: [round2(bx), round2(by), round2(bw), round2(bh)],
        area: round2(bw * bh),
        iscrowd: 0,
        ...(a.polygon && a.polygon.length >= 3
          ? { segmentation: [a.polygon.flatMap(([px, py]) => [round2(px * img.widthPx), round2(py * img.heightPx)])] }
          : {}),
      });
    }
  });
  return JSON.stringify({
    info: { description: meta?.description ?? 'NEXPEC dataset export', version: meta?.versionTag ?? '1.0', date_created: new Date().toISOString() },
    images: cocoImages,
    annotations,
    categories: labels.map((name, i) => ({ id: i + 1, name, supercategory: 'defect' })),
  }, null, 2);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Deterministic, versioned export manifest (hash-stable field order). */
export interface ExportManifest {
  versionTag: string;
  kind: 'yolo' | 'coco' | 'zip' | 'training_package' | 'manifest';
  modelSlug: string;
  labels: readonly string[];
  imageCount: number;
  images: Array<{ id: string; fileName: string; sha256: string | null }>;
  createdAt: string;
}
export function buildManifest(
  kind: ExportManifest['kind'], versionTag: string, modelSlug: string,
  labels: readonly string[], images: readonly ExportImage[],
): ExportManifest {
  return {
    versionTag, kind, modelSlug, labels: [...labels],
    imageCount: images.length,
    images: images.map((i) => ({ id: i.id, fileName: i.fileName, sha256: i.sha256 ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    createdAt: new Date().toISOString(),
  };
}
