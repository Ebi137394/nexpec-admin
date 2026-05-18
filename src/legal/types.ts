// ════════════════════════════════════════════════════════════════════════════
//  src/legal/types.ts
//
//  Types for the NEXPEC legal-document system (Checkpoint 4 of the
//  Production Hardening Mandate's Legal Architecture stream).
//
//  This module mirrors the SQL schema in
//  supabase/migrations/20260513120000_create_legal_documents.sql and the
//  source-of-truth markdown files in /legal/v1/.
// ════════════════════════════════════════════════════════════════════════════

export type LegalDocumentId =
  // ───── Tier-1 Platform ─────
  | 'TOS-001'
  | 'PRIV-001'
  | 'AUP-001'
  // ───── Tier-2 Role ─────
  | 'INSP-AGR-001'
  | 'AGN-AGR-001'
  | 'CLI-AGR-001'
  | 'ORG-AGR-001'
  // ───── Tier-3 Per-Job ─────
  | 'JOB-TPL-001'
  | 'ESCROW-001'
  // ───── Framework + Country Addenda ─────
  | 'ADDENDUM-FRAMEWORK-001'
  | 'ADDENDUM-CA-001'
  | 'ADDENDUM-EU-001'
  | 'ADDENDUM-UK-001'
  | 'ADDENDUM-US-001'
  | 'ADDENDUM-GCC-001'
  | 'ADDENDUM-JP-001'
  | 'ADDENDUM-KR-001'
  | 'ADDENDUM-IN-001'
  | 'ADDENDUM-CN-001'
  // ───── Enterprise Templates ─────
  | 'DPA-001'
  | 'ORDER-FORM-001';

/** 0 = Framework, 1 = Platform-level, 2 = Role agreement, 3 = Per-Job */
export type LegalDocumentTier = 0 | 1 | 2 | 3;

export type LegalUserRole = 'inspector' | 'agency' | 'client' | 'organization';

export type LegalDocumentStatus = 'draft' | 'active' | 'superseded';

export type LegalLanguage = 'en' | 'fr' | 'es' | 'ar';

export interface LegalDocumentRef {
  id: LegalDocumentId;
  version: string;
}

export interface LegalDocument {
  id: LegalDocumentId;
  version: string;
  language: LegalLanguage;
  title: string;
  tier: LegalDocumentTier;
  /** Null = universal; otherwise the role this Tier-2 agreement binds. */
  role: LegalUserRole | null;
  plainEnglishSummary: string;
  bodyMd: string;
  incorporates: LegalDocumentRef[];
  status: LegalDocumentStatus;
  effectiveDate: string | null;
  /**
   * Overrides the default tier-derived category label in card meta rows
   * and the viewer pill (e.g., "Country Addendum" for the CA/EU/etc.
   * overlays instead of the generic "Framework" label).
   */
  displayCategoryOverride?: string;
  /**
   * For Country Addenda: the activation status. `active` = applicable
   * via trigger logic. `draft` = drafted but business actions pending
   * (EU Rep, KSA NDMO, etc.). `scaffold-only` = not for activation
   * (e.g., CN — signup-gated by marketGating.ts).
   */
  activationStatus?: 'active' | 'draft' | 'scaffold-only';
}

export interface LegalDocumentAcceptance {
  id: string;
  userId: string;
  documentId: LegalDocumentId;
  documentVersion: string;
  language: LegalLanguage;
  acceptedAt: string;
  roleAtAcceptance: LegalUserRole | null;
}

/**
 * Aggregated stack of documents resolved for a user's role at runtime.
 * Drives the Profile-tab section lists.
 */
export interface ResolvedLegalStack {
  termsPrivacy: LegalDocument[];        // Tier-1 viewer surface
  legalCompliance: LegalDocument[];     // AUP + role agreement + framework
  jobContractReference: LegalDocument[]; // JOB-TPL + ESCROW reference docs
  countryAddenda: LegalDocument[];      // 9 country-specific overlays
  enterpriseDocuments: LegalDocument[]; // DPA + Order Form (org users only)
}
