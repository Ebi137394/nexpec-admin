// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobClauses.types.ts
// ════════════════════════════════════════════════════════════════════════════

export const CLAUSE_KINDS = [
  'nda',
  'exclusivity',
  'safety',
  'indemnification',
  'data_handling',
  'compliance',
  'other',
] as const;

export type ClauseKind = (typeof CLAUSE_KINDS)[number];

export const CLAUSE_KIND_LABELS: Record<ClauseKind, string> = {
  nda: 'NDA',
  exclusivity: 'Exclusivity',
  safety: 'Safety',
  indemnification: 'Indemnification',
  data_handling: 'Data handling',
  compliance: 'Regulatory compliance',
  other: 'Other',
};

export interface JobClause {
  id: string;
  jobId: string;
  kind: ClauseKind;
  title: string;
  body: string;
  isRequired: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClauseAcceptance {
  id: string;
  clauseId: string;
  acceptorId: string;
  acceptedAt: string;
}
