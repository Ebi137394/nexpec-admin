// ════════════════════════════════════════════════════════════════════════════
//  lib/data/orgStructure.ts — department tree fetchers for /admin/orgs/[id]/structure
//
//  Server-only module. Types live in ./orgStructure.types.ts so Client
//  Components can import the shapes without dragging next/headers into the
//  client bundle. Re-exports the types here for server-side convenience.
//
//  Two functions:
//    fetchOrgStructure(orgId)
//      Calls the `fetch_department_tree` RPC, falls back to a direct
//      table read + client-side tree assembly if the RPC is missing.
//      Returns DepartmentTreeResult, tolerant of a missing schema.
//
//    fetchDepartmentMembers(departmentId)
//      Hydrates the per-department member list for the detail panel.
//
//    fetchAssignableOrgMembers(orgId)
//      Returns every org member with the list of departments they're
//      already assigned to. Powers the AssignMemberDialog picker.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  AssignableOrgMember,
  AssignableOrgMembersResult,
  DepartmentAuditEvent,
  DepartmentMember,
  DepartmentNode,
  DepartmentRow,
  DepartmentTreeResult,
} from './orgStructure.types';
import {
  EMPTY_DEPARTMENT_BUDGET_ROLLUP,
  EMPTY_SPEND_SLICE,
  type DepartmentBudgetRollup,
  type DepartmentSpendRow,
  type DepartmentSpendSummary,
  type RecentInvoiceRow,
  type SpendWindow,
} from './orgStructure.budget.types';

export type {
  AssignableOrgMember,
  AssignableOrgMembersResult,
  DepartmentAuditEvent,
  DepartmentBudgetRollup,
  DepartmentMember,
  DepartmentNode,
  DepartmentRow,
  DepartmentSpendRow,
  DepartmentSpendSummary,
  DepartmentTreeResult,
  RecentInvoiceRow,
  SpendWindow,
};

const TABLE_MISSING_RE = /relation .* does not exist|function .* does not exist/i;

/** Build the nested DepartmentNode[] tree from a flat list of rows. */
function assembleTree(rows: DepartmentRow[]): {
  roots: DepartmentNode[];
  byId: Record<string, DepartmentNode>;
} {
  const byId: Record<string, DepartmentNode> = {};
  for (const r of rows) {
    byId[r.id] = { ...r, children: [], member_count_total: r.member_count };
  }

  const roots: DepartmentNode[] = [];
  for (const r of rows) {
    const node = byId[r.id]!;
    if (r.parent_department_id && byId[r.parent_department_id]) {
      byId[r.parent_department_id]!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort siblings alphabetically for a stable UI.
  const sortRec = (n: DepartmentNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortRec);

  // Compute cumulative descendant counts (post-order DFS).
  const rollUp = (n: DepartmentNode): number => {
    let total = n.member_count;
    for (const c of n.children) total += rollUp(c);
    n.member_count_total = total;
    return total;
  };
  roots.forEach(rollUp);

  return { roots, byId };
}

export async function fetchOrgStructure(orgId: string): Promise<DepartmentTreeResult> {
  const empty: DepartmentTreeResult = { roots: [], byId: {}, tableMissing: false };
  if (!orgId) return empty;

  const supabase = await createSupabaseServerClient();

  // Preferred path — RPC returns the rows with depth + member_count.
  const rpcRes = await supabase.rpc('fetch_department_tree', { p_org_id: orgId });

  let rows: DepartmentRow[] | null = null;

  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    rows = (rpcRes.data as DepartmentRow[]) ?? [];
  } else {
    const msg = rpcRes.error?.message ?? '';
    if (TABLE_MISSING_RE.test(msg)) {
      // Fall through to a direct table query — also handles "RPC missing".
      const direct = await supabase
        .from('departments')
        .select('id, org_id, parent_department_id, name, cost_center, created_at, updated_at')
        .eq('org_id', orgId);
      if (direct.error) {
        if (TABLE_MISSING_RE.test(direct.error.message ?? '')) {
          return { ...empty, tableMissing: true };
        }
        console.warn('[orgStructure] direct query failed:', direct.error.message);
        return empty;
      }
      // Hydrate member counts.
      const ids = (direct.data ?? []).map((d) => d.id as string);
      const countMap = new Map<string, number>();
      if (ids.length > 0) {
        const counts = await supabase
          .from('department_members')
          .select('department_id')
          .in('department_id', ids);
        for (const r of counts.data ?? []) {
          const k = r.department_id as string;
          countMap.set(k, (countMap.get(k) ?? 0) + 1);
        }
      }
      rows = (direct.data ?? []).map((d) => ({
        id: d.id as string,
        org_id: d.org_id as string,
        parent_department_id: (d.parent_department_id as string | null) ?? null,
        name: d.name as string,
        cost_center: (d.cost_center as string | null) ?? null,
        depth: 0, // recomputed below
        member_count: countMap.get(d.id as string) ?? 0,
        created_at: (d.created_at as string | null) ?? null,
        updated_at: (d.updated_at as string | null) ?? null,
      }));
    } else {
      console.warn('[orgStructure] RPC failed:', msg);
      return empty;
    }
  }

  if (!rows || rows.length === 0) {
    return empty;
  }

  // Recompute depth defensively for the fallback path.
  const idToParent = new Map<string, string | null>(
    rows.map((r) => [r.id, r.parent_department_id]),
  );
  const depthCache = new Map<string, number>();
  const computeDepth = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const parent = idToParent.get(id) ?? null;
    const d = parent ? computeDepth(parent) + 1 : 0;
    depthCache.set(id, d);
    return d;
  };
  rows = rows.map((r) => ({ ...r, depth: computeDepth(r.id) }));

  const { roots, byId } = assembleTree(rows);
  return { roots, byId, tableMissing: false };
}

export async function fetchDepartmentMembers(departmentId: string): Promise<DepartmentMember[]> {
  if (!departmentId) return [];

  const supabase = await createSupabaseServerClient();

  const { data: rows, error } = await supabase
    .from('department_members')
    .select('id, user_id, created_at')
    .eq('department_id', departmentId);

  if (error) {
    if (!TABLE_MISSING_RE.test(error.message ?? '')) {
      console.warn('[orgStructure] member query failed:', error.message);
    }
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id as string);

  // Hydrate profiles in batch.
  const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);
    for (const p of profs ?? []) {
      profileMap.set(p.id as string, {
        full_name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  // Hydrate org roles via org_members — we need the org_id to scope.
  // Get it from the parent department.
  let orgId: string | null = null;
  const { data: deptRow } = await supabase
    .from('departments')
    .select('org_id')
    .eq('id', departmentId)
    .maybeSingle();
  orgId = (deptRow?.org_id as string | null) ?? null;

  const roleMap = new Map<string, string>();
  if (orgId && userIds.length > 0) {
    const { data: orgMembers } = await supabase
      .from('org_members')
      .select('user_id, role')
      .eq('org_id', orgId)
      .in('user_id', userIds);
    for (const m of orgMembers ?? []) {
      roleMap.set(m.user_id as string, m.role as string);
    }
  }

  return rows.map((r) => {
    const userId = r.user_id as string;
    const prof = profileMap.get(userId);
    return {
      assignment_id: r.id as string,
      user_id: userId,
      full_name: prof?.full_name ?? null,
      email: prof?.email ?? null,
      org_role: roleMap.get(userId) ?? null,
    };
  });
}

export async function fetchAssignableOrgMembers(
  orgId: string,
): Promise<AssignableOrgMembersResult> {
  const empty: AssignableOrgMembersResult = { members: [], tableMissing: false };
  if (!orgId) return empty;

  const supabase = await createSupabaseServerClient();

  const { data: members, error } = await supabase
    .from('org_members')
    .select('user_id, role')
    .eq('org_id', orgId);

  if (error) {
    if (TABLE_MISSING_RE.test(error.message ?? '')) {
      return { ...empty, tableMissing: true };
    }
    console.warn('[orgStructure] org_members query failed:', error.message);
    return empty;
  }
  if (!members || members.length === 0) return empty;

  const userIds = members.map((m) => m.user_id as string);

  const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);
    for (const p of profs ?? []) {
      profileMap.set(p.id as string, {
        full_name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  // Hydrate existing department assignments — scope to this org's
  // departments via inner join in JS land.
  const { data: orgDepts } = await supabase
    .from('departments')
    .select('id')
    .eq('org_id', orgId);
  const orgDeptIds = (orgDepts ?? []).map((d) => d.id as string);

  const assignmentMap = new Map<string, string[]>();
  if (orgDeptIds.length > 0 && userIds.length > 0) {
    const { data: assignments } = await supabase
      .from('department_members')
      .select('department_id, user_id')
      .in('department_id', orgDeptIds)
      .in('user_id', userIds);
    for (const a of assignments ?? []) {
      const uid = a.user_id as string;
      const list = assignmentMap.get(uid) ?? [];
      list.push(a.department_id as string);
      assignmentMap.set(uid, list);
    }
  }

  const out: AssignableOrgMember[] = members.map((m) => {
    const uid = m.user_id as string;
    const prof = profileMap.get(uid);
    return {
      user_id: uid,
      full_name: prof?.full_name ?? null,
      email: prof?.email ?? null,
      role: m.role as string,
      assigned_department_ids: assignmentMap.get(uid) ?? [],
    };
  });

  out.sort((a, b) =>
    (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''),
  );

  return { members: out, tableMissing: false };
}

/**
 * Pull the recent audit trail for an org's department + member-assignment
 * events. Super-admin only — the underlying RPC enforces the role check
 * and returns an empty list (after raising) for anyone else. We catch
 * the resulting permission error here and degrade to an empty array so
 * the structure page can still render for non-super-admin viewers.
 */
export async function fetchDepartmentAuditTrail(
  orgId: string,
  limit = 50,
): Promise<DepartmentAuditEvent[]> {
  if (!orgId) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('fetch_department_audit_trail', {
    p_org_id: orgId,
    p_limit: limit,
  });
  if (error) {
    // Permission errors for non-super-admin or missing function are
    // expected and shouldn't bubble up.
    if (
      !/permission|does not exist|Only super_admin/i.test(error.message ?? '')
    ) {
      console.warn('[orgStructure] audit trail failed:', error.message);
    }
    return [];
  }
  if (!Array.isArray(data)) return [];
  return (data as unknown as DepartmentAuditEvent[]) ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
//  BUDGET ROLL-UP FETCHERS — cost-center → spend integration
//
//  Powered by the two RPCs landed in 20260530120000_department_budget_rollup_rpc.
//  Both fetchers degrade silently to empty results when the financial suite
//  (public.invoices) isn't installed yet, so the structure pages keep
//  rendering on a fresh stack.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fetch the full per-department budget roll-up for an org. Returns a flat
 * row list (one per (department, currency) tuple) plus the synthetic
 * "Unattributed" bucket. The consumer assembles the tree for display.
 */
export async function fetchDepartmentBudgetRollup(
  orgId: string,
  window: SpendWindow = 'all_time',
): Promise<DepartmentBudgetRollup> {
  if (!orgId) return EMPTY_DEPARTMENT_BUDGET_ROLLUP;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('fetch_department_budget_rollup', {
    p_org_id: orgId,
    p_window: window,
  });

  if (error) {
    if (
      /relation .* does not exist|function .* does not exist/i.test(
        error.message ?? '',
      )
    ) {
      // Financial-suite RPC missing — degrade gracefully.
      return { ...EMPTY_DEPARTMENT_BUDGET_ROLLUP, invoicesMissing: true };
    }
    if (!/permission/i.test(error.message ?? '')) {
      console.warn('[orgStructure] budget rollup failed:', error.message);
    }
    return EMPTY_DEPARTMENT_BUDGET_ROLLUP;
  }

  const rows = (Array.isArray(data) ? data : []) as DepartmentSpendRow[];

  // Determine predominant currency from rolled-up volume (committed cents).
  const currencyVolume = new Map<string, number>();
  for (const r of rows) {
    const v = currencyVolume.get(r.currency) ?? 0;
    currencyVolume.set(r.currency, v + Math.abs(r.rollup_committed_cents));
  }
  let predominantCurrency = 'USD';
  let topVolume = -1;
  for (const [cur, vol] of currencyVolume.entries()) {
    if (vol > topVolume) {
      predominantCurrency = cur;
      topVolume = vol;
    }
  }

  return {
    rows,
    predominantCurrency,
    mixedCurrencies: currencyVolume.size > 1,
    hasUnattributed: rows.some((r) => r.department_id === null),
    invoicesMissing: false,
  };
}

/**
 * Tight per-department spend summary for the DepartmentDetailPanel.
 * Returns null when the department doesn't exist, the caller can't read it,
 * or the financial suite isn't installed — the panel falls back to its
 * empty state in each case.
 */
export async function fetchDepartmentSpendSummary(
  departmentId: string,
): Promise<DepartmentSpendSummary | null> {
  if (!departmentId) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('fetch_department_spend_summary', {
    p_department_id: departmentId,
  });

  if (error) {
    if (
      !/permission|does not exist/i.test(error.message ?? '')
    ) {
      console.warn('[orgStructure] spend summary failed:', error.message);
    }
    return null;
  }

  if (!data || typeof data !== 'object') return null;

  const raw = data as Record<string, unknown>;
  if (raw.ok !== true) return null;

  // Coerce — RPC returns jsonb, the shape matches DepartmentSpendSummary
  // exactly. Defensive default each numeric subfield to keep the consumer
  // free of null checks.
  const direct = (raw.direct ?? {}) as Record<string, unknown>;
  const rollup = (raw.rollup ?? {}) as Record<string, unknown>;

  const coerceSlice = (s: Record<string, unknown>) => ({
    ...EMPTY_SPEND_SLICE,
    all_time_committed_cents: Number(s.all_time_committed_cents ?? 0),
    all_time_paid_cents: Number(s.all_time_paid_cents ?? 0),
    mtd_committed_cents: Number(s.mtd_committed_cents ?? 0),
    qtd_committed_cents: Number(s.qtd_committed_cents ?? 0),
    ytd_committed_cents: Number(s.ytd_committed_cents ?? 0),
    invoice_count: Number(s.invoice_count ?? 0),
    last_invoice_at: (s.last_invoice_at as string | null) ?? null,
  });

  return {
    department_id: String(raw.department_id),
    department_name: String(raw.department_name ?? 'Department'),
    cost_center: (raw.cost_center as string | null) ?? null,
    currency: String(raw.currency ?? 'USD'),
    mixed_currencies: Boolean(raw.mixed_currencies),
    direct: coerceSlice(direct),
    rollup: coerceSlice(rollup),
    recent_invoices: Array.isArray(raw.recent_invoices)
      ? (raw.recent_invoices as RecentInvoiceRow[])
      : [],
  };
}
