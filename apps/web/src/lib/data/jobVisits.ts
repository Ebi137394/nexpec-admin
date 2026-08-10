// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobVisits.ts — site visits under a job
//
//  Reads the canonical RPCs from 20260801384000 / 20260801386000. Both are
//  authorization-gated in their own bodies; nothing here re-checks, because a
//  third layer only gives the three somewhere to disagree.
//
//  ── NO PRICING, STRUCTURALLY ───────────────────────────────────────────────
//  nx_job_visits and nx_visit_schedule_conflicts return no money column, so
//  payout, buyer price and platform margin have nowhere to land in these types.
//
//  ── THE LEGACY FALLBACK MATTERS ────────────────────────────────────────────
//  A job with no explicit job_visits rows returns ONE synthetic row with
//  fromFallback = true and visitId = null, built from jobs.scheduled_date.
//  Reading it writes nothing. The UI must show that as a schedule fallback, not
//  as a real visit record — a synthetic row has no id, so it cannot be
//  rescheduled, cancelled or crewed until an explicit visit is created.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type VisitStatus =
  | 'planned' | 'scheduled' | 'in_progress'
  | 'completed' | 'cancelled' | 'rescheduled' | 'no_show';

export type VisitKind =
  | 'single' | 'recurring' | 'surveillance' | 'resident' | 'repeat' | 'followup';

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  single: 'Single visit',
  recurring: 'Recurring',
  surveillance: 'Surveillance',
  resident: 'Resident',
  repeat: 'Repeat',
  followup: 'Follow-up',
};

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  planned: 'Planned (no date)',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Superseded',
  no_show: 'No show',
};

export interface JobVisit {
  /** NULL for the synthetic legacy row — it has no database identity. */
  visitId: string | null;
  visitNumber: number;
  title: string | null;
  visitKind: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string | null;
  recurrenceGroupId: string | null;
  assignedCount: number;
  /** True when this row was synthesised from jobs.scheduled_date. */
  fromFallback: boolean;
}

export async function fetchJobVisits(jobId: string): Promise<JobVisit[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_job_visits', { p_job_id: jobId });
  if (error) {
    // An empty list reads as "this job has no visits", which is a different
    // and misleading claim from "we could not load them".
    console.error('[jobVisits] load failed:', error.message);
    throw new Error(`Could not load visits: ${error.message}`);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    visitId: (r.visit_id as string | null) ?? null,
    visitNumber: Number(r.visit_number ?? 0),
    title: (r.title as string | null) ?? null,
    visitKind: (r.visit_kind as string | null) ?? 'single',
    status: (r.status as string | null) ?? 'scheduled',
    scheduledStart: (r.scheduled_start as string | null) ?? null,
    scheduledEnd: (r.scheduled_end as string | null) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    recurrenceGroupId: (r.recurrence_group_id as string | null) ?? null,
    assignedCount: Number(r.assigned_count ?? 0),
    fromFallback: Boolean(r.from_fallback),
  }));
}

export interface VisitConflict {
  conflictCount: number;
  conflictDates: string[];
  visitScheduledAt: string | null;
  /** False when the visit itself has no date — distinct from "checked, none". */
  visitHasDate: boolean;
}

/**
 * Advisory clash preview for allocating an inspector to a visit.
 *
 * Delegates to nx_visit_schedule_conflicts, which shares its predicate with
 * nx_visit_assign_inspector, so the number shown before the click equals the
 * number the assignment reports after it.
 *
 * Failures degrade to a neutral result on purpose: a conflict hint decorates
 * the decision and must not take the visits page down.
 */
export async function fetchVisitConflicts(
  visitId: string,
  inspectorId: string,
): Promise<VisitConflict> {
  const neutral: VisitConflict = {
    conflictCount: 0, conflictDates: [], visitScheduledAt: null, visitHasDate: false,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_visit_schedule_conflicts', {
      p_visit_id: visitId,
      p_inspector_id: inspectorId,
    });
    if (error) return neutral;
    const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!r) return neutral;
    return {
      conflictCount: Number(r.conflict_count ?? 0),
      conflictDates: Array.isArray(r.conflict_dates) ? (r.conflict_dates as string[]) : [],
      visitScheduledAt: (r.visit_scheduled_at as string | null) ?? null,
      visitHasDate: Boolean(r.visit_has_date),
    };
  } catch {
    return neutral;
  }
}
