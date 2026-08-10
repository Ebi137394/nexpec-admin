// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobTeam.ts — the operational inspection team for a job
//
//  Reads nx_job_inspectors (20260801376000), which is authorization-gated in its
//  own body (admin, job party, contracted inspector, or an active team member).
//  Nothing here re-checks that — the page and the RPC both do, and a third layer
//  would only give the three somewhere to drift apart.
//
//  ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
//  This is NOT the settlement or identity anchor. jobs.contractor_id remains
//  the contracted inspector; this type describes who WORKS the job. Nothing
//  here carries a price, a payout or a margin — the RPC returns no money column
//  and this interface has nowhere to put one.
//
//  A job with no explicit team returns a single row with fromFallback = true,
//  synthesised from contractor_id. That is how every pre-existing
//  single-inspector job keeps working with no backfill.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type TeamRole =
  | 'lead' | 'inspector' | 'mechanical' | 'electrical'
  | 'welding_ndt' | 'coating' | 'civil' | 'specialist' | 'trainee' | 'observer';

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  lead: 'Lead inspector',
  inspector: 'Inspector',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  welding_ndt: 'Welding / NDT',
  coating: 'Coating',
  civil: 'Civil',
  specialist: 'Specialist',
  trainee: 'Trainee',
  observer: 'Observer',
};

export interface JobTeamMember {
  inspectorId: string;
  fullName: string | null;
  role: string;
  specialtySlug: string | null;
  status: string;
  isLead: boolean;
  assignedAt: string | null;
  /** True when this member is also jobs.contractor_id — the settlement anchor. */
  isContracted: boolean;
  /** True when the job has no explicit team and this row was synthesised. */
  fromFallback: boolean;
}

export async function fetchJobTeam(jobId: string): Promise<JobTeamMember[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_job_inspectors', { p_job_id: jobId });
  if (error) {
    // Returning [] would read as "no team", which is a different and misleading
    // statement than "we could not load the team".
    console.error('[jobTeam] load failed:', error.message);
    throw new Error(`Could not load the inspection team: ${error.message}`);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    inspectorId: String(r.inspector_id),
    fullName: (r.full_name as string | null) ?? null,
    role: (r.role as string | null) ?? 'inspector',
    specialtySlug: (r.specialty_slug as string | null) ?? null,
    status: (r.status as string | null) ?? 'active',
    isLead: Boolean(r.is_lead),
    assignedAt: (r.assigned_at as string | null) ?? null,
    isContracted: Boolean(r.is_contracted),
    fromFallback: Boolean(r.from_fallback),
  }));
}
