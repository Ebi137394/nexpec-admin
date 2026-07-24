// ════════════════════════════════════════════════════════════════════════════
//  ml/findingValidate.ts — pre-persistence guard for AI findings. Rejects a
//  malformed payload (bad class, out-of-range confidence, un-normalized geometry,
//  region memberCount mismatch) rather than store partial data. Shared by the web
//  accept path and the persistence-payload tests. Pure TS, no deps.
// ════════════════════════════════════════════════════════════════════════════

export interface ValidatableMember {
  memberId: number;
  classId: number;
  confidence: number;
  box: [number, number, number, number];
  polygon: Array<[number, number]>;
}

export interface ValidatableFinding {
  findingKind: 'instance' | 'region';
  classId: number;
  confidence: number;
  box: [number, number, number, number];
  polygon: Array<[number, number]>;
  region?: { memberCount: number; members: ValidatableMember[] } | null;
}

const finite01 = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const validBox = (b: unknown): boolean => Array.isArray(b) && b.length === 4 && b.every(finite01);
const validPolygon = (p: unknown): boolean =>
  Array.isArray(p) && p.length > 0 && p.every((pt) => Array.isArray(pt) && pt.length === 2 && finite01(pt[0]) && finite01(pt[1]));

/** Returns an error string if the finding is malformed, or null if it is safe to
 *  persist. `numClasses` is the active model's label count (class-id bound). */
export function validateFinding(f: ValidatableFinding, numClasses: number): string | null {
  const classOk = (c: number): boolean => Number.isInteger(c) && c >= 0 && c < numClasses;
  if (!classOk(f.classId)) return `invalid classId ${f.classId}`;
  if (!finite01(f.confidence)) return `confidence out of [0,1]: ${f.confidence}`;
  if (!validBox(f.box)) return 'box not finite/normalized to [0,1]';
  if (!validPolygon(f.polygon)) return 'polygon not finite/normalized to [0,1]';
  if (f.findingKind === 'region') {
    const r = f.region;
    if (!r) return 'region finding missing region metadata';
    if (r.memberCount !== r.members.length) return `memberCount ${r.memberCount} ≠ members.length ${r.members.length}`;
    if (r.members.length === 0) return 'region has no members';
    for (const m of r.members) {
      if (!classOk(m.classId)) return `member ${m.memberId} invalid classId ${m.classId}`;
      if (!finite01(m.confidence)) return `member ${m.memberId} confidence out of [0,1]: ${m.confidence}`;
      if (!validBox(m.box)) return `member ${m.memberId} box not finite/normalized`;
      if (!validPolygon(m.polygon)) return `member ${m.memberId} polygon not finite/normalized`;
    }
  }
  return null;
}
