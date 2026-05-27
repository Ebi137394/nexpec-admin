// ════════════════════════════════════════════════════════════════════════════
//  lib/data/procurement.types.ts — Procurement Control Plane shapes
//
//  Web-side types for the budget-envelope + approval-workflow surface.
//  Most shapes re-export from @nexpec/shared-core so mobile and web read
//  the same definitions. Web-only convenience types (display projections,
//  hydrated joins) live here.
// ════════════════════════════════════════════════════════════════════════════

export type {
  ApprovalEvaluation,
  BudgetCheckResult,
  PendingApprovalRow,
} from '@nexpec/shared-core';

/** A row of `approval_policies` hydrated with the scope-dept name. */
export interface ApprovalPolicyRow {
  id: string;
  org_id: string;
  name: string;
  min_amount_cents: number;
  /** null = unbounded above. */
  max_amount_cents: number | null;
  currency: string;
  required_approver_roles: string[];
  min_approvers_count: number;
  requires_sod: boolean;
  scope_department_id: string | null;
  scope_department_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A row of `department_budgets` hydrated with consumption + dept name. */
export interface DepartmentBudgetRow {
  id: string;
  org_id: string;
  department_id: string | null;
  department_name: string | null;
  fiscal_period_start: string;
  fiscal_period_end: string;
  currency: string;
  allocated_cents: number;
  /** Computed lazily by check_department_budget. */
  committed_cents: number | null;
  /** Same — null until the check ran. */
  paid_cents: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Approval-request detail with the decisions already joined. */
export interface ApprovalRequestDetail {
  id: string;
  org_id: string;
  job_id: string;
  job_title: string;
  department_id: string | null;
  department_name: string | null;
  cost_center: string | null;
  requested_by: string;
  requested_by_label: string;
  requested_at: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'superseded';
  min_approvers_required: number;
  required_approver_roles: string[];
  requires_sod: boolean;
  decisions: ApprovalDecisionRow[];
}

export interface ApprovalDecisionRow {
  id: string;
  approval_request_id: string;
  decided_by: string;
  decided_by_label: string;
  decided_at: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decider_role_at_time: string | null;
}
