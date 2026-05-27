// ════════════════════════════════════════════════════════════════════════════
//  lib/data/procurement.ts — Server-side fetchers for the PCP surface
//
//  All routes through SECURITY DEFINER RPCs or RLS-gated tables. None of
//  these read the database directly; we either call the RPC contract (so
//  authorization happens server-side) or rely on the read RLS policy.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ApprovalEvaluation,
  BudgetCheckResult,
  PendingApprovalRow,
} from '@nexpec/shared-core';
import type {
  ApprovalPolicyRow,
  ApprovalRequestDetail,
  ApprovalDecisionRow,
  DepartmentBudgetRow,
} from './procurement.types';

export type {
  ApprovalEvaluation,
  BudgetCheckResult,
  PendingApprovalRow,
  ApprovalPolicyRow,
  ApprovalRequestDetail,
  ApprovalDecisionRow,
  DepartmentBudgetRow,
};

const RPC_MISSING_RE = /function .* does not exist|relation .* does not exist/i;

/**
 * Decide whether a candidate job needs an approval gate. Called by
 * createJob before insert. Mobile equivalent calls the same RPC.
 */
export async function evaluateJobForApproval(args: {
  orgId: string;
  departmentId: string;
  amountCents: number;
  currency: string;
}): Promise<ApprovalEvaluation> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('evaluate_job_for_approval', {
    p_org_id: args.orgId,
    p_department_id: args.departmentId,
    p_amount_cents: args.amountCents,
    p_currency: args.currency,
  });
  if (error) {
    if (RPC_MISSING_RE.test(error.message ?? '')) {
      // PCP not installed yet → degrade to "no gate" so existing flows survive.
      return { ok: true, requires_approval: false, reason: 'pcp_not_installed' };
    }
    console.warn('[procurement] evaluate_job_for_approval failed:', error.message);
    return { ok: false, requires_approval: false, reason: 'rpc_error' };
  }
  return (data as unknown as ApprovalEvaluation) ?? {
    ok: true,
    requires_approval: false,
  };
}

/**
 * Snapshot the budget for a department + fiscal-period that contains today.
 * Used by the budget envelopes list page.
 */
export async function checkDepartmentBudget(
  departmentId: string,
  additionalCents = 0,
  additionalCurrency: string | null = null,
): Promise<BudgetCheckResult | null> {
  if (!departmentId) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('check_department_budget', {
    p_department_id: departmentId,
    p_as_of: new Date().toISOString().slice(0, 10),
    p_additional_cents: additionalCents,
    p_additional_currency: additionalCurrency,
  });
  if (error) {
    if (!RPC_MISSING_RE.test(error.message ?? '')) {
      console.warn('[procurement] check_department_budget failed:', error.message);
    }
    return null;
  }
  return (data as unknown as BudgetCheckResult) ?? null;
}

/**
 * The approver-dashboard feed. Already SoD-filtered + role-filtered server-side.
 */
export async function fetchMyPendingApprovals(): Promise<PendingApprovalRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('fetch_my_pending_approvals');
  if (error) {
    if (!RPC_MISSING_RE.test(error.message ?? '')) {
      console.warn('[procurement] fetch_my_pending_approvals failed:', error.message);
    }
    return [];
  }
  return (data as unknown as PendingApprovalRow[]) ?? [];
}

/**
 * List policies for the policy-editor page. RLS-gated read — org members
 * + Platform Owner only.
 */
export async function fetchApprovalPolicies(
  orgId: string,
): Promise<ApprovalPolicyRow[]> {
  if (!orgId) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('approval_policies')
    .select(
      `
      id, org_id, name, min_amount_cents, max_amount_cents, currency,
      required_approver_roles, min_approvers_count, requires_sod,
      scope_department_id, is_active, created_at, updated_at,
      departments:scope_department_id ( name )
    `,
    )
    .eq('org_id', orgId)
    .order('is_active', { ascending: false })
    .order('currency', { ascending: true })
    .order('min_amount_cents', { ascending: true });

  if (error) {
    if (!RPC_MISSING_RE.test(error.message ?? '')) {
      console.warn('[procurement] fetchApprovalPolicies failed:', error.message);
    }
    return [];
  }
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(
    (r) => {
      const dept = (r.departments ?? null) as { name?: string | null } | null;
      return {
        id: String(r.id),
        org_id: String(r.org_id),
        name: String(r.name ?? ''),
        min_amount_cents: Number(r.min_amount_cents ?? 0),
        max_amount_cents:
          r.max_amount_cents === null
            ? null
            : Number(r.max_amount_cents),
        currency: String(r.currency ?? 'USD'),
        required_approver_roles: Array.isArray(r.required_approver_roles)
          ? (r.required_approver_roles as string[])
          : [],
        min_approvers_count: Number(r.min_approvers_count ?? 1),
        requires_sod: Boolean(r.requires_sod),
        scope_department_id: (r.scope_department_id as string | null) ?? null,
        scope_department_name: dept?.name ?? null,
        is_active: Boolean(r.is_active),
        created_at: String(r.created_at ?? ''),
        updated_at: String(r.updated_at ?? ''),
      } satisfies ApprovalPolicyRow;
    },
  );
}

/**
 * List budgets for the envelopes page. Consumption is hydrated by calling
 * check_department_budget per row (small N — at most one budget per dept
 * per period).
 */
export async function fetchDepartmentBudgets(
  orgId: string,
): Promise<DepartmentBudgetRow[]> {
  if (!orgId) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('department_budgets')
    .select(
      `
      id, org_id, department_id, fiscal_period_start, fiscal_period_end,
      currency, allocated_cents, notes, created_by, created_at, updated_at,
      departments:department_id ( name )
    `,
    )
    .eq('org_id', orgId)
    .order('fiscal_period_start', { ascending: false });

  if (error) {
    if (!RPC_MISSING_RE.test(error.message ?? '')) {
      console.warn('[procurement] fetchDepartmentBudgets failed:', error.message);
    }
    return [];
  }

  const rows: DepartmentBudgetRow[] = (
    (data ?? []) as unknown as Array<Record<string, unknown>>
  ).map((r) => {
    const dept = (r.departments ?? null) as { name?: string | null } | null;
    return {
      id: String(r.id),
      org_id: String(r.org_id),
      department_id: (r.department_id as string | null) ?? null,
      department_name: dept?.name ?? null,
      fiscal_period_start: String(r.fiscal_period_start ?? ''),
      fiscal_period_end: String(r.fiscal_period_end ?? ''),
      currency: String(r.currency ?? 'USD'),
      allocated_cents: Number(r.allocated_cents ?? 0),
      committed_cents: null as number | null,
      paid_cents: null as number | null,
      notes: (r.notes as string | null) ?? null,
      created_by: (r.created_by as string | null) ?? null,
      created_at: String(r.created_at ?? ''),
      updated_at: String(r.updated_at ?? ''),
    };
  });

  // Hydrate consumption per budget row.
  const today = new Date();
  await Promise.all(
    rows.map(async (row) => {
      if (!row.department_id) return;
      const periodStart = new Date(row.fiscal_period_start);
      const periodEnd = new Date(row.fiscal_period_end);
      if (today < periodStart || today >= periodEnd) {
        // Out-of-period — committed/paid stays null (UI shows "—")
        return;
      }
      const check = await checkDepartmentBudget(row.department_id, 0, null);
      if (check?.has_budget) {
        row.committed_cents = check.committed_cents ?? 0;
        row.paid_cents = check.paid_cents ?? 0;
      }
    }),
  );

  return rows;
}

/**
 * Hydrate one approval request (status detail page or post-submit
 * confirmation). RLS lets the requester + org members + Platform Owner
 * read; non-applicable callers get null.
 */
export async function fetchApprovalRequestForJob(
  jobId: string,
): Promise<ApprovalRequestDetail | null> {
  if (!jobId) return null;
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase
    .from('approval_requests')
    .select(
      `
      id, org_id, job_id, department_id, requested_by, requested_at,
      amount_cents, currency, status, min_approvers_required,
      required_approver_roles, requires_sod,
      jobs:job_id ( title ),
      departments:department_id ( name, cost_center ),
      profiles:requested_by ( full_name, email )
    `,
    )
    .eq('job_id', jobId)
    .maybeSingle();

  if (error || !row) {
    if (error && !RPC_MISSING_RE.test(error.message ?? '')) {
      console.warn('[procurement] fetchApprovalRequestForJob failed:', error.message);
    }
    return null;
  }

  const r = row as unknown as Record<string, unknown>;
  const job = (r.jobs ?? null) as { title?: string | null } | null;
  const dept = (r.departments ?? null) as
    | { name?: string | null; cost_center?: string | null }
    | null;
  const requester = (r.profiles ?? null) as
    | { full_name?: string | null; email?: string | null }
    | null;

  // Hydrate decisions.
  const { data: decRows } = await supabase
    .from('approval_decisions')
    .select(
      `
      id, approval_request_id, decided_by, decided_at, decision, comment,
      decider_role_at_time,
      profiles:decided_by ( full_name, email )
    `,
    )
    .eq('approval_request_id', String(r.id))
    .order('decided_at', { ascending: true });

  const decisions: ApprovalDecisionRow[] = (
    (decRows ?? []) as unknown as Array<Record<string, unknown>>
  ).map((d) => {
    const decider = (d.profiles ?? null) as
      | { full_name?: string | null; email?: string | null }
      | null;
    return {
      id: String(d.id),
      approval_request_id: String(d.approval_request_id),
      decided_by: String(d.decided_by),
      decided_by_label:
        decider?.full_name?.trim() || decider?.email || 'Unknown',
      decided_at: String(d.decided_at),
      decision: d.decision as 'approved' | 'rejected',
      comment: (d.comment as string | null) ?? null,
      decider_role_at_time: (d.decider_role_at_time as string | null) ?? null,
    };
  });

  return {
    id: String(r.id),
    org_id: String(r.org_id),
    job_id: String(r.job_id),
    job_title: String(job?.title ?? '(untitled job)'),
    department_id: (r.department_id as string | null) ?? null,
    department_name: dept?.name ?? null,
    cost_center: dept?.cost_center ?? null,
    requested_by: String(r.requested_by),
    requested_by_label:
      requester?.full_name?.trim() || requester?.email || 'Unknown',
    requested_at: String(r.requested_at),
    amount_cents: Number(r.amount_cents ?? 0),
    currency: String(r.currency ?? 'USD'),
    status: r.status as ApprovalRequestDetail['status'],
    min_approvers_required: Number(r.min_approvers_required ?? 1),
    required_approver_roles: Array.isArray(r.required_approver_roles)
      ? (r.required_approver_roles as string[])
      : [],
    requires_sod: Boolean(r.requires_sod),
    decisions,
  };
}
