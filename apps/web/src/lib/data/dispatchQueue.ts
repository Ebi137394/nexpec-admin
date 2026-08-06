// ════════════════════════════════════════════════════════════════════════════
//  lib/data/dispatchQueue.ts — reads for the Spread Editor
//
//  Two queries (defensive — joined separately to survive FK naming
//  uncertainty across migrations):
//
//    1. Jobs in status='open' (one fetch).
//    2. Applications in status='CLIENT_SELECTED' for those job_ids (one
//       fetch).
//
//  Then we group + join in JS. A third fetch hydrates the relevant
//  profile names. Three small queries beat one fragile JOIN with an
//  embedded select.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  DispatchApplication,
  DispatchJob,
  DispatchQueueResult,
} from './dispatchQueue.types';

export type { DispatchApplication, DispatchJob, DispatchQueueResult };

/**
 * Load every job currently waiting on admin dispatch — i.e. status='open'
 * AND at least one application in 'CLIENT_SELECTED'.
 */
export async function fetchDispatchQueue(): Promise<DispatchQueueResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Jobs in open status.
  const { data: rawJobs, error: jobsErr } = await supabase
    // ★ 20260801318000 — payout revoked on the base table. This is an ADMIN
    //   surface; jobs_secure_view returns the real value when nx_is_admin().
    .from('jobs_secure_view')
    .select('id, title, location, created_at, client_id, payout_amount_cents')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(200);

  if (jobsErr || !rawJobs || rawJobs.length === 0) {
    if (jobsErr) console.warn('[dispatchQueue] jobs query failed:', jobsErr.message);
    return { jobs: [], total: 0 };
  }

  const jobIds = rawJobs.map((j) => j.id as string).filter(Boolean);
  if (jobIds.length === 0) return { jobs: [], total: 0 };

  // 2. CLIENT_SELECTED applications across those jobs.
  //    Includes `bid_amount_cents` (inspector's counter-bid) + cover note so
  //    admin can see what the inspector proposed before locking the spread.
  // BUGFIX: `applications` has NO `payout_amount_cents` column (it lives on
  // `jobs`). Selecting it here errored the whole query — and with no projection
  // fallback, the entire Dispatch queue silently returned empty.
  const { data: rawApps, error: appsErr } = await supabase
    .from('applications')
    .select(
      'id, job_id, applicant_id, bid_amount_cents, cover_note, created_at',
    )
    .eq('status', 'CLIENT_SELECTED')
    .in('job_id', jobIds);

  if (appsErr) {
    console.warn('[dispatchQueue] applications query failed:', appsErr.message);
    return { jobs: [], total: 0 };
  }

  const apps = rawApps ?? [];
  if (apps.length === 0) return { jobs: [], total: 0 };

  // 3. Profile hydration — clients + applicants in one fetch.
  const profileIds = new Set<string>();
  for (const j of rawJobs) if (j.client_id) profileIds.add(j.client_id as string);
  for (const a of apps) if (a.applicant_id) profileIds.add(a.applicant_id as string);

  const profileMap = new Map<
    string,
    { full_name: string | null; email: string | null }
  >();

  if (profileIds.size > 0) {
    const { data: profs, error: profsErr } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', Array.from(profileIds));
    if (profsErr) {
      console.warn('[dispatchQueue] profiles query failed:', profsErr.message);
    } else {
      for (const p of profs ?? []) {
        profileMap.set(p.id as string, {
          full_name: (p.full_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        });
      }
    }
  }

  // 4. Group applications by job, then assemble.
  const appsByJob = new Map<string, DispatchApplication[]>();
  for (const a of apps) {
    const jobId = a.job_id as string;
    const list = appsByJob.get(jobId) ?? [];
    const profile = a.applicant_id ? profileMap.get(a.applicant_id as string) : null;
    list.push({
      id: a.id as string,
      job_id: jobId,
      applicant_id: (a.applicant_id as string | null) ?? null,
      applicant_name: profile?.full_name ?? null,
      applicant_email: profile?.email ?? null,
      // Not a real applications column — admin payout is job-level. Always null.
      payout_amount_cents: null,
      bid_amount_cents: (a.bid_amount_cents as number | null) ?? null,
      cover_note: (a.cover_note as string | null) ?? null,
      created_at: (a.created_at as string | null) ?? null,
    });
    appsByJob.set(jobId, list);
  }

  const jobs: DispatchJob[] = rawJobs
    .filter((j) => appsByJob.has(j.id as string))
    .map((j) => {
      const clientProfile = j.client_id
        ? profileMap.get(j.client_id as string) ?? null
        : null;
      return {
        id: j.id as string,
        title: (j.title as string | null) ?? null,
        location: (j.location as string | null) ?? null,
        created_at: (j.created_at as string | null) ?? null,
        client_id: (j.client_id as string | null) ?? null,
        client_name: clientProfile?.full_name ?? null,
        client_email: clientProfile?.email ?? null,
        posted_payout_cents: (j.payout_amount_cents as number | null) ?? null,
        applications: appsByJob.get(j.id as string) ?? [],
      };
    });

  return { jobs, total: jobs.length };
}

/** Fetch one job (with its CLIENT_SELECTED applications) for the drawer. */
export async function fetchDispatchJob(jobId: string): Promise<DispatchJob | null> {
  if (!jobId) return null;
  const queue = await fetchDispatchQueue();
  return queue.jobs.find((j) => j.id === jobId) ?? null;
}
