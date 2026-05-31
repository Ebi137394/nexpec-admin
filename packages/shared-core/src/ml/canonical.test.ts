// ════════════════════════════════════════════════════════════════════════════
//  ml/canonical.test.ts — the AI-signature canonical (P3.1, moat-first)
//
//  This serialization is what the Node signer (register-model.mjs) and the
//  on-device verifier sign/verify over. If it ever drifts, every signed-model
//  signature silently breaks. These vectors lock it.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { canonicalJSONStringify, artifactAttestation } from './canonical';

describe('canonicalJSONStringify', () => {
  it('serialises object keys in sorted order', () => {
    expect(canonicalJSONStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('drops undefined values', () => {
    expect(canonicalJSONStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('preserves array order and recurses + sorts nested objects', () => {
    expect(canonicalJSONStringify({ z: [3, 1, 2], a: { y: 1, x: 2 } })).toBe(
      '{"a":{"x":2,"y":1},"z":[3,1,2]}',
    );
  });

  it('handles null, strings and booleans', () => {
    expect(canonicalJSONStringify(null)).toBe('null');
    expect(canonicalJSONStringify({ a: null, s: 'x', b: true })).toBe('{"a":null,"b":true,"s":"x"}');
  });

  it('is insertion-order independent (deterministic)', () => {
    expect(canonicalJSONStringify({ a: 1, b: 2 })).toBe(canonicalJSONStringify({ b: 2, a: 1 }));
  });

  it('throws on non-finite numbers (no silent NaN/Infinity)', () => {
    expect(() => canonicalJSONStringify(NaN)).toThrow();
    expect(() => canonicalJSONStringify({ x: Infinity })).toThrow();
  });
});

describe('artifactAttestation (the signed model attestation)', () => {
  const input = {
    kind: 'vision_defect',
    slug: 'universal-detector',
    version: 1,
    sha256: 'ABCDEF',
    runtime: 'tflite',
    tier: 'student',
  };

  it('is canonical, key-sorted, and lowercases the sha256', () => {
    expect(artifactAttestation(input)).toBe(
      '{"kind":"vision_defect","runtime":"tflite","sha256":"abcdef","slug":"universal-detector","tier":"student","version":1}',
    );
  });

  it('lowercasing makes hash casing irrelevant to the signature', () => {
    expect(artifactAttestation({ ...input, sha256: 'abcdef' })).toBe(
      artifactAttestation({ ...input, sha256: 'ABCDEF' }),
    );
  });

  it('binds every identity field — changing any one changes the attestation', () => {
    const base = artifactAttestation(input);
    expect(artifactAttestation({ ...input, version: 2 })).not.toBe(base);
    expect(artifactAttestation({ ...input, slug: 'other' })).not.toBe(base);
    expect(artifactAttestation({ ...input, sha256: 'ffffff' })).not.toBe(base);
    expect(artifactAttestation({ ...input, tier: 'teacher' })).not.toBe(base);
    expect(artifactAttestation({ ...input, runtime: 'onnx' })).not.toBe(base);
  });
});
