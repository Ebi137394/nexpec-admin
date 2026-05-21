// ════════════════════════════════════════════════════════════════════════════
//  lib/data/vault.types.ts — Compliance Vault shapes
//
//  Tab 1 (corporate docs): public.client_documents — extended in Round 1's
//  migration with category / valid_from / valid_until / is_verified columns.
//
//  Tab 2 (inspection certificates): public.trust_certificates — read-only
//  aggregator of certificates issued from completed compliance inspections.
//
//  Account types served:
//    client / agency / enterprise — see their own + org-rollup
//    admin                        — see all, can verify
// ════════════════════════════════════════════════════════════════════════════

export type VaultCategory =
  | 'insurance'
  | 'license'
  | 'nda'
  | 'msa'
  | 'regulatory'
  | 'audit'
  | 'other';

export const VAULT_CATEGORY_LABEL: Record<VaultCategory, string> = {
  insurance: 'Insurance',
  license: 'License',
  nda: 'NDA',
  msa: 'MSA',
  regulatory: 'Regulatory',
  audit: 'Audit',
  other: 'Other',
};

export interface VaultDocument {
  id: string;
  ownerId: string;
  ownerName: string | null;       // hydrated; null when admin viewing org-rollup
  jobId: string | null;
  jobTitle: string | null;        // hydrated
  kind: string;                   // legacy column, e.g. "policy"
  label: string;
  category: VaultCategory;
  filePath: string | null;
  externalUrl: string | null;
  notes: string | null;
  validFrom: string | null;       // ISO date
  validUntil: string | null;      // ISO date
  isVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VaultCounts {
  total: number;
  verified: number;
  unverified: number;
  expiringSoon: number;          // valid_until within 30 days
  expired: number;               // valid_until in the past
  byCategory: Array<{ category: VaultCategory; count: number }>;
}

export const EMPTY_VAULT_COUNTS: VaultCounts = {
  total: 0,
  verified: 0,
  unverified: 0,
  expiringSoon: 0,
  expired: 0,
  byCategory: [],
};

// ─── Trust certificates (read-only aggregator) ─────────────────────────
export interface TrustCertificate {
  id: string;
  publicSlug: string;
  supplierProfileId: string;
  supplierName: string | null;
  scopeTemplateId: string;
  scopeTemplateName: string | null;
  affidavitId: string;
  isPublicDirectoryListed: boolean;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
}
