// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorReport.types.ts — types for inspection_reports
//
//  The inspection_reports table stores ONE row per (job, inspector) and
//  carries the report through a two-stage admin review:
//      1. technical_approved (admin technical reviewer)
//      2. financial_approved (admin finance reviewer)
//  Once both are true, admin flips is_published — the report becomes
//  visible to the client. Client final sign-off is is_client_approved.
//
//  GOLDEN_RULE_6 — Inspector → Admin → Client. The inspector only writes
//  to: status, photo_url, notes, final_report_doc. Everything else
//  (technical_approved, financial_approved, is_published,
//  is_client_approved) is admin/system-controlled.
// ════════════════════════════════════════════════════════════════════════════

export type InspectionReportStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'revision_requested'
  | string; // forward-compat — schema doesn't pin a CHECK constraint.

export type InspectionResult = 'pass' | 'fail' | 'partial';

/**
 * Structured doc encoded into inspection_reports.final_report_doc as JSON.
 * The TEXT column gives us schema flexibility — we can evolve the doc
 * shape without a migration. The `version` field is the migration hook
 * (bump it when the shape changes; readers branch on version).
 */
export interface FinalReportDoc {
  version: 1;
  result: InspectionResult;
  /** Inspector's executive summary — also mirrored into the `notes` column. */
  summary: string;
  /**
   * Photo evidence. Stored as STORAGE PATHS, not URLs. Bucket is private;
   * readers (admin / client surfaces) mint signed URLs on render.
   */
  evidence: Array<{
    path: string;
    caption: string | null;
    /** Bytes — captured at upload, used for storage analytics. */
    sizeBytes: number;
  }>;
  /**
   * Attestation. MVP is a typed-name affirmation; Sprint 6.5 wires a
   * canvas signature stored at attestation.signaturePath.
   */
  attestation: {
    inspectorName: string;
    attestedAt: string;
    signaturePath?: string;
  };
}

/**
 * Row shape returned by fetchInspectorReport. Subset of the full table —
 * intentionally omits client_op_id (idempotency-only) and admin_*_by
 * uuid columns (inspector doesn't need to see who reviewed).
 */
export interface InspectorReport {
  id: string;
  jobId: string;
  inspectorId: string;
  status: InspectionReportStatus;
  photoUrl: string | null;
  notes: string | null;
  /** Parsed JSON — null if the column held legacy text or invalid JSON. */
  finalReportDoc: FinalReportDoc | null;
  technicalApproved: boolean;
  technicalApprovedAt: string | null;
  financialApproved: boolean;
  financialApprovedAt: string | null;
  isPublished: boolean;
  isClientApproved: boolean;
  createdAt: string;
  updatedAt: string;
}
