// ════════════════════════════════════════════════════════════════════════════
//  src/features/compliance/types/vca.ts
//
//  Verified Compliance Affidavit (VCA) — canonical JSON schema as
//  TypeScript types. This is the single source of truth shared by:
//
//    • supabase/functions/generate-vca/        (Edge Function generator)
//    • app/verify/[token].tsx                  (public verify page)
//    • app/(client)/jobs/[id]/affidavit.tsx    (buyer VCA viewer)
//    • src/features/compliance/templates/vca-template.html  (PDF template)
//
//  Wire-format: this object is stored verbatim in
//  public.verification_affidavits.json_payload (jsonb). The sha256 of
//  the canonicalized (RFC 8785 JCS) serialization is stored in
//  json_payload_sha256 and embedded in the PDF footer for tamper-evidence.
//
//  Versioning: bump `vca_version` on any breaking change. Older verify
//  pages read the version and render the matching layout; we never
//  silently change semantics on a fielded affidavit.
// ════════════════════════════════════════════════════════════════════════════

export const VCA_VERSION = '1.0' as const;

// ─────────────────────────────────────────────────────────────
//  Top-level affidavit object
// ─────────────────────────────────────────────────────────────
export interface VerifiedComplianceAffidavit {
  /** Schema version. Bump on breaking changes. */
  vca_version: typeof VCA_VERSION;

  /** Affidavit row id from public.verification_affidavits. */
  affidavit_id: string;

  /** URL-safe token used by the public verify page. */
  public_verify_token: string;

  /** Absolute URL of the public verify page. */
  public_verify_url: string;

  /** ISO 8601 timestamp of issuance. */
  issued_at: string;

  /** Validity window. */
  validity: {
    from: string;       // ISO 8601
    until: string;      // ISO 8601
    months: number;     // duration in months (denormalized for display)
  };

  /** What was verified, against what playbook. */
  scope: VcaScope;

  /** The entity that was verified (the supplier). */
  subject: VcaSubject;

  /** The party who commissioned the verification. */
  buyer: VcaBuyer;

  /** The compliance-certified inspector who performed the work. */
  inspector: VcaInspector;

  /** Per-requirement evidence groups. */
  evidence: VcaEvidenceGroup[];

  /** Legal documents collected during the inspection. */
  documents: VcaDocument[];

  /** Cryptographic integrity summary. */
  chain_of_custody: VcaChainOfCustody;

  /** Optional admin countersignature. Required for high-stakes scopes. */
  countersignature?: VcaCountersignature;

  /** Tamper-evident hashes + platform signature. */
  tamper_evidence: VcaTamperEvidence;

  /** If revoked, the revocation record. */
  revocation?: VcaRevocation;
}

// ─────────────────────────────────────────────────────────────
//  Subsidiary types
// ─────────────────────────────────────────────────────────────

export interface VcaScope {
  template_slug: string;
  template_name: string;
  template_version: number;
  category: string;       // 'supplier_verification' | 'license_verification' | ...
  region: string;         // 'global' | 'UAE' | 'KSA' | ...
}

export interface VcaSubject {
  /** Display name of the supplier (denormalized at issue time). */
  name: string;
  /** Address as claimed by the buyer at job posting. */
  claimed_address_text: string | null;
  /** Geocoded address (server-side). null if geocoding failed. */
  claimed_address_geocoded: { lat: number; lng: number } | null;
  /** Internal supplier profile id, sha256-hashed for privacy on public pages. */
  subject_id_hash: string;
}

export interface VcaBuyer {
  /** Buyer's display name. */
  name: string;
  /** 'client' or 'agency'. */
  type: 'client' | 'agency';
  /** Buyer profile id, sha256-hashed. */
  buyer_id_hash: string;
}

export interface VcaInspector {
  name: string;
  inspector_id_hash: string;
  credential: {
    tier: 'cci_basic' | 'cci_advanced' | 'cci_lead';
    credential_id_hash: string;
    approved_at: string;     // ISO 8601
    expires_at: string | null;
  };
  signed_at: string;
}

export interface VcaEvidenceGroup {
  requirement: {
    requirement_id_hash: string;
    sort_order: number;
    kind: VcaEvidenceKind;
    label: string;
    hint?: string | null;
    required: boolean;
    constraints: Record<string, unknown>;
  };
  captures: VcaCapture[];
}

export type VcaEvidenceKind =
  | 'photo'
  | 'photo_with_face'
  | 'gps_pin'
  | 'document_upload'
  | 'video_walkthrough'
  | 'rep_interview'
  | 'signed_statement'
  | 'text_input';

export interface VcaCapture {
  capture_id_hash: string;
  kind: VcaEvidenceKind;
  captured_at: string;            // ISO 8601
  /** Storage path is signed-URL-resolved at render time; not in the payload. */
  storage_ref: string;
  mime_type: string | null;

  gps: {
    lat: number;
    lng: number;
    accuracy_m: number;
    /** True if reverse-geocoded GPS matches claimed_address within tolerance. */
    matches_claimed_address: boolean;
    /** Distance (m) from claimed address geocode, if available. */
    distance_from_claim_m: number | null;
  } | null;

  exif_summary: {
    device_make: string | null;
    device_model: string | null;
    captured_timestamp: string | null;
    gps_intact: boolean;
  } | null;

  /** sha256 of file bytes + canonical metadata. */
  capture_sha256: string;
  /** Previous capture's sha256, or null if first in chain. */
  prev_capture_sha256: string | null;

  /** Face detection (only for photo_with_face kind). */
  face: {
    detected_count: number;
    liveness_score: number;
  } | null;

  /** Text payload (only for text_input + signed_statement). */
  text_value: string | null;

  /** Server-side validation result. */
  validation: {
    status: 'valid' | 'flagged' | 'rejected';
    flags: string[];
  };

  /** Device attestation token (Apple App Attest / Google Play Integrity). */
  device_attestation: {
    present: boolean;
    platform: 'ios' | 'android' | null;
  };
}

export interface VcaDocument {
  doc_type: string;
  storage_ref: string;
  /** sha256 of the document file. */
  doc_sha256: string;
  issuing_authority: string | null;
  document_number: string | null;
  issued_at: string | null;       // ISO 8601 date
  expires_at: string | null;      // ISO 8601 date
  verification_status: 'verified' | 'flagged' | 'rejected';
  verification_notes: string | null;
  verified_by_admin: boolean;
  /** Selected OCR-extracted fields. */
  extracted_fields: Record<string, string | null>;
}

export interface VcaChainOfCustody {
  /** True iff every capture's prev_capture_sha256 matches the prior capture's hash. */
  chain_intact: boolean;
  total_captures: number;
  first_capture_sha256: string | null;
  last_capture_sha256: string | null;
  /** Per-capture issues that did NOT break the chain but warrant disclosure. */
  notes: string[];
}

export interface VcaCountersignature {
  admin_name: string;
  admin_id_hash: string;
  countersigned_at: string;       // ISO 8601
  /** Optional admin note shown on the affidavit. */
  admin_note: string | null;
}

export interface VcaTamperEvidence {
  /** sha256 of the canonicalized json_payload (excluding tamper_evidence itself). */
  json_payload_sha256: string;
  /** sha256 of the rendered PDF. */
  pdf_sha256: string | null;
  /** Signing algorithm used for platform_signature. */
  signing_algorithm: 'Ed25519' | 'RSA-PSS-SHA256';
  /** Base64 platform signature over json_payload_sha256. */
  platform_signature: string;
  /** Hex-encoded public key identifier for the signing key. */
  platform_signing_key_id: string;
}

export interface VcaRevocation {
  revoked_at: string;             // ISO 8601
  revoked_reason: string;
  revoked_by_admin_id_hash: string;
}

// ─────────────────────────────────────────────────────────────
//  Render-side helpers
// ─────────────────────────────────────────────────────────────

/** Pretty label for a tier. */
export const tierLabel = (t: VcaInspector['credential']['tier']): string => {
  switch (t) {
    case 'cci_basic':    return 'CCI Basic';
    case 'cci_advanced': return 'CCI Advanced';
    case 'cci_lead':     return 'CCI Lead';
  }
};

/** Pretty label for a category slug (used in the cover header). */
export const categoryLabel = (c: string): string =>
  c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** Pretty label for an evidence kind. */
export const evidenceKindLabel = (k: VcaEvidenceKind): string => {
  switch (k) {
    case 'photo':              return 'Photo';
    case 'photo_with_face':    return 'Photo with Face';
    case 'gps_pin':            return 'GPS Pin';
    case 'document_upload':    return 'Document';
    case 'video_walkthrough':  return 'Video';
    case 'rep_interview':      return 'Representative Interview';
    case 'signed_statement':   return 'Signed Statement';
    case 'text_input':         return 'Text';
  }
};

/** Status badge color (used by both web verify page and React Native viewer). */
export const validationBadgeColor = (s: 'valid' | 'flagged' | 'rejected'): string => {
  switch (s) {
    case 'valid':    return '#10B981';
    case 'flagged':  return '#F59E0B';
    case 'rejected': return '#EF4444';
  }
};
