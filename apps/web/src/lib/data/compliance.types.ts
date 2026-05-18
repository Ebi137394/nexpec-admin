// ════════════════════════════════════════════════════════════════════════════
//  lib/data/compliance.types.ts — type-only + pure-constant module
//  Safe to import from Client Components.
// ════════════════════════════════════════════════════════════════════════════

export type CredentialStatus =
  | 'pending'
  | 'approved'
  | 'suspended'
  | 'rejected'
  | string;

export interface ComplianceCredential {
  id: string;
  inspector_id: string | null;
  inspector_name: string | null;
  inspector_email: string | null;
  tier: string | null;
  status: CredentialStatus;
  experience_years_documented: number | null;
  gov_id_verified: boolean;
  applied_at: string | null;
  decided_at: string | null;
  decision_notes: string | null;
}

export interface ComplianceResult {
  credentials: ComplianceCredential[];
  total: number;
  totalPending: number;
  tableMissing: boolean;
}

export interface ComplianceQuery {
  status?: CredentialStatus;
}

export const CREDENTIAL_STATUSES: CredentialStatus[] = [
  'pending',
  'approved',
  'suspended',
  'rejected',
];
