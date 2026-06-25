// ════════════════════════════════════════════════════════════════════════════
//  lib/data/teamWorkspace.ts — Agency/Enterprise Team Workspace reads (RSC)
//
//  fetchTeamJobs() → the org's missions, visible to the whole team. Backed by the
//  nx_team_jobs() RPC (price-free, org-scoped). Detail/report/chat access for each
//  row is enforced by the team RLS (migrations 184000 + 186000). Fail-closed.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface TeamJob {
  id: string;
  title: string | null;
  status: string;
  domain: string | null;
  location_city: string | null;
  scheduled_date: string | null;
  created_at: string;
  contractor_id: string | null;
  can_manage: boolean;
}

export async function fetchTeamJobs(): Promise<TeamJob[]> {
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb.rpc('nx_team_jobs');
    if (error) return [];
    return (data ?? []) as TeamJob[];
  } catch {
    return [];
  }
}
