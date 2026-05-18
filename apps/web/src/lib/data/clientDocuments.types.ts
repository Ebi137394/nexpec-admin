// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientDocuments.types.ts
// ════════════════════════════════════════════════════════════════════════════

export const CLIENT_DOC_KINDS = [
  'drawing',
  'spec_sheet',
  'nda',
  'prior_report',
  'regulatory',
  'vendor_doc',
  'photo_evidence',
  'other',
] as const;

export type ClientDocKind = (typeof CLIENT_DOC_KINDS)[number];

export const CLIENT_DOC_KIND_LABELS: Record<ClientDocKind, string> = {
  drawing: 'Drawing / P&ID',
  spec_sheet: 'Spec sheet',
  nda: 'NDA',
  prior_report: 'Prior report',
  regulatory: 'Regulatory paperwork',
  vendor_doc: 'Vendor document',
  photo_evidence: 'Photo evidence',
  other: 'Other',
};

/**
 * A client document is EITHER an uploaded file (`filePath` set + `fileUrl`
 * minted as a signed URL) OR an external link (`externalUrl` set). The DB
 * CHECK constraint `client_documents_has_content` enforces XOR. UI renders
 * the appropriate affordance based on which field is populated.
 */
export type ClientDocSource = 'upload' | 'external_url';

export interface ClientDocument {
  id: string;
  ownerId: string;
  jobId: string | null;
  jobTitle: string | null;
  kind: ClientDocKind;
  label: string;
  /** Which source the doc is backed by. Derived from which field is populated. */
  source: ClientDocSource;
  /** Pre-signed view URL when source='upload' (10-min TTL); null when external. */
  fileUrl: string | null;
  /** Object key in the bucket. Null when source='external_url'. */
  filePath: string | null;
  /** External URL (Drive / Dropbox / OneDrive / DocuSign / etc.) when source='external_url'. */
  externalUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
