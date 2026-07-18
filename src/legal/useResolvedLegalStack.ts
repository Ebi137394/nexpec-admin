// ════════════════════════════════════════════════════════════════════════════
//  src/legal/useResolvedLegalStack.ts
//
//  Role-resolution hook for the Profile-tab legal surfaces. Takes the
//  current userRole and resolves the documents that should appear in:
//    - Terms & Privacy      (Tier-1, universal: TOS-001, PRIV-001)
//    - Legal & Compliance   (AUP-001 + Tier-2 role agreement + Framework)
//    - Job Contract Refs    (JOB-TPL-001, PAYOUT-001 — read-only reference)
//
//  This mirrors the Tier-2 cross-linking map laid out in the Checkpoint 2
//  posture audit: a user activating a role transitively accepts the Tier-1
//  pack plus the role's Tier-2 agreement plus the Tier-3 riders.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { getLegalDocument } from './registry';
import type {
  LegalDocument,
  LegalUserRole,
  ResolvedLegalStack,
} from './types';

const required = (id: Parameters<typeof getLegalDocument>[0]): LegalDocument => {
  const doc = getLegalDocument(id);
  if (!doc) {
    // Surfaces a load-bearing config error early — the registry should
    // always carry every documented ID at this version.
    throw new Error(`[legal/registry] missing document: ${id}`);
  }
  return doc;
};

export function useResolvedLegalStack(
  role: LegalUserRole | null | undefined,
): ResolvedLegalStack {
  return useMemo<ResolvedLegalStack>(() => {
    // Tier-1 platform docs — universal.
    const termsPrivacy: LegalDocument[] = [
      required('TOS-001'),
      required('PRIV-001'),
    ];

    // Legal & Compliance — AUP + role-resolved Tier-2 + Framework.
    const legalCompliance: LegalDocument[] = [required('AUP-001')];

    switch (role) {
      case 'inspector':
        legalCompliance.push(required('INSP-AGR-001'));
        break;
      case 'agency':
        legalCompliance.push(required('AGN-AGR-001'));
        break;
      case 'client':
        legalCompliance.push(required('CLI-AGR-001'));
        break;
      case 'supplier':
        legalCompliance.push(required('SUP-AGR-001'));
        break;
      case 'organization':
        // Org Clients accept both CLI-AGR (in full) AND ORG-AGR layered on top.
        legalCompliance.push(required('CLI-AGR-001'));
        legalCompliance.push(required('ORG-AGR-001'));
        break;
      default:
        // Unknown / pending role — no role agreement to surface yet.
        break;
    }

    // Framework is universal and always last in Legal & Compliance.
    legalCompliance.push(required('ADDENDUM-FRAMEWORK-001'));

    // Tier-3 reference docs surfaced as "What's in your Job Contract?" cards.
    const jobContractReference: LegalDocument[] = [
      required('JOB-TPL-001'),
      required('PAYOUT-001'),
    ];

    // Country Addenda — surfaced as a separate subsection for transparency.
    // All 9 are listed; trigger-logic and signup-gating are platform-side
    // (marketGating.ts + ADDENDUM-FRAMEWORK-001 §3) and operate independently
    // of what's rendered in the section list.
    const countryAddenda: LegalDocument[] = [
      required('ADDENDUM-CA-001'),
      required('ADDENDUM-EU-001'),
      required('ADDENDUM-UK-001'),
      required('ADDENDUM-US-001'),
      required('ADDENDUM-GCC-001'),
      required('ADDENDUM-JP-001'),
      required('ADDENDUM-KR-001'),
      required('ADDENDUM-IN-001'),
      required('ADDENDUM-CN-001'),
    ];

    // Enterprise Documents — surfaced ONLY for organization role users.
    // DPA-001 is incorporated into ORG-AGR-001 §4; ORDER-FORM-001 is the
    // exhibit for ORG-AGR-001 §7 custom commercial terms.
    const enterpriseDocuments: LegalDocument[] =
      role === 'organization'
        ? [required('DPA-001'), required('ORDER-FORM-001')]
        : [];

    return {
      termsPrivacy,
      legalCompliance,
      jobContractReference,
      countryAddenda,
      enterpriseDocuments,
    };
  }, [role]);
}
