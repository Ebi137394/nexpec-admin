// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorCertifications.types.ts
//
//  NOTE: this is the *proper* certifications table — separate from the
//  free-form text array on profiles.certifications (kept for back-compat
//  with the existing chip-cloud display). New work writes to this table.
// ════════════════════════════════════════════════════════════════════════════

export interface InspectorCertification {
  id: string;
  name: string;
  issuingBody: string | null;
  certificateNumber: string | null;
  issuedAt: string | null;       // ISO date
  expiresAt: string | null;      // ISO date
  certificateUrl: string | null;
  certificatePath: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
