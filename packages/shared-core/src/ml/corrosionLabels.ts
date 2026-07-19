// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/ml/corrosionLabels — launch config for the official
//  vision-defect model (corrosion-detector v2, YOLO26-seg 1024²).
//
//  Single source of truth for web + mobile so provenance (slug/version) and the
//  class → label mapping stay identical across shells.
//
//  ⚠️ INDEXING CONTRACT. The array index IS the model's raw classId. The
//     corrosion export shipped 11 UNMERGED raw categories (duplicate 'rust'/
//     'Rust', a stray non-defect 'car', severity tiers). We DO NOT reorder or
//     dedupe them — that would corrupt the classId→label mapping. We only
//     (a) normalize the *display* string per index, and (b) suppress classIds
//     that are not inspection defects (currently 'car', class 2) from being
//     surfaced as findings. The HITL flywheel harvests the raw integer class_id
//     in `raw` and consolidates the taxonomy for the next training cycle.
// ════════════════════════════════════════════════════════════════════════════

/** Official launch model identity — matches the v2 signed manifest + registry. */
export const CORROSION_MODEL = {
  kind: 'vision_defect' as const,
  slug: 'corrosion-detector',
  version: 2,
  semver: '2.0.0',
  runtime: 'tflite' as const,
  inputSize: 1024,
} as const;

/** Raw exported labels, index = classId. Verbatim from assets/labels.json;
 *  never reorder or dedupe (see indexing contract above). */
export const CORROSION_LABELS_RAW: readonly string[] = [
  'rust', // 0
  'Rust', // 1
  'car', // 2  ← non-defect (dataset pollution); suppressed from findings
  'copper corrosion', // 3
  'corroded-part', // 4
  'corrosion', // 5
  'iron rust', // 6
  'mild-corrosion', // 7
  'moderate-corrosion', // 8
  'rust', // 9
  'severe-corrosion', // 10
];

/** classIds that are NOT inspection defects and must not become findings. */
export const CORROSION_NON_DEFECT_CLASS_IDS: ReadonlySet<number> = new Set<number>([2]);

/** True if a classId represents a real corrosion defect (i.e. surfaceable). */
export function isCorrosionDefectClass(classId: number): boolean {
  return classId >= 0 && classId < CORROSION_LABELS_RAW.length && !CORROSION_NON_DEFECT_CLASS_IDS.has(classId);
}

/** Format a raw label into a clean, user-facing string (sentence case, no
 *  hyphens). Does NOT merge classes — display only. */
export function normalizeCorrosionLabel(raw: string): string {
  const cleaned = (raw ?? '').trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/** Normalized display labels, index = classId (length preserved at 11). */
export const CORROSION_LABELS_DISPLAY: readonly string[] = CORROSION_LABELS_RAW.map(normalizeCorrosionLabel);

/** Resolve a display label for a classId, falling back to a stable placeholder. */
export function corrosionLabelFor(classId: number, labels?: readonly string[]): string {
  const source = labels && labels.length > classId ? labels : CORROSION_LABELS_DISPLAY;
  const raw = source[classId];
  return normalizeCorrosionLabel(raw ?? '') || `Class ${classId}`;
}
