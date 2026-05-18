// ════════════════════════════════════════════════════════════════════════════
//  lib/data/contracts.types.ts
// ════════════════════════════════════════════════════════════════════════════

export const CONTRACT_KINDS = [
  'msa',
  'dpa',
  'amendment',
  'order_form',
  'nda',
  'other',
] as const;

export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  msa: 'Master Services Agreement',
  dpa: 'Data Processing Addendum',
  amendment: 'Amendment',
  order_form: 'Order form',
  nda: 'NDA',
  other: 'Other',
};

export type ContractSource = 'inline' | 'upload' | 'external_url';

export interface Contract {
  id: string;
  kind: ContractKind;
  title: string;
  bodyMd: string;
  pdfPath: string | null;
  pdfUrl: string | null; // signed at fetch time
  externalUrl: string | null;
  source: ContractSource;
  version: number;
  effectiveFrom: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface ContractAssignment {
  id: string;
  contractId: string;
  contractTitle: string | null;
  contractKind: ContractKind | null;
  partyId: string;
  required: boolean;
  signedAt: string | null;
  signerTypedName: string | null;
  createdAt: string;
}
