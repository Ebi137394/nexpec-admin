// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reportVisits.ts — the visit dimension of an inspection report
//
//  Reads the three report-scoped RPCs from 20260801390000. Each one is
//  authorization-gated in its own body — nx_report_visit_rollup and
//  nx_report_visit_log delegate that to nx_job_visits, so the rule is the same
//  one the visits page enforces. Nothing here re-checks; a third opinion only
//  gives the three somewhere to disagree.
//
//  ── NO PRICING, STRUCTURALLY ───────────────────────────────────────────────
//  None of the three RPCs returns a money column, so payout, buyer price and
//  platform margin have nowhere to land in these types.
//
//  ── IDENTITY IS THE DATABASE'S DECISION, NOT THIS FILE'S ───────────────────
//  nx_report_contributors already applies nx_job_effective_identity_mode: a
//  buyer on a 'protected' job receives fullName = null and a pseudonymous
//  NX- handle. This module must therefore NEVER fall back to some other name
//  source when fullName is null — `handle` IS the answer. `contributorLabel`
//  below is the only sanctioned way to render a contributor.
//
//  ── DEGRADE, DON'T EXPLODE ─────────────────────────────────────────────────
//  Visit context DECORATES a report; it is not the report. A failure here must
//  not take a review queue or an approval surface down, so every reader
//  degrades to "no visit context" rather than throwing. That is the opposite
//  of lib/data/jobVisits.ts, where the visits ARE the page and an empty list
//  would be a lie.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ─── 1. Programme rollup ──────────────────────────────────────────────── */

export interface ReportVisitRollup {
  /** Live visits this report consolidates. 1 on a legacy single-visit job. */
  visitCount: number;
  completed: number;
  cancelled: number;
  noShow: number;
  inProgress: number;
  /** planned + scheduled + in_progress — work the report may be ahead of. */
  outstanding: number;
  /** Visits with no date yet. */
  undated: number;
  firstStart: string | null;
  lastStart: string | null;
  /** Next future visit still expected to happen. */
  nextAt: string | null;
  firstStartedAt: string | null;
  lastCompletedAt: string | null;
  kinds: string[];
  isRecurring: boolean;
  /**
   * True when the job has no explicit visits and the single "visit" was
   * synthesised from jobs.scheduled_date. A classic single-visit job — NOT a
   * programme, and it must not be rendered as one.
   */
  fromFallback: boolean;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Shape the jsonb payload without trusting any single key to be present. */
export function parseVisitRollup(raw: unknown): ReportVisitRollup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    visitCount: num(r.visit_count),
    completed: num(r.completed),
    cancelled: num(r.cancelled),
    noShow: num(r.no_show),
    inProgress: num(r.in_progress),
    outstanding: num(r.outstanding),
    undated: num(r.undated),
    firstStart: str(r.first_start),
    lastStart: str(r.last_start),
    nextAt: str(r.next_at),
    firstStartedAt: str(r.first_started_at),
    lastCompletedAt: str(r.last_completed_at),
    kinds: Array.isArray(r.kinds)
      ? (r.kinds as unknown[]).filter((k): k is string => typeof k === 'string')
      : [],
    isRecurring: Boolean(r.is_recurring),
    fromFallback: Boolean(r.from_fallback),
  };
}

/**
 * True when the rollup describes an actual multi-visit programme rather than
 * the legacy one-date job. Surfaces use this to decide whether to render visit
 * context at all — claiming a "programme" for a single-date job is noise.
 */
export function isRealProgramme(r: ReportVisitRollup | null): boolean {
  return !!r && !r.fromFallback && r.visitCount > 0;
}

export async function fetchReportVisitRollup(
  reportId: string,
): Promise<ReportVisitRollup | null> {
  if (!reportId) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_report_visit_rollup', {
      p_report_id: reportId,
    });
    if (error) return null;
    return parseVisitRollup(data);
  } catch {
    return null;
  }
}

/* ─── 2. Per-visit log ─────────────────────────────────────────────────── */

export interface ReportVisitLogRow {
  /** NULL for the synthetic legacy row and for the job-level bucket. */
  visitId: string | null;
  visitNumber: number | null;
  title: string | null;
  visitKind: string | null;
  status: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string | null;
  recurrenceGroupId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** The visit's operational note. Same audience as the job_visits RLS read. */
  notes: string | null;
  cancelReason: string | null;
  /** Structured results on THIS report recorded against this visit. */
  reportItemCount: number;
  reportContributorCount: number;
  fromFallback: boolean;
  /** The catch-all row for results not bound to any visit. */
  isJobLevel: boolean;
}

export async function fetchReportVisitLog(
  reportId: string,
): Promise<ReportVisitLogRow[]> {
  if (!reportId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_report_visit_log', {
      p_report_id: reportId,
    });
    if (error) return [];
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      visitId: (r.visit_id as string | null) ?? null,
      visitNumber:
        r.visit_number === null || r.visit_number === undefined
          ? null
          : num(r.visit_number),
      title: (r.title as string | null) ?? null,
      visitKind: (r.visit_kind as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      scheduledStart: (r.scheduled_start as string | null) ?? null,
      scheduledEnd: (r.scheduled_end as string | null) ?? null,
      timezone: (r.timezone as string | null) ?? null,
      recurrenceGroupId: (r.recurrence_group_id as string | null) ?? null,
      startedAt: (r.started_at as string | null) ?? null,
      completedAt: (r.completed_at as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      cancelReason: (r.cancel_reason as string | null) ?? null,
      reportItemCount: num(r.report_item_count),
      reportContributorCount: num(r.report_contributor_count),
      fromFallback: Boolean(r.from_fallback),
      isJobLevel: Boolean(r.is_job_level),
    }));
  } catch {
    return [];
  }
}

/* ─── 3. Contributors ──────────────────────────────────────────────────── */

export interface ReportContributor {
  inspectorId: string;
  /**
   * Real name, or NULL when the caller is not permitted one. The DECISION was
   * made in nx_report_contributors against nx_job_effective_identity_mode —
   * do not re-derive it, and never substitute another name source.
   */
  fullName: string | null;
  /** Pseudonymous NX- handle. Always present, always safe to render. */
  handle: string;
  teamRole: string | null;
  isLead: boolean;
  /** True for the contracted inspector — the report's nominal author. */
  isContracted: boolean;
  itemCount: number;
  captureCount: number;
  /** Distinct visits this person recorded work on. 0 = job-level work only. */
  visitCount: number;
  /** Whether the caller was permitted names at all, for honest UI copy. */
  identityDisclosed: boolean;
}

/** The ONLY sanctioned label for a contributor. Never bypass this. */
export function contributorLabel(c: ReportContributor): string {
  return c.fullName?.trim() || c.handle || 'Unknown contributor';
}

export async function fetchReportContributors(
  reportId: string,
): Promise<ReportContributor[]> {
  if (!reportId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_report_contributors', {
      p_report_id: reportId,
    });
    if (error) return [];
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      inspectorId: String(r.inspector_id),
      fullName: (r.full_name as string | null) ?? null,
      handle: (r.handle as string | null) ?? 'NX-000000',
      teamRole: (r.team_role as string | null) ?? null,
      isLead: Boolean(r.is_lead),
      isContracted: Boolean(r.is_contracted),
      itemCount: num(r.item_count),
      captureCount: num(r.capture_count),
      visitCount: num(r.visit_count),
      identityDisclosed: Boolean(r.identity_disclosed),
    }));
  } catch {
    return [];
  }
}
