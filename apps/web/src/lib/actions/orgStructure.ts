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
