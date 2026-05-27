// ════════════════════════════════════════════════════════════════════════════
//  schemas/organizations.ts — org seat mutation inputs
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

export const ORG_MEMBER_ROLES = [
  'owner',
  'procurement_admin',
  'project_lead',
  'viewer',
] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const adminInviteOrgMemberInput = z.object({
  p_org_id: uuid,
  p_email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'Enter a valid email address.' }),
  p_role: z.enum(ORG_MEMBER_ROLES),
});
export type AdminInviteOrgMemberInput = z.infer<typeof adminInviteOrgMemberInput>;

export const adminUpdateOrgMemberRoleInput = z.object({
  p_member_id: uuid,
  p_role: z.enum(ORG_MEMBER_ROLES),
});
export type AdminUpdateOrgMemberRoleInput = z.infer<
  typeof adminUpdateOrgMemberRoleInput
>;

export const adminRemoveOrgMemberInput = z.object({
  p_member_id: uuid,
  p_reason: z
    .string()
    .trim()
    .min(1, { message: 'A reason is required for member removal.' })
    .max(1000),
});
export type AdminRemoveOrgMemberInput = z.infer<typeof adminRemoveOrgMemberInput>;

// ════════════════════════════════════════════════════════════════════════════
//  ACTIVE-ORG SWITCHER (Sprint 6, omnichannel)
//
//  Shapes used by both the Next.js web app and the Expo/RN mobile app to
//  drive the per-user "active organization context". Pinned on
//  profiles.active_org_id; mutated through set_active_org RPC; read in
//  bulk through fetch_my_org_memberships RPC.
// ════════════════════════════════════════════════════════════════════════════

/** Input for the set_active_org RPC. */
export const setActiveOrgInput = z.object({
  p_org_id: uuid,
});
export type SetActiveOrgInput = z.infer<typeof setActiveOrgInput>;

/**
 * What set_active_org returns. The web/mobile dropdowns can render the
 * new active org optimistically from this payload without a follow-up
 * read.
 */
export const setActiveOrgResultSchema = z.object({
  ok: z.literal(true),
  active_org_id: uuid,
  org_name: z.string(),
  org_slug: z.string().nullable(),
  org_kind: z.string(),
  role: z.string().nullable(),
  correlation_id: uuid.optional(),
});
export type SetActiveOrgResult = z.infer<typeof setActiveOrgResultSchema>;

/**
 * One row from fetch_my_org_memberships(). Used by the workspace
 * switcher dropdown. Cross-platform; mobile and web both map this to
 * their respective list rows.
 */
export const orgMembershipEntrySchema = z.object({
  org_id: uuid,
  org_name: z.string(),
  org_slug: z.string().nullable(),
  org_kind: z.string(),
  org_logo_url: z.string().nullable(),
  is_active_org: z.boolean(),
  role: z.enum(ORG_MEMBER_ROLES).nullable(),
  member_since: z.string().nullable(),
});
export type OrgMembershipEntry = z.infer<typeof orgMembershipEntrySchema>;

/**
 * Aggregate shape consumed by the switcher UI. `active` is the entry
 * marked is_active_org=true (or null when the user has no memberships
 * or hasn't selected one and the election rule hasn't run yet).
 */
export interface ActiveOrgInfo {
  active: OrgMembershipEntry | null;
  memberships: ReadonlyArray<OrgMembershipEntry>;
}

/**
 * The four "elevated" org roles whose holders can mutate department
 * structure and reassign invoices. Mirrors can_manage_org_structure in
 * the database. Mobile + web both reference this list when deciding
 * whether to render edit affordances client-side.
 *
 * Kept here (rather than as a separate enum) so a future role addition
 * touches exactly one file across the whole codebase.
 */
export const ELEVATED_ORG_ROLES = ['owner', 'procurement_admin'] as const;
export type ElevatedOrgRole = (typeof ELEVATED_ORG_ROLES)[number];

export function isElevatedOrgRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ELEVATED_ORG_ROLES as ReadonlyArray<string>).includes(role);
}

// ════════════════════════════════════════════════════════════════════════════
//  MULTI-CURRENCY (Sprint 7, omnichannel)
//
//  Single source of truth for which currencies NEXPEC supports. Mirrored
//  in the database as the `public.currency_code` ENUM — adding a new
//  currency requires both this constant and an `ALTER TYPE ADD VALUE`
//  migration. Validation in this package keeps the web and mobile UIs
//  from offering currencies the DB can't store.
// ════════════════════════════════════════════════════════════════════════════

export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'AED',
  'CAD',
  'AUD',
  'SGD',
  'CHF',
  'JPY',
] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(
  code: string | null | undefined,
): code is CurrencyCode {
  if (!code) return false;
  return (SUPPORTED_CURRENCIES as ReadonlyArray<string>).includes(code);
}

/** Human-readable label for each supported currency. */
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  AED: 'UAE Dirham',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  SGD: 'Singapore Dollar',
  CHF: 'Swiss Franc',
  JPY: 'Japanese Yen',
};

/** Native currency symbol when available. Falls back to the code itself. */
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  CAD: 'CA$',
  AUD: 'A$',
  SGD: 'S$',
  CHF: 'CHF',
  JPY: '¥',
};

/** Input shape for set_org_base_currency RPC. */
export const setOrgBaseCurrencyInput = z.object({
  p_org_id: uuid,
  p_currency: z.enum(SUPPORTED_CURRENCIES),
});
export type SetOrgBaseCurrencyInput = z.infer<typeof setOrgBaseCurrencyInput>;

/** Input shape for upsert_fx_rate RPC (Platform Owner only). */
export const upsertFxRateInput = z.object({
  p_base_currency: z.enum(SUPPORTED_CURRENCIES),
  p_quote_currency: z.enum(SUPPORTED_CURRENCIES),
  p_rate: z.number().positive(),
  p_effective_date: z.string().optional(),
  p_source: z.string().optional(),
});
export type UpsertFxRateInput = z.infer<typeof upsertFxRateInput>;

// ════════════════════════════════════════════════════════════════════════════
//  PROCUREMENT CONTROL PLANE (Sprint 8)
//
//  Pre-authorization budget gates + multi-tier approval workflows with
//  schema-enforced Segregation of Duties. Schemas validate every RPC
//  input across web and mobile so the two surfaces cannot drift.
// ════════════════════════════════════════════════════════════════════════════

/** evaluate_job_for_approval input. */
export const evaluateJobForApprovalInput = z.object({
  p_org_id: uuid,
  p_department_id: uuid,
  p_amount_cents: z.number().int().nonnegative(),
  p_currency: z.enum(SUPPORTED_CURRENCIES),
});
export type EvaluateJobForApprovalInput = z.infer<
  typeof evaluateJobForApprovalInput
>;

/** open_job_approval_request input. */
export const openJobApprovalRequestInput = z.object({
  p_job_id: uuid,
  p_policy_id: uuid,
  p_amount_cents: z.number().int().nonnegative(),
  p_currency: z.enum(SUPPORTED_CURRENCIES),
  p_min_approvers_required: z.number().int().min(1).max(10),
  p_required_approver_roles: z
    .array(z.enum(ORG_MEMBER_ROLES))
    .min(1, { message: 'At least one approver role required.' }),
  p_requires_sod: z.boolean().default(true),
});
export type OpenJobApprovalRequestInput = z.infer<
  typeof openJobApprovalRequestInput
>;

/** submit_job_approval input. */
export const submitJobApprovalInput = z.object({
  p_job_id: uuid,
  p_decision: z.enum(['approved', 'rejected']),
  p_comment: z.string().trim().max(1000).optional(),
});
export type SubmitJobApprovalInput = z.infer<typeof submitJobApprovalInput>;

/** cancel_job_approval input. */
export const cancelJobApprovalInput = z.object({
  p_job_id: uuid,
  p_reason: z.string().trim().min(1).max(500),
});
export type CancelJobApprovalInput = z.infer<typeof cancelJobApprovalInput>;

/** set_department_budget input. */
export const setDepartmentBudgetInput = z.object({
  p_department_id: uuid,
  p_fiscal_period_start: z.string(),
  p_fiscal_period_end: z.string(),
  p_currency: z.enum(SUPPORTED_CURRENCIES),
  p_allocated_cents: z.number().int().nonnegative(),
  p_notes: z.string().trim().max(2000).optional().nullable(),
});
export type SetDepartmentBudgetInput = z.infer<
  typeof setDepartmentBudgetInput
>;

/** set_approval_policy input. */
export const setApprovalPolicyInput = z.object({
  p_org_id: uuid,
  p_name: z.string().trim().min(1).max(120),
  p_min_amount_cents: z.number().int().nonnegative(),
  p_max_amount_cents: z.number().int().positive().nullable(),
  p_currency: z.enum(SUPPORTED_CURRENCIES),
  p_required_approver_roles: z.array(z.enum(ORG_MEMBER_ROLES)).min(1),
  p_min_approvers_count: z.number().int().min(1).max(10).default(1),
  p_requires_sod: z.boolean().default(true),
  p_scope_department_id: uuid.nullable().optional(),
  p_is_active: z.boolean().default(true),
  p_id: uuid.nullable().optional(),
});
export type SetApprovalPolicyInput = z.infer<typeof setApprovalPolicyInput>;

/**
 * Result of evaluate_job_for_approval. Drives whether createJob inserts
 * with status='open' (auto-post) or status='pending_approval' (gated).
 */
export interface ApprovalEvaluation {
  ok: boolean;
  requires_approval: boolean;
  reason?: string;
  policy_id?: string;
  policy_name?: string;
  policy_currency?: string;
  amount_in_policy_ccy?: number;
  required_approver_roles?: OrgMemberRole[];
  min_approvers_count?: number;
  requires_sod?: boolean;
  scope_department_id?: string | null;
  budget?: BudgetCheckResult;
}

/** Result of check_department_budget. */
export interface BudgetCheckResult {
  ok: boolean;
  has_budget: boolean;
  budget_id?: string;
  department_id: string;
  org_id: string;
  currency?: string;
  period_start?: string;
  period_end?: string;
  allocated_cents?: number;
  committed_cents?: number;
  paid_cents?: number;
  available_cents?: number;
  additional_cents?: number;
  would_exceed?: boolean;
  projected_remaining?: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPLIANCE EVIDENCE LOCKER (Sprint 9)
//
//  One-button SOX-grade evidence export per job. The pack consists of:
//
//      envelope  — non-deterministic metadata (export_id, timestamps,
//                  exporting identity). NOT included in the chain-of-
//                  custody hash so re-exports produce the same root_hash.
//
//      manifest  — algorithm declaration + per-artifact SHA-256 hashes +
//                  the root_hash which is the hash of the manifest's
//                  artifacts array itself. This is what an auditor verifies.
//
//      artifacts — the raw, deterministic, canonical-JSON-serialised
//                  payload. Re-running the export against unchanged DB
//                  state must produce byte-identical artifacts.
// ════════════════════════════════════════════════════════════════════════════

/** Input for assemble_evidence_pack RPC. */
export const assembleEvidencePackInput = z.object({
  p_job_id: uuid,
});
export type AssembleEvidencePackInput = z.infer<
  typeof assembleEvidencePackInput
>;

/** The envelope — bookkeeping, never part of the chain-of-custody hash. */
export interface EvidencePackEnvelope {
  /** Locally-generated id for this specific export. Changes every call. */
  export_id: string;
  exported_at: string;
  exported_by_id: string;
  exported_by_label: string;
  exported_by_role: string;
  generator_version: string;
  platform: string;
  job_id: string;
  /** Correlation id returned by the RPC; matches the audit_events row. */
  correlation_id: string;
}

/** One artifact entry in the manifest. */
export interface EvidenceManifestEntry {
  /** Stable name (job, parties, contracts, …). */
  name: string;
  /** SHA-256 hash of the canonical-JSON serialisation of this artifact. */
  hash: string;
  /** Lower-bound integrity hint — count for arrays, 1 for objects, 0 for null. */
  count: number;
}

/** The chain-of-custody manifest. */
export interface EvidenceManifest {
  algorithm: 'SHA-256';
  artifacts: EvidenceManifestEntry[];
  /** Hash of the canonical-JSON serialisation of the artifacts array. */
  root_hash: string;
}

/** The complete pack returned to the caller and downloadable as JSON. */
export interface EvidencePack {
  envelope: EvidencePackEnvelope;
  manifest: EvidenceManifest;
  /** Same shape the RPC returns under `artifacts`. */
  artifacts: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPLIANCE COMMAND CENTER (Sprint 10)
//
//  Anomaly detection + posture summary types shared across the web
//  command-center dashboard and any future mobile / API consumers.
// ════════════════════════════════════════════════════════════════════════════

/** Severity for any anomaly detector finding. */
export type ComplianceSeverity = 'info' | 'warning' | 'critical';

/** Uniform shape every detector RPC emits. */
export interface ComplianceAnomaly {
  severity: ComplianceSeverity;
  finding: string;
  metadata: Record<string, unknown>;
  detected_at: string;
  /** Web-side tag: which detector produced this. Not in the SQL output. */
  detector?: ComplianceDetectorId;
}

/** Stable identifiers for each detector. */
export const COMPLIANCE_DETECTORS = [
  'band_evasion',
  'rubber_stamping',
  'concentration_risk',
  'quarter_end_clustering',
  'off_hours_decisions',
  'silent_overrides',
] as const;
export type ComplianceDetectorId = (typeof COMPLIANCE_DETECTORS)[number];

/** Human-readable labels + descriptions for the dashboard. */
export const COMPLIANCE_DETECTOR_META: Record<
  ComplianceDetectorId,
  { title: string; subtitle: string }
> = {
  band_evasion: {
    title: 'Band-evasion pattern',
    subtitle: 'Jobs posted just under approval thresholds',
  },
  rubber_stamping: {
    title: 'Rubber-stamping pattern',
    subtitle: 'Approval decisions with little or no substantive comment',
  },
  concentration_risk: {
    title: 'Vendor concentration',
    subtitle: 'Same inspector hired repeatedly by the same buyer',
  },
  quarter_end_clustering: {
    title: 'Quarter-end clustering',
    subtitle: 'Cost-center reassignments concentrated near fiscal boundaries',
  },
  off_hours_decisions: {
    title: 'Off-hours decisions',
    subtitle: 'Approvals recorded outside business hours',
  },
  silent_overrides: {
    title: 'Silent overrides',
    subtitle: 'Audit rows missing the expected correlation id',
  },
};

/** Result shape of compliance_posture_summary. */
export interface CompliancePostureSummary {
  ok: boolean;
  org_id: string;
  window_days: number;
  attribution_coverage: {
    total: number;
    attributed: number;
    percentage: number | null;
  };
  decision_substantiveness: {
    total: number;
    substantive: number;
    percentage: number | null;
  };
  high_value_gating: {
    total: number;
    gated: number;
    percentage: number | null;
  };
  evidence_packs_90d: number;
  sod_violations_90d: number;
  band_overlap_attempts_90d: number;
  approval_latency: {
    avg_seconds: number;
    p95_seconds: number;
    pending_count: number;
    oldest_pending_seconds: number;
  };
  generated_at: string;
}

/** One row from fetch_my_pending_approvals. */
export interface PendingApprovalRow {
  request_id: string;
  job_id: string;
  job_title: string;
  org_id: string;
  org_name: string;
  department_id: string | null;
  department_name: string | null;
  cost_center: string | null;
  requested_by: string;
  requested_by_label: string;
  requested_at: string;
  amount_cents: number;
  currency: string;
  min_approvers_required: number;
  approved_count: number;
  required_approver_roles: OrgMemberRole[];
}
