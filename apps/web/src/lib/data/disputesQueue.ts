// ════════════════════════════════════════════════════════════════════════════
//  lib/data/disputesQueue.ts — every job currently in `disputed` status.
//
//  Three small queries (jobs → profile hydration → audit timeline) joined
//  in JS — same defensive pattern as the dispatch queue. Super_admin RLS
//  grants the platform-wide read.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DisputeJob, DisputeTimelineEvent } from './disputesQueue.types';

export type { DisputeJob, DisputeTimelineEvent };

export async function fetchDisputesQueue(): Promise<{
  jobs: DisputeJob[];
  total: number;
  totalEscrowCents: number;
}> {
  const supabase = await createSupabaseServerClient();

  const { data: rawJobs, error } = await supabase
    .from('jobs_secure_view')
    .select(
      'id, title, location, created_at, updated_at, client_id, contractor_id, client_price_cents, payout_amount_cents',
    )
    .eq('status', 'disputed')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error || !rawJobs || rawJobs.length === 0) {
    if (error) console.warn('[disputesQueue] jobs query failed:', error.message);
    return { jobs: [], total: 0, totalEscrowCents: 0 };
  }

  // Hydrate profiles in one fetch.
  const profileIds = new Set<string>();
  for (const j of rawJobs) {
    if (j.client_id) profileIds.add(j.client_id as string);
    if (j.contractor_id) profileIds.add(j.contractor_id as string);
  }

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
      console.warn('[disputesQueue] profiles query failed:', profsErr.message);
    } else {
      for (const p of profs ?? []) {
        profileMap.set(p.id as string, {
          full_name: (p.full_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        });
      }
    }
  }

  let totalEscrowCents = 0;
  const jobs: DisputeJob[] = rawJobs.map((j) => {
    const client = j.client_id ? profileMap.get(j.client_id as string) : null;
    const contractor = j.contractor_id
      ? profileMap.get(j.contractor_id as string)
      : null;
    const escrow = (j.client_price_cents as number | null) ?? 0;
    totalEscrowCents += escrow;
    return {
      id: j.id as string,
      title: (j.title as string | null) ?? null,
      location: (j.location as string | null) ?? null,
      created_at: (j.created_at as string | null) ?? null,
      updated_at: (j.updated_at as string | null) ?? null,
      client_id: (j.client_id as string | null) ?? null,
      client_name: client?.full_name ?? null,
      client_email: client?.email ?? null,
      contractor_id: (j.contractor_id as string | null) ?? null,
      contractor_name: contractor?.full_name ?? null,
      contractor_email: contractor?.email ?? null,
      client_price_cents: (j.client_price_cents as number | null) ?? null,
      payout_amount_cents: (j.payout_amount_cents as number | null) ?? null,
    };
  });

  return { jobs, total: jobs.length, totalEscrowCents };
}

export async function fetchDisputeJob(jobId: string): Promise<DisputeJob | null> {
  if (!jobId) return null;
  const { jobs } = await fetchDisputesQueue();
  return jobs.find((j) => j.id === jobId) ?? null;
}

/**
 * Recent audit timeline for a disputed job. Used in the resolution
 * drawer so admins can see the dispute's history before deciding.
 */
export async function fetchDisputeTimeline(
  jobId: string,
  limit = 20,
): Promise<DisputeTimelineEvent[]> {
  if (!jobId) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    // Redacted, job-scoped view (raw audit_events is admin-only after 20260801230000).
    .from('audit_events_public')
    .select('id, created_at, event_type, severity, summary, actor_label, actor_role')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as DisputeTimelineEvent[];
}
