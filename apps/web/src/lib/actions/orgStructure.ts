'use server';

// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/orgStructure.ts — admin server actions for the department tree
//
//  Six actions, one per RPC in 20260526120000_enterprise_department_hierarchy:
//
//    createDepartmentAction          → public.create_department
//    renameDepartmentAction          → public.rename_department
//    moveDepartmentAction            → public.move_department
//    deleteDepartmentAction          → public.delete_department
//    assignMemberAction              → public.assign_member_to_department
//    unassignMemberAction            → public.unassign_member_from_department
//
//  Each action:
//    1. validates input with a tiny inline guard (no dependency on shared-core
//       so this slice can ship without cross-package edits),
//    2. calls the RPC,
//    3. revalidates the structure page so the server tree re-renders,
//    4. returns { ok, error, ...payload } — never throws.
//
//  Inputs come in as plain object args (called via useTransition from client
//  dialogs), not FormData, to keep the dialogs ergonomic.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchDepartmentSpendSummary,
  type DepartmentSpendSummary,
} from '@/lib/data/orgStructure';

/* ─── shared shapes ──────────────────────────────────────────────────── */

export interface ActionResult<TPayload = Record<string, unknown>> {
  ok: boolean;
  error: string | null;
  payload?: TPayload;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function clean(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function revalidate(orgId: string) {
  // Both surfaces share the same RPC layer — refresh both so a mutation
  // from /client/structure reflects on /admin and vice-versa.
  revalidatePath(`/admin/orgs/${orgId}/structure`);
  revalidatePath('/admin/orgs');
  revalidatePath('/client/structure');
}

/* ─── createDepartmentAction ─────────────────────────────────────────── */

export interface CreateDepartmentInput {
  orgId: string;
  parentDepartmentId?: string | null;
  name: string;
  costCenter?: string | null;
}

export async function createDepartmentAction(
  input: CreateDepartmentInput,
): Promise<ActionResult<{ department_id: string }>> {
  if (!isUuid(input.orgId)) return { ok: false, error: 'A valid organization id is required.' };
  if (input.parentDepartmentId != null && !isUuid(input.parentDepartmentId)) {
    return { ok: false, error: 'Parent department id is invalid.' };
  }
  const name = clean(input.name);
  if (!name) return { ok: false, error: 'Department name is required.' };
  if (name.length > 120) return { ok: false, error: 'Department name is too long (max 120).' };
  const costCenter = clean(input.costCenter ?? null);
  if (costCenter && costCenter.length > 64) {
    return { ok: false, error: 'Cost center is too long (max 64).' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_department', {
    p_org_id: input.orgId,
    p_parent_department_id: input.parentDepartmentId ?? null,
    p_name: name,
    p_cost_center: costCenter,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean; department_id?: string };
  if (!result.ok || !result.department_id) {
    return { ok: false, error: 'create_department returned a non-ok response.' };
  }

  revalidate(input.orgId);
  return { ok: true, error: null, payload: { department_id: result.department_id } };
}

/* ─── renameDepartmentAction ─────────────────────────────────────────── */

export interface RenameDepartmentInput {
  orgId: string;
  departmentId: string;
  name: string;
  costCenter?: string | null;
}

export async function renameDepartmentAction(
  input: RenameDepartmentInput,
): Promise<ActionResult<{ department_id: string }>> {
  if (!isUuid(input.orgId)) return { ok: false, error: 'A valid organization id is required.' };
  if (!isUuid(input.departmentId)) {
    return { ok: false, error: 'Department id is invalid.' };
  }
  const name = clean(input.name);
  if (!name) return { ok: false, error: 'Department name is required.' };
  if (name.length > 120) return { ok: false, error: 'Department name is too long (max 120).' };
  const costCenter = clean(input.costCenter ?? null);
  if (costCenter && costCenter.length > 64) {
    return { ok: false, error: 'Cost center is too long (max 64).' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('rename_department', {
    p_department_id: input.departmentId,
    p_name: name,
    p_cost_center: costCenter,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean };
  if (!result.ok) return { ok: false, error: 'rename_department returned a non-ok response.' };

  revalidate(input.orgId);
  return { ok: true, error: null, payload: { department_id: input.departmentId } };
}

/* ─── moveDepartmentAction ───────────────────────────────────────────── */

export interface MoveDepartmentInput {
  orgId: string;
  departmentId: string;
  /** null = promote to root */
  newParentId: string | null;
}

export async function moveDepartmentAction(
  input: MoveDepartmentInput,
): Promise<ActionResult<{ department_id: string }>> {
  if (!isUuid(input.orgId)) return { ok: false, error: 'A valid organization id is required.' };
  if (!isUuid(input.departmentId)) {
    return { ok: false, error: 'Department id is invalid.' };
  }
  if (input.newParentId != null && !isUuid(input.newParentId)) {
    return { ok: false, error: 'New parent id is invalid.' };
  }
  if (input.newParentId && input.newParentId === input.departmentId) {
    return { ok: false, error: 'A department cannot be its own parent.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('move_department', {
    p_department_id: input.departmentId,
    p_new_parent_id: input.newParentId,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean };
  if (!result.ok) return { ok: false, error: 'move_department returned a non-ok response.' };

  revalidate(input.orgId);
  return { ok: true, error: null, payload: { department_id: input.departmentId } };
}

/* ─── deleteDepartmentAction ─────────────────────────────────────────── */

export interface DeleteDepartmentInput {
  orgId: string;
  departmentId: string;
  /** Required when the department has descendants or members. */
  force?: boolean;
}

export async function deleteDepartmentAction(
  input: DeleteDepartmentInput,
): Promise<ActionResult<{ department_id: string }>> {
  if (!isUuid(input.orgId)) return { ok: false, error: 'A valid organization id is required.' };
  if (!isUuid(input.departmentId)) {
    return { ok: false, error: 'Department id is invalid.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('delete_department', {
    p_department_id: input.departmentId,
    p_force: input.force ?? false,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean };
  if (!result.ok) return { ok: false, error: 'delete_department returned a non-ok response.' };

  revalidate(input.orgId);
  return { ok: true, error: null, payload: { department_id: input.departmentId } };
}

/* ─── assignMemberAction ─────────────────────────────────────────────── */

export interface AssignMemberInput {
  orgId: string;
  departmentId: string;
  userId: string;
}

export async function assignMemberAction(
  input: AssignMemberInput,
): Promise<ActionResult<{ department_id: string; user_id: string }>> {
  if (!isUuid(input.orgId)) return { ok: false, error: 'A valid organization id is required.' };
  if (!isUuid(input.departmentId)) {
    return { ok: false, error: 'Department id is invalid.' };
  }
  if (!isUuid(input.userId)) return { ok: false, error: 'User id is invalid.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('assign_member_to_department', {
    p_department_id: input.departmentId,
    p_user_id: input.userId,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean };
  if (!result.ok) {
    return { ok: false, error: 'assign_member_to_department returned a non-ok response.' };
  }

  revalidate(input.orgId);
  return {
    ok: true,
    error: null,
    payload: { department_id: input.departmentId, user_id: input.userId },
  };
}

/* ─── unassignMemberAction ───────────────────────────────────────────── */

export type UnassignMemberInput = AssignMemberInput;

export async function unassignMemberAction(
  input: UnassignMemberInput,
): Promise<ActionResult<{ department_id: string; user_id: string }>> {
  if (!isUuid(input.orgId)) return { ok: false, error: 'A valid organization id is required.' };
  if (!isUuid(input.departmentId)) {
    return { ok: false, error: 'Department id is invalid.' };
  }
  if (!isUuid(input.userId)) return { ok: false, error: 'User id is invalid.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('unassign_member_from_department', {
    p_department_id: input.departmentId,
    p_user_id: input.userId,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { ok?: boolean };
  if (!result.ok) {
    return { ok: false, error: 'unassign_member_from_department returned a non-ok response.' };
  }

  revalidate(input.orgId);
  return {
    ok: true,
    error: null,
    payload: { department_id: input.departmentId, user_id: input.userId },
  };
}

/* ─── getDepartmentSpendSummaryAction ─────────────────────────────────
 *
 * Thin pass-through to fetchDepartmentSpendSummary so Client Components
 * (the DepartmentDetailPanel) can re-fetch when the user picks a new
 * node without round-tripping the entire page. RPC enforces auth.
 */

export async function getDepartmentSpendSummaryAction(
  departmentId: string,
): Promise<DepartmentSpendSummary | null> {
  if (!isUuid(departmentId)) return null;
  return await fetchDepartmentSpendSummary(departmentId);
}

/* ─── reassignInvoiceDepartmentAction ─────────────────────────────────
 *
 * Reclassify an invoice into a different department (or clear it).
 * Calls the SECURITY DEFINER `reassign_invoice_department` RPC which
 * enforces `can_manage_org_structure` and writes an audit_events row.
 *
 * Revalidates both invoice surfaces and both structure pages so a
 * reclassification reflects everywhere immediately.
 */

export interface ReassignInvoiceDepartmentInput {
  invoiceId: string;
  /** Null clears the attribution back to "Unattributed". */
  newDepartmentId: string | null;
  reason: string;
  /**
   * Optional. If provided, revalidate the org's admin structure page too.
   * Otherwise only the invoice/budget/client structure paths revalidate.
   */
  orgId?: string | null;
}

export async function reassignInvoiceDepartmentAction(
  input: ReassignInvoiceDepartmentInput,
): Promise<
  ActionResult<{
    invoice_id: string;
    from_department_id: string | null;
    to_department_id: string | null;
  }>
> {
  if (!isUuid(input.invoiceId)) {
    return { ok: false, error: 'Invoice id is invalid.' };
  }
  if (input.newDepartmentId != null && !isUuid(input.newDepartmentId)) {
    return { ok: false, error: 'Department id is invalid.' };
  }
  const reason = clean(input.reason);
  if (!reason) {
    return {
      ok: false,
      error: 'A reason is required for invoice reassignment.',
    };
  }
  if (reason.length > 500) {
    return { ok: false, error: 'Reason is too long (max 500 chars).' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('reassign_invoice_department', {
    p_invoice_id: input.invoiceId,
    p_new_department_id: input.newDepartmentId,
    p_reason: reason,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    invoice_id?: string;
    from_department_id?: string | null;
    to_department_id?: string | null;
  };
  if (!result.ok) {
    return {
      ok: false,
      error: 'reassign_invoice_department returned a non-ok response.',
    };
  }

  // Touch every surface that might display this invoice or its rollup.
  revalidatePath('/admin/invoices');
  revalidatePath(`/admin/invoices/${input.invoiceId}`);
  revalidatePath('/client/invoices');
  revalidatePath(`/client/invoices/${input.invoiceId}`);
  revalidatePath('/admin/budget');
  revalidatePath('/client/budget');
  revalidatePath('/client/structure');
  if (input.orgId && isUuid(input.orgId)) {
    revalidatePath(`/admin/orgs/${input.orgId}/structure`);
  }

  return {
    ok: true,
    error: null,
    payload: {
      invoice_id: result.invoice_id ?? input.invoiceId,
      from_department_id: result.from_department_id ?? null,
      to_department_id: result.to_department_id ?? input.newDepartmentId,
    },
  };
}
