// ════════════════════════════════════════════════════════════════════════════
//  lib/data/scopeTemplates.types.ts — admin-curated compliance scope library
//
//  Source of truth: public.inspection_scope_templates (compliance_mode_
//  foundation.sql). The web client uses these to populate the "Scope
//  template" picker on a compliance-mode job post.
// ════════════════════════════════════════════════════════════════════════════

export type CciCredentialTier = 'cci_basic' | 'cci_advanced' | 'cci_lead';

export type InspectionTypeKind = 'quality' | 'compliance';

export interface ScopeTemplate {
  id: string;
  slug: string;
  name: string;
  category: string;
  region: string;
  validityMonths: number;
  basePriceCents: number;
  requiresCredentialTier: CciCredentialTier;
  description: string | null;
  isActive: boolean;
}

export const CCI_TIER_LABELS: Record<CciCredentialTier, string> = {
  cci_basic: 'CCI · Basic',
  cci_advanced: 'CCI · Advanced',
  cci_lead: 'CCI · Lead',
};
