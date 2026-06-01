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
import {
  ELEVATED_ORG_ROLES as SHARED_ELEVATED_ORG_ROLES,
  type ActiveOrgInfo,
  type OrgMembershipEntry,
} from '@nexpec/shared-core';
import type {
  AssignableOrgMember,
  AssignableOrgMembersResult,
  DepartmentAuditEvent,
  DepartmentMember,
  DepartmentNode,
  DepartmentPickerOption,
  DepartmentRow,
  DepartmentTreeResult,
  OrgPickerContext,
} from './orgStructure.types';
import { EMPTY_ORG_PICKER_CONTEXT } from './orgStructure.types';
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
  DepartmentPickerOption,
  DepartmentRow,
  DepartmentSpendRow,
  DepartmentSpendSummary,
  DepartmentTreeResult,
  OrgPickerContext,
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
  displayCurrency?: string | null,
): Promise<DepartmentBudgetRollup> {
  if (!orgId) return EMPTY_DEPARTMENT_BUDGET_ROLLUP;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('fetch_department_budget_rollup', {
    p_org_id: orgId,
    p_window: window,
    p_display_currency: displayCurrency ?? null,
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

  // Sprint 7 — every row carries display_currency; derive the
  // panel-wide value + the rate-unavailable flag.
  const resolvedDisplay =
    rows.find((r) => r.display_currency)?.display_currency ??
    displayCurrency ??
    predominantCurrency;
  const anyRateUnavailable = rows.some((r) => r.rate_unavailable === true);

  return {
    rows,
    predominantCurrency,
    mixedCurrencies: currencyVolume.size > 1,
    hasUnattributed: rows.some((r) => r.department_id === null),
    invoicesMissing: false,
    displayCurrency: resolvedDisplay,
    anyRateUnavailable,
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
  displayCurrency?: string | null,
): Promise<DepartmentSpendSummary | null> {
  if (!departmentId) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('fetch_department_spend_summary', {
    p_department_id: departmentId,
    p_display_currency: displayCurrency ?? null,
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
  const displayDirect = (raw.display_direct ?? {}) as Record<string, unknown>;
  const displayRollup = (raw.display_rollup ?? {}) as Record<string, unknown>;

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

  const coerceDisplaySlice = (s: Record<string, unknown>) => ({
    ...coerceSlice(s),
    rate_unavailable: Boolean(s.rate_unavailable),
  });

  return {
    department_id: String(raw.department_id),
    department_name: String(raw.department_name ?? 'Department'),
    cost_center: (raw.cost_center as string | null) ?? null,
    currency: String(raw.currency ?? 'USD'),
    mixed_currencies: Boolean(raw.mixed_currencies),
    display_currency: String(raw.display_currency ?? raw.currency ?? 'USD'),
    direct: coerceSlice(direct),
    rollup: coerceSlice(rollup),
    display_direct: coerceDisplaySlice(displayDirect),
    display_rollup: coerceDisplaySlice(displayRollup),
    recent_invoices: Array.isArray(raw.recent_invoices)
      ? (raw.recent_invoices as RecentInvoiceRow[])
      : [],
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  PICKER CONTEXT FETCHERS — powers the job-post Department picker and the
//  invoice Reassign dialog. Both surfaces need: an org id, its flat dept
//  list (depth-annotated), a sensible default selection, and a flag for
//  whether the caller is allowed to mutate.
// ════════════════════════════════════════════════════════════════════════════

// Single source of truth for which org roles can mutate department
// structure. Mirrors can_manage_org_structure() in the database. Imported
// from shared-core so mobile + web cannot drift.
const ELEVATED_ORG_ROLES_INTERNAL: ReadonlySet<string> = new Set(
  SHARED_ELEVATED_ORG_ROLES,
);

/**
 * Internal helper — flat depth-annotated departments list for an org.
 * Falls back to a direct-query path if the tree RPC isn't available.
 */
async function _fetchPickerDepartments(
  orgId: string,
): Promise<DepartmentPickerOption[]> {
  if (!orgId) return [];
  const tree = await fetchOrgStructure(orgId);
  if (tree.tableMissing) return [];

  // Flatten the assembled tree in depth-first order, preserving the
  // alphabetical sibling sort fetchOrgStructure already applied. Picker
  // option labels can then read the depth and indent visually.
  const out: DepartmentPickerOption[] = [];
  const walk = (n: DepartmentNode) => {
    out.push({
      id: n.id,
      name: n.name,
      depth: n.depth,
      cost_center: n.cost_center,
      parent_department_id: n.parent_department_id,
    });
    n.children.forEach(walk);
  };
  tree.roots.forEach(walk);
  return out;
}

/**
 * Fetch every org the caller is a member of, with rich row data for the
 * workspace switcher (name, slug, kind, logo, role, active flag).
 *
 * Single round-trip via the fetch_my_org_memberships() RPC. Falls back
 * to a direct table join if the RPC isn't installed yet so the switcher
 * keeps working during a partial deploy.
 */
export async function fetchMyOrgMemberships(): Promise<OrgMembershipEntry[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const rpc = await supabase.rpc('fetch_my_org_memberships');
  if (!rpc.error && Array.isArray(rpc.data)) {
    return (rpc.data as unknown as OrgMembershipEntry[]).map((r) => ({
      org_id: String(r.org_id),
      org_name: String(r.org_name ?? 'Organization'),
      org_slug: (r.org_slug as string | null) ?? null,
      org_kind: String(r.org_kind ?? 'enterprise'),
      org_logo_url: (r.org_logo_url as string | null) ?? null,
      is_active_org: Boolean(r.is_active_org),
      role: (r.role as OrgMembershipEntry['role']) ?? null,
      member_since: (r.member_since as string | null) ?? null,
    }));
  }

  // Fallback path — direct query when the RPC hasn't been deployed yet.
  if (
    rpc.error &&
    !/function .* does not exist|relation .* does not exist/i.test(
      rpc.error.message ?? '',
    )
  ) {
    console.warn(
      '[orgStructure] fetch_my_org_memberships failed:',
      rpc.error.message,
    );
  }

  const { data: rawRows } = await supabase
    .from('org_members')
    .select(
      'role, organizations(id, name, slug, kind, logo_url, is_active), created_at',
    )
    .eq('user_id', user.id);

  // Active org pin (best effort — column may not exist on the fallback path).
  let activeId: string | null = null;
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('active_org_id')
      .eq('id', user.id)
      .maybeSingle();
    activeId = (prof?.active_org_id as string | null) ?? null;
  } catch {
    /* column not installed yet */
  }

  const out: OrgMembershipEntry[] = ((rawRows ?? []) as unknown as Array<
    Record<string, unknown>
  >)
    .map((r) => {
      const o = (r.organizations ?? null) as Record<string, unknown> | null;
      if (!o) return null;
      if (o.is_active === false) return null;
      const orgId = String(o.id);
      return {
        org_id: orgId,
        org_name: String(o.name ?? 'Organization'),
        org_slug: (o.slug as string | null) ?? null,
        org_kind: String(o.kind ?? 'enterprise'),
        org_logo_url: (o.logo_url as string | null) ?? null,
        is_active_org: activeId === orgId,
        role: (r.role as OrgMembershipEntry['role']) ?? null,
        member_since: (r.created_at as string | null) ?? null,
      } satisfies OrgMembershipEntry;
    })
    .filter((m): m is OrgMembershipEntry => !!m);

  out.sort((a, b) => {
    if (a.is_active_org !== b.is_active_org) return a.is_active_org ? -1 : 1;
    return a.org_name.localeCompare(b.org_name);
  });
  return out;
}

/**
 * Resolve which org id should be considered the caller's "active" context.
 * Precedence:
 *   1. profiles.active_org_id IF the caller is still a current member.
 *      Defends against orphaned pins (e.g. removed-then-pinned races).
 *   2. The first elevated-role membership.
 *   3. The first enterprise-kind membership.
 *   4. The first membership at all.
 *   5. null when the caller has no memberships.
 *
 * Single source of truth — every page that needs "active org" should
 * call this rather than re-implementing the election rule.
 */
export async function resolveActiveOrgId(): Promise<string | null> {
  const memberships = await fetchMyOrgMemberships();
  if (memberships.length === 0) return null;

  // Path 1 — explicit pin from the user, if valid.
  const pinned = memberships.find((m) => m.is_active_org);
  if (pinned) return pinned.org_id;

  // Path 2-4 — election fallback.
  const elevated = memberships.find((m) =>
    m.role ? ELEVATED_ORG_ROLES_INTERNAL.has(m.role) : false,
  );
  if (elevated) return elevated.org_id;

  const enterprise = memberships.find((m) => m.org_kind === 'enterprise');
  if (enterprise) return enterprise.org_id;

  return memberships[0]?.org_id ?? null;
}

/**
 * Convenience bundle — memberships + currently-resolved active entry.
 * Used by the client layout to populate the workspace switcher in one go.
 */
export async function fetchActiveOrgInfo(): Promise<ActiveOrgInfo> {
  const memberships = await fetchMyOrgMemberships();
  if (memberships.length === 0) {
    return { active: null, memberships: [] };
  }
  const pinned = memberships.find((m) => m.is_active_org);
  if (pinned) {
    return { active: pinned, memberships };
  }
  // No explicit pin — resolve via election and surface that entry as
  // active to the UI so the switcher still highlights something.
  const resolvedId = await resolveActiveOrgId();
  const electedActive =
    memberships.find((m) => m.org_id === resolvedId) ?? memberships[0]!;
  // Materialise the elected entry with the active flag flipped so the UI
  // doesn't need a second piece of state.
  const adjusted = memberships.map((m) => ({
    ...m,
    is_active_org: m.org_id === electedActive.org_id,
  }));
  return {
    active: { ...electedActive, is_active_org: true },
    memberships: adjusted,
  };
}

/**
 * Resolve the caller's primary org for picker purposes and return the
 * full OrgPickerContext bundle.
 *
 * Selection rule respects the user's explicit pin via resolveActiveOrgId.
 * Returns null when the caller doesn't belong to any org (e.g. a buyer
 * who hasn't been invited yet) — surface should hide the picker.
 */
export async function fetchOrgPickerContextForMe(): Promise<OrgPickerContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const memberships = await fetchMyOrgMemberships();
  if (memberships.length === 0) return null;

  const activeId = await resolveActiveOrgId();
  const active =
    memberships.find((m) => m.org_id === activeId) ?? memberships[0]!;

  // Check super_admin status as well (orthogonal to org membership).
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isSuperAdmin =
    ['super_admin', 'admin'].includes(
      ((prof?.role as string | null) ?? '').toString().trim().toLowerCase(),
    );

  const canManage =
    isSuperAdmin ||
    (active.role !== null && ELEVATED_ORG_ROLES_INTERNAL.has(active.role));

  const departments = await _fetchPickerDepartments(active.org_id);

  // The caller's primary department assignment in this org (first match).
  let defaultDepartmentId: string | null = null;
  if (departments.length > 0) {
    const deptIds = departments.map((d) => d.id);
    const { data: myAssignments } = await supabase
      .from('department_members')
      .select('department_id, created_at')
      .eq('user_id', user.id)
      .in('department_id', deptIds)
      .order('created_at', { ascending: true })
      .limit(1);
    if (myAssignments && myAssignments.length > 0) {
      defaultDepartmentId =
        (myAssignments[0]?.department_id as string | null) ?? null;
    }
  }

  return {
    orgId: active.org_id,
    orgName: active.org_name,
    departments,
    defaultDepartmentId,
    canManageStructure: canManage,
    hasNoDepartments: departments.length === 0,
  };
}

/**
 * Resolve the picker context for a specific org id. Used by the invoice
 * Reassign dialog where the relevant org is known (from the invoice's
 * current department, OR — when unattributed — from the job buyer's org
 * membership which the caller is expected to resolve and pass in).
 *
 * Returns EMPTY_ORG_PICKER_CONTEXT on permission denial or missing schema,
 * so the consumer can simply check `hasNoDepartments` / `canManageStructure`.
 */
export async function fetchOrgPickerContextForOrg(
  orgId: string,
): Promise<OrgPickerContext> {
  if (!orgId) return EMPTY_ORG_PICKER_CONTEXT;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY_ORG_PICKER_CONTEXT;

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return EMPTY_ORG_PICKER_CONTEXT;

  // Permission probe: is the caller super_admin or has elevated org role?
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isSuperAdmin =
    ['super_admin', 'admin'].includes(
      ((prof?.role as string | null) ?? '').toString().trim().toLowerCase(),
    );

  let myOrgRole: string | null = null;
  if (!isSuperAdmin) {
    const { data: mem } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    myOrgRole = (mem?.role as string | null) ?? null;
  }

  const canManage =
    isSuperAdmin ||
    (myOrgRole !== null && ELEVATED_ORG_ROLES_INTERNAL.has(myOrgRole));

  const departments = await _fetchPickerDepartments(orgId);

  return {
    orgId: String(org.id),
    orgName: String(org.name ?? 'Organization'),
    departments,
    defaultDepartmentId: null,
    canManageStructure: canManage,
    hasNoDepartments: departments.length === 0,
  };
}

/**
 * Resolve the picker context for an invoice. Tries (in order):
 *   1. The invoice's current department_id → its org (if attributed).
 *   2. The invoice's job.client_id → that user's primary org membership.
 * Falls back to EMPTY when nothing resolves.
 */
export async function fetchOrgPickerContextForInvoice(
  invoiceId: string,
): Promise<OrgPickerContext> {
  if (!invoiceId) return EMPTY_ORG_PICKER_CONTEXT;
  const supabase = await createSupabaseServerClient();

  // Path A: already attributed → resolve via the dept.
  const { data: invRow } = await supabase
    .from('invoices')
    .select('department_id, job_id, client_id')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invRow) return EMPTY_ORG_PICKER_CONTEXT;

  const deptId = invRow.department_id as string | null;
  if (deptId) {
    const { data: deptRow } = await supabase
      .from('departments')
      .select('org_id')
      .eq('id', deptId)
      .maybeSingle();
    const orgId = (deptRow?.org_id as string | null) ?? null;
    if (orgId) return await fetchOrgPickerContextForOrg(orgId);
  }

  // Path B: unattributed → infer from the buyer's primary org. We pick
  // the first elevated-role membership; otherwise the first enterprise;
  // otherwise the first of any. Same selection as the buyer-side picker.
  const buyerId = (invRow.client_id as string | null) ?? null;
  if (!buyerId) return EMPTY_ORG_PICKER_CONTEXT;

  const { data: buyerMemberships } = await supabase
    .from('org_members')
    .select('org_id, role, organizations(kind)')
    .eq('user_id', buyerId);

  const memberships = ((buyerMemberships ?? []) as unknown as Array<
    Record<string, unknown>
  >).map((r) => ({
    orgId: String(r.org_id),
    role: String(r.role ?? 'viewer'),
    orgKind:
      (((r.organizations ?? {}) as Record<string, unknown>).kind as
        | string
        | null) ?? null,
  }));

  const elevated = memberships.find((m) =>
    ELEVATED_ORG_ROLES_INTERNAL.has(m.role),
  );
  const firstEnterprise = memberships.find((m) => m.orgKind === 'enterprise');
  const active = elevated ?? firstEnterprise ?? memberships[0];
  if (!active) return EMPTY_ORG_PICKER_CONTEXT;

  return await fetchOrgPickerContextForOrg(active.orgId);
}
