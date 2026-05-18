// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorDocuments.types.ts
// ════════════════════════════════════════════════════════════════════════════

export const DOCUMENT_KINDS = [
  'id_card',
  'passport',
  'work_permit',
  'insurance',
  'safety_ticket',
  'medical',
  'background_check',
  'other',
] as const;

export type InspectorDocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<InspectorDocumentKind, string> = {
  id_card: 'Government ID',
  passport: 'Passport',
  work_permit: 'Work permit / visa',
  insurance: 'Insurance / liability',
  safety_ticket: 'Safety ticket',
  medical: 'Medical / fit-for-duty',
  background_check: 'Background check',
  other: 'Other',
};

export interface InspectorDocument {
  id: string;
  kind: InspectorDocumentKind;
  label: string;
  /** Pre-signed view URL (built server-side; expires after a short window). */
  fileUrl: string | null;
  /** Object key in the inspector_credentials bucket. */
  filePath: string;
  expiresAt: string | null; // ISO date (YYYY-MM-DD)
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
