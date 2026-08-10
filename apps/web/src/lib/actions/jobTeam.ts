'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobTeam.ts — admin management of a job's inspection team
//
//  Thin wrappers over the admin-gated SECURITY DEFINER RPCs from
//  20260801376000. No authorization here, deliberately: each RPC checks
//  nx_is_admin() in its own body, and duplicating that check would create a
//  second place for it to drift.
//
//  ── WHAT THESE DO NOT DO ───────────────────────────────────────────────────
//  They do not move money and they do not change who is paid.
//  jobs.contractor_id — the contracted inspector, and the anchor for
//  settlement, contracts and identity disclosure — is never written by any of
//  them. Adding someone to the working team has no financial effect whatsoever;
//  settlement stays manual and admin-initiated.
// ════════════════════════════════════════════════════════════════════════════
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type TeamActionResult =
  | { ok: true; conflicts?: number }
  | { ok: false; error: string };

function revalidateJob(jobId: string) {
  // Called AFTER the try/catch in every action below. A revalidation signal
  // thrown inside a try block is the exact bug that made admin approval fail
  // with NEXT_REDIRECT earlier in this project.
  revalidatePath(`/admin/jobs/${jobId}/team`);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function addTeamMember(
  jobId: string,
  inspectorId: string,
  role: string,
  specialty: string | null,
  isLead: boolean,
  note?: string,
): Promise<TeamActionResult> {
  let conflicts = 0;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_job_add_inspector', {
      p_job_id: jobId,
      p_inspector_id: inspectorId,
      p_role: role,
      p_specialty: specialty?.trim() ? specialty.trim() : null,
      p_is_lead: isLead,
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    const r = (data ?? {}) as Record<string, unknown>;
    conflicts = Number(r.schedule_conflicts ?? 0);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateJob(jobId);
  return { ok: true, conflicts };
}

export async function removeTeamMember(
  jobId: string,
  inspectorId: string,
  reason?: string,
): Promise<TeamActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('nx_job_remove_inspector', {
      p_job_id: jobId,
      p_inspector_id: inspectorId,
      p_reason: reason?.trim() ? reason.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateJob(jobId);
  return { ok: true };
}

export async function replaceTeamMember(
  jobId: string,
  outgoingId: string,
  incomingId: string,
  reason?: string,
): Promise<TeamActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('nx_job_replace_team_member', {
      p_job_id: jobId,
      p_outgoing: outgoingId,
      p_incoming: incomingId,
      p_reason: reason?.trim() ? reason.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateJob(jobId);
  return { ok: true };
}

export async function setTeamLead(
  jobId: string,
  inspectorId: string,
): Promise<TeamActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('nx_job_set_lead', {
      p_job_id: jobId,
      p_inspector_id: inspectorId,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateJob(jobId);
  return { ok: true };
}
