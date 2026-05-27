'use server';

// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/procurement.ts — server actions for the Procurement Control Plane
//
//  Four mutating actions, each backed by a SECURITY DEFINER RPC. All
//  validation runs through the shared-core zod schemas so mobile and
//  web validate identically. Every action returns ActionResult<T>.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  cancelJobApprovalInput,
  setApprovalPolicyInput,
  setDepartmentBudgetInput,
  submitJobApprovalInput,
  type OrgMemberRole,
} from '@nexpec/shared-core';

export interface ActionResult<TPayload = Record<string, unknown>> {
  ok: boolean;
  error: string | null;
  payload?: TPayload;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/* ─── evaluateJobForApprovalAction ──────────────────────────────────
 *
 * Thin wrapper around the evaluate_job_for_approval RPC so the
 * job-post form's live preview component can call it via useTransition
 * without a separate API route. Read-only; no revalidation needed.
 */

import { evaluateJobForApprovalInput } from '@nexpec/shared-core';
import type { ApprovalEvaluation } from '@nexpec/shared-core';

export interface EvaluateJobForApprovalActionInput {
  orgId: string;
  departmentId: string;
  amountCents: number;
  currency: string;
}

export async function evaluateJobForApprovalAction(
  input: EvaluateJobForApprovalActionInput,
): Promise<ActionResult<ApprovalEvaluation>> {
  const parsed = evaluateJobForApprovalInput.safeParse({
    p_org_id: input.orgId,
    p_department_id: input.departmentId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('evaluate_job_for_approval', parsed.data);
  if (error) {
    if (/function .* does not exist/i.test(error.message ?? '')) {
      // PCP not installed in this env — degrade silently.
      return {
        ok: true,
        error: null,
        payload: { ok: true, requires_approval: false, reason: 'pcp_not_installed' } as ApprovalEvaluation,
      };
    }
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    error: null,
    payload: (data as unknown as ApprovalEvaluation) ?? {
      ok: true,
      requires_approval: false,
    },
  };
}

/* ─── submitJobApprovalAction ───────────────────────────────────────── */

export interface SubmitJobApprovalActionInput {
  jobId: string;
  decision: 'approved' | 'rejected';
  comment?: string | null;
}

export async function submitJobApprovalAction(
  input: SubmitJobApprovalActionInput,
): Promise<ActionResult<{ request_id: string; final: string }>> {
  const parsed = submitJobApprovalInput.safeParse({
    p_job_id: input.jobId,
    p_decision: input.decision,
    p_comment: input.comment ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('submit_job_approval', parsed.data);
  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    request_id?: string;
    final?: string;
  };
  if (!result.ok) {
    return { ok: false, error: 'submit_job_approval returned a non-ok response.' };
  }

  revalidatePath('/client/approvals');
  revalidatePath('/client/jobs');
  revalidatePath(`/client/jobs/${input.jobId}`);
  revalidatePath('/admin/jobs');

  return {
    ok: true,
    error: null,
    payload: {
      request_id: result.request_id ?? '',
      final: result.final ?? 'pending',
    },
  };
}

/* ─── cancelJobApprovalAction ───────────────────────────────────────── */

export interface CancelJobApprovalActionInput {
  jobId: string;
  reason: string;
}

export async function cancelJobApprovalAction(
  input: CancelJobApprovalActionInput,
): Promise<ActionResult<{ request_id: string }>> {
  const parsed = cancelJobApprovalInput.safeParse({
    p_job_id: input.jobId,
    p_reason: input.reason,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('cancel_job_approval', parsed.data);
  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean; request_id?: string };
  if (!result.ok) {
    return { ok: false, error: 'cancel_job_approval returned a non-ok response.' };
  }

  revalidatePath('/client/approvals');
  revalidatePath('/client/jobs');
  revalidatePath(`/client/jobs/${input.jobId}`);

  return {
    ok: true,
    error: null,
    payload: { request_id: result.request_id ?? '' },
  };
}

/* ─── setDepartmentBudgetAction ─────────────────────────────────────── */

export interface SetDepartmentBudgetActionInput {
  departmentId: string;
  fiscalPeriodStart: string;
  fiscalPeriodEnd: string;
  currency: string;
  allocatedCents: number;
  notes?: string | null;
}

export async function setDepartmentBudgetAction(
  input: SetDepartmentBudgetActionInput,
): Promise<ActionResult<{ budget_id: string }>> {
  const parsed = setDepartmentBudgetInput.safeParse({
    p_department_id: input.departmentId,
    p_fiscal_period_start: input.fiscalPeriodStart,
    p_fiscal_period_end: input.fiscalPeriodEnd,
    p_currency: input.currency,
    p_allocated_cents: input.allocatedCents,
    p_notes: input.notes ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('set_department_budget', parsed.data);
  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean; budget_id?: string };
  if (!result.ok) {
    return { ok: false, error: 'set_department_budget returned a non-ok response.' };
  }

  revalidatePath('/client/budget/envelopes');
  revalidatePath('/client/budget');
  revalidatePath('/admin/budget');

  return {
    ok: true,
    error: null,
    payload: { budget_id: result.budget_id ?? '' },
  };
}

/* ─── setApprovalPolicyAction ───────────────────────────────────────── */

export interface SetApprovalPolicyActionInput {
  orgId: string;
  name: string;
  minAmountCents: number;
  maxAmountCents: number | null;
  currency: string;
  requiredApproverRoles: OrgMemberRole[];
  minApproversCount: number;
  requiresSod: boolean;
  scopeDepartmentId?: string | null;
  isActive: boolean;
  id?: string | null;
}

export async function setApprovalPolicyAction(
  input: SetApprovalPolicyActionInput,
): Promise<ActionResult<{ policy_id: string }>> {
  const parsed = setApprovalPolicyInput.safeParse({
    p_org_id: input.orgId,
    p_name: input.name,
    p_min_amount_cents: input.minAmountCents,
    p_max_amount_cents: input.maxAmountCents,
    p_currency: input.currency,
    p_required_approver_roles: input.requiredApproverRoles,
    p_min_approvers_count: input.minApproversCount,
    p_requires_sod: input.requiresSod,
    p_scope_department_id: input.scopeDepartmentId ?? null,
    p_is_active: input.isActive,
    p_id: input.id ?? null,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('set_approval_policy', parsed.data);
  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean; policy_id?: string };
  if (!result.ok) {
    return { ok: false, error: 'set_approval_policy returned a non-ok response.' };
  }

  revalidatePath('/client/budget/policies');
  revalidatePath('/client/approvals');
  return {
    ok: true,
    error: null,
    payload: { policy_id: result.policy_id ?? '' },
  };
}

/* ─── togglePolicyActiveAction (convenience) ─────────────────────────── */

export async function togglePolicyActiveAction(input: {
  orgId: string;
  policyId: string;
  isActive: boolean;
}): Promise<ActionResult<{ policy_id: string }>> {
  if (!isUuid(input.orgId) || !isUuid(input.policyId)) {
    return { ok: false, error: 'Invalid identifier.' };
  }

  const supabase = await createSupabaseServerClient();

  // Fetch the existing row so we have all the fields the RPC expects.
  const { data: row, error: fetchErr } = await supabase
    .from('approval_policies')
    .select(
      'name, min_amount_cents, max_amount_cents, currency, required_approver_roles, min_approvers_count, requires_sod, scope_department_id',
    )
    .eq('id', input.policyId)
    .eq('org_id', input.orgId)
    .maybeSingle();

  if (fetchErr || !row) {
    return { ok: false, error: 'Policy not found.' };
  }

  return setApprovalPolicyAction({
    orgId: input.orgId,
    id: input.policyId,
    name: String(row.name),
    minAmountCents: Number(row.min_amount_cents),
    maxAmountCents:
      row.max_amount_cents === null ? null : Number(row.max_amount_cents),
    currency: String(row.currency),
    requiredApproverRoles: row.required_approver_roles as OrgMemberRole[],
    minApproversCount: Number(row.min_approvers_count),
    requiresSod: Boolean(row.requires_sod),
    scopeDepartmentId: (row.scope_department_id as string | null) ?? null,
    isActive: input.isActive,
  });
}
