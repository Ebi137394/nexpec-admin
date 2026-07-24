// ════════════════════════════════════════════════════════════════════════════
//  ml/findingValidate.test.ts — the pre-persistence guard must accept well-formed
//  instance + region payloads and REJECT malformed ones (never store partial
//  data): memberCount mismatch, out-of-range confidence, un-normalized geometry,
//  invalid class ids.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { validateFinding, type ValidatableFinding } from './findingValidate';

const NC = 5; // WDA
const goodRegion = (): ValidatableFinding => ({
  findingKind: 'region', classId: 2, confidence: 0.8, box: [0.4, 0.4, 0.6, 0.6],
  polygon: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]],
  region: {
    memberCount: 2,
    members: [
      { memberId: 0, classId: 2, confidence: 0.8, box: [0.4, 0.4, 0.5, 0.5], polygon: [[0.4, 0.4], [0.5, 0.4], [0.5, 0.5]] },
      { memberId: 1, classId: 3, confidence: 0.7, box: [0.5, 0.5, 0.6, 0.6], polygon: [[0.5, 0.5], [0.6, 0.5], [0.6, 0.6]] },
    ],
  },
});
const goodInstance: ValidatableFinding = { findingKind: 'instance', classId: 2, confidence: 0.9, box: [0.1, 0.1, 0.2, 0.2], polygon: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], region: null };

describe('validateFinding — accepts well-formed', () => {
  it('accepts a region payload', () => { expect(validateFinding(goodRegion(), NC)).toBeNull(); });
  it('accepts an instance payload', () => { expect(validateFinding(goodInstance, NC)).toBeNull(); });
});

describe('validateFinding — rejects malformed (no partial storage)', () => {
  it('memberCount ≠ members.length', () => { const f = goodRegion(); f.region!.memberCount = 99; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('member confidence out of [0,1]', () => { const f = goodRegion(); f.region!.members[0]!.confidence = 1.7; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('member box not normalized', () => { const f = goodRegion(); f.region!.members[0]!.box = [0.1, 0.1, 1.4, 0.2]; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('invalid member classId', () => { const f = goodRegion(); f.region!.members[0]!.classId = 99; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('invalid top-level classId', () => { const f = goodRegion(); f.classId = -1; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('non-finite confidence', () => { const f = goodRegion(); f.confidence = NaN; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('region finding missing metadata', () => { const f = goodRegion(); f.region = null; expect(validateFinding(f, NC)).not.toBeNull(); });
  it('polygon vertex out of range', () => { const f = goodInstance; const g: ValidatableFinding = { ...f, polygon: [[0.1, 0.1], [1.2, 0.1], [0.2, 0.2]] }; expect(validateFinding(g, NC)).not.toBeNull(); });
});
