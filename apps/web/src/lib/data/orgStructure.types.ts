// ════════════════════════════════════════════════════════════════════════════
//  lib/data/orgStructure.types.ts — type-only module
//
//  Department tree + member-assignment shapes shared by server fetchers,
//  server actions, and Client Components. Safe to import from a Client
//  Component — does NOT transitively import next/headers.
//
//  Server-only fetchers live in the sibling orgStructure.ts.
// ════════════════════════════════════════════════════════════════════════════

/** A single row from `public.departments`, hydrated with member_count. */
export interface DepartmentRow {
  id: string;
  org_id: string;
  parent_department_id: string | null;
  name: string;
  cost_center: string | null;
  depth: number;
  /** Direct member count (not descendant roll-up). */
  member_count: number;
  created_at: string | null;
  updated_at: string | null;
}

/** A department with its children already attached. */
export interface DepartmentNode extends DepartmentRow {
  children: DepartmentNode[];
  /** Cumulative member count including all descendants. Computed client-side. */
  member_count_total: number;
}

/** A member currently assigned to a department (for the detail panel). */
export interface DepartmentMember {
  /** Assignment row id from `department_members.id`. */
  assignment_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  /** The user's seat role on the parent org (from org_members.role). */
  org_role: string | null;
}

/** What server fetcher returns for the whole tree. */
export interface DepartmentTreeResult {
  /** Root-level nodes; descendants live in `children`. */
  roots: DepartmentNode[];
  /** Flat lookup of every node by id, useful for the move-picker. */
  byId: Record<string, DepartmentNode>;
  /** True when the `departments` table has not been created yet. */
  tableMissing: boolean;
}

/** Tiny shape used by the assign-member picker — every org_members row. */
export interface AssignableOrgMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  /** Which department ids this user is already assigned to. */
  assigned_department_ids: string[];
}

/** What server fetcher returns for the assignable members list. */
export interface AssignableOrgMembersResult {
  members: AssignableOrgMember[];
  tableMissing: boolean;
}

export const EMPTY_DEPARTMENT_TREE: DepartmentTreeResult = {
  roots: [],
  byId: {},
  tableMissing: false,
};

// ════════════════════════════════════════════════════════════════════════════
//  ACTIVE-ORG SWITCHER TYPES (Sprint 6 — omnichannel)
//
//  Re-exports from @nexpec/shared-core/schemas/organizations so the rest
//  of the web app can import switcher shapes from a single location, and
//  any future Next.js-only fields can be added here without touching the
//  cross-platform package.
// ════════════════════════════════════════════════════════════════════════════

export type {
  ActiveOrgInfo,
  OrgMembershipEntry,
  SetActiveOrgResult,
} from '@nexpec/shared-core';

/**
 * Flat option entry consumed by the DepartmentPickerField — every
 * department in an org, depth-annotated so the picker can render
 * nested labels with leading indentation.
 */
export interface DepartmentPickerOption {
  id: string;
  name: string;
  depth: number;
  cost_center: string | null;
  parent_department_id: string | null;
}

/**
 * What `fetchOrgPickerContext` returns for a single caller. Powers both:
 *   · /client/jobs/new (job-post Department picker)
 *   · Invoice "Reassign Department" dialog
 *
 * `defaultDepartmentId` is the caller's first department_members
 * assignment in the active org, used as the picker's default selection.
 */
export interface OrgPickerContext {
  orgId: string;
  orgName: string;
  /** All departments in the org, depth-annotated, alpha-sorted within depth. */
  departments: DepartmentPickerOption[];
  /** The caller's primary dept assignment in this org. Null when none. */
  defaultDepartmentId: string | null;
  /**
   * Whether the caller can mutate this org's structure
   * (super_admin OR owner/procurement_admin). Used by the invoice
   * Reassign UI to gate the action button server-side.
   */
  canManageStructure: boolean;
  /** True when departments haven't been seeded yet. UI hides the picker. */
  hasNoDepartments: boolean;
}

export const EMPTY_ORG_PICKER_CONTEXT: OrgPickerContext = {
  orgId: '',
  orgName: '',
  departments: [],
  defaultDepartmentId: null,
  canManageStructure: false,
  hasNoDepartments: true,
};

/** A single row from `fetch_department_audit_trail`. */
export interface DepartmentAuditEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  actor_id: string | null;
  actor_role: string | null;
  actor_label: string | null;
  subject_table: string;
  subject_id: string;
  summary: string;
  delta: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  correlation_id: string | null;
}
