// ════════════════════════════════════════════════════════════════════════════
//  ml/types.ts — Phase A.5 model-registry contracts (pure TypeScript)
//
//  The single cross-surface vocabulary for on-device ML. Web and mobile both
//  import these so a registry change is a compile-time event on both surfaces,
//  never a silent drift. No React, no React Native, no Node — pure types.
// ════════════════════════════════════════════════════════════════════════════

/** Open set of model purposes. The DB stores `kind` as free text; the app
 *  validates against this union but tolerates unknown strings for forward
 *  compatibility (an older client simply ignores a kind it doesn't handle). */
export type ModelKind =
  | 'vision_defect'
  | 'vision_segmentation'
  | 'ocr'
  | 'speech_to_text'
  | 'nlu'
  | 'embedding'
  | 'doc_extraction'
  | 'doc_conformance'
  | 'other'
  | (string & {});

/** Teacher = full crown-jewel model, NEVER distributed. Student = distilled,
 *  on-device. The registry refuses to publish a teacher (see migration). */
export type ModelTier = 'teacher' | 'student';

export type ModelRuntime = 'executorch' | 'onnx' | 'tflite' | 'tfjs' | 'ggml' | 'noop';

export type DeviceTier = 'low' | 'standard' | 'high';

export type OsConstraint = 'ios' | 'android' | 'any';

export type SignatureAlg = 'ed25519' | 'rsa-pss-sha256' | 'ecdsa-p256-sha256';

/** A resolved, integrity-stamped pointer to a model file in Storage. */
export interface ModelArtifact {
  id: string;
  kind: ModelKind;
  slug: string;
  version: number;
  semver?: string;
  runtime: ModelRuntime;
  tier: ModelTier;
  storageBucket: string;
  storagePath: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the raw artifact bytes. */
  sha256: string;
  /** Base64 signature over the canonical artifact attestation (see canonical.ts). */
  signature?: string;
  signatureAlg?: SignatureAlg;
  signingKeyId?: string;
  deviceMinTier: DeviceTier;
  minAppVersion?: string;
  osConstraint: OsConstraint;
  license?: string;
  params: Record<string, unknown>;
}

export interface DeviceProfile {
  tier: DeviceTier;
  os: OsConstraint;
  appVersion?: string;
}

export interface ResolveResponse {
  generatedAt: string;
  device: { tier: DeviceTier; os: OsConstraint };
  appVersion?: string;
  models: ModelArtifact[];
}

// ─── Phase 4 · Document intelligence contracts (server/worker; pure types) ────

/** A client's locked report rubric. Auto-derived from their sample, confirmed +
 *  locked ONCE; hashed (spec_sha256) and bound into the seal. */
export interface DocTemplateSpec {
  version: 1;
  sections: Array<{ key: string; title: string; required: boolean }>;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'enum' | 'boolean';
    unit?: string;
    required: boolean;
    enumValues?: string[];
  }>;
  mandatoryClauses?: string[];
  notes?: string;
}

/** The autonomous document-validation verdict. Canonicalized + hashed
 *  (result_sha256) and folded into the inspection seal's doc_root. Advisory:
 *  a low score flags admin review, it never auto-rejects the inspector. */
export interface DocValidationVerdict {
  version: 1;
  conformanceScore: number; // 0..1 — completeness + structural + semantic
  missing: string[];        // required sections/fields absent
  inconsistencies: string[]; // unit/range/internal contradictions
  evidenceGaps: string[];   // report claims not backed by inspection_captures
  similarityFlags: string[]; // plagiarism / client-sample-copy signals
  confidence: number;       // 0..1 — model self-confidence
}
