'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobVisits.ts — admin management of a job's site visits
//
//  Thin wrappers over the admin-gated SECURITY DEFINER RPCs from
//  20260801384000 / 20260801386000. No authorization here, deliberately: each
//  RPC checks nx_is_admin() in its own body.
//
//  ── EVERY MUTATION GOES THROUGH A CANONICAL RPC ────────────────────────────
//  Nothing in this file writes job_visits or job_visit_assignments directly.
//  Those tables have SELECT-only policies, so a direct write would fail anyway
//  — but more importantly the RPCs carry the invariants (sequence numbering,
//  supersession on reschedule, crew carry-over, team-membership check,
//  conflict measurement) that a raw INSERT would silently skip.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  Creating, rescheduling, cancelling or crewing a visit has no payout effect.
//  Cancellation in particular triggers NO refund — settlement stays manual and
//  admin-initiated, exactly as elsewhere in the product.
// ════════════════════════════════════════════════════════════════════════════
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type VisitActionResult =
  | { ok: true; visitId?: string; created?: number; conflicts?: number }
  | { ok: false; error: string };

function revalidateVisits(jobId: string) {
  // Called AFTER the try/catch in every action below. A revalidation or
  // redirect signal thrown inside a try block is the exact bug that made admin
  // approval fail with NEXT_REDIRECT earlier in this project, so the pattern
  // here is deliberate and must not be "tidied" into the try.
  revalidatePath(`/admin/jobs/${jobId}/visits`);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function addVisit(
  jobId: string,
  startIso: string | null,
  kind: string,
  title: string | null,
  timezone: string | null,
  notes?: string | null,
): Promise<VisitActionResult> {
  let visitId: string | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_job_add_visit', {
      p_job_id: jobId,
      p_start: startIso && startIso.trim() ? startIso : null,
      p_end: null,
      p_kind: kind || 'single',
      p_title: title?.trim() ? title.trim() : null,
      p_timezone: timezone?.trim() ? timezone.trim() : null,
      p_notes: notes?.trim() ? notes.trim() : null,
      p_recurrence_group: null,
    });
    if (error) return { ok: false, error: error.message };
    visitId = ((data ?? {}) as Record<string, unknown>).visit_id as string | undefined;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateVisits(jobId);
  return { ok: true, visitId };
}

/**
 * Recurring series. The backend model is deliberately simple — N occurrences at
 * a fixed day interval sharing one recurrence_group_id — which covers weekly
 * surveillance, resident schedules and repeat vendor visits. This wrapper does
 * NOT invent calendar-rule semantics the RPC cannot honour.
 */
export async function addRecurringVisits(
  jobId: string,
  firstStartIso: string,
  count: number,
  intervalDays: number,
  kind: string,
  title: string | null,
  timezone: string | null,
): Promise<VisitActionResult> {
  let created: number | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_job_create_recurring_visits', {
      p_job_id: jobId,
      p_first_start: firstStartIso,
      p_count: count,
      p_interval_days: intervalDays,
      p_kind: kind || 'recurring',
      p_title: title?.trim() ? title.trim() : null,
      p_timezone: timezone?.trim() ? timezone.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    created = Number(((data ?? {}) as Record<string, unknown>).created ?? 0);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateVisits(jobId);
  return { ok: true, created };
}

/**
 * Reschedule. The RPC SUPERSEDES rather than edits: the old visit becomes
 * 'rescheduled', the new one links back via rescheduled_from_id, and the crew
 * is carried across. None of that is reimplemented here — losing it would
 * destroy schedule history.
 */
export async function rescheduleVisit(
  jobId: string,
  visitId: string,
  newStartIso: string,
  reason?: string,
): Promise<VisitActionResult> {
  let newId: string | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_job_reschedule_visit', {
      p_visit_id: visitId,
      p_new_start: newStartIso,
      p_new_end: null,
      p_reason: reason?.trim() ? reason.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    newId = ((data ?? {}) as Record<string, unknown>).new_visit_id as string | undefined;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateVisits(jobId);
  return { ok: true, visitId: newId };
}

/** Idempotent in the RPC; a second cancel returns ok without changing anything. */
export async function cancelVisit(
  jobId: string,
  visitId: string,
  reason?: string,
): Promise<VisitActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('nx_job_cancel_visit', {
      p_visit_id: visitId,
      p_reason: reason?.trim() ? reason.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateVisits(jobId);
  return { ok: true };
}

/**
 * Allocate an inspector to a visit.
 *
 * The RPC refuses anyone who is not an ACTIVE job_inspectors member, so the job
 * team remains the single source of assignment truth. It returns the same
 * conflict count the preview shows — advisory, never a block.
 */
export async function assignVisitInspector(
  jobId: string,
  visitId: string,
  inspectorId: string,
  isLead: boolean,
): Promise<VisitActionResult> {
  let conflicts = 0;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_visit_assign_inspector', {
      p_visit_id: visitId,
      p_inspector_id: inspectorId,
      p_is_lead: isLead,
    });
    if (error) return { ok: false, error: error.message };
    conflicts = Number(((data ?? {}) as Record<string, unknown>).schedule_conflicts ?? 0);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateVisits(jobId);
  return { ok: true, conflicts };
}
