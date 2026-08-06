// ════════════════════════════════════════════════════════════════════════════
//  lib/data/payoutsQueue.ts — completed jobs awaiting inspector payout
//
//  Reads jobs with status='completed' AND payout_status != 'paid'. Same
//  three-query + JS-side-join pattern as the dispute / dispatch queues.
//  Total owed is computed off `payout_amount_cents`.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { PayoutJob, PayoutsQueueResult } from './payoutsQueue.types';

export type { PayoutJob, PayoutsQueueResult };

export async function fetchPayoutsQueue(): Promise<PayoutsQueueResult> {
  const supabase = await createSupabaseServerClient();

  // Jobs in completed status whose payout hasn't been settled.
  const { data: rawJobs, error } = await supabase
    .from('jobs_secure_view')
    .select(
      // `completed_at` does not exist on public.jobs; naming it 42703'd the whole
      // query, so this queue silently returned ZERO rows and the admin payouts
      // screen looked empty. The queue is already keyed on status='completed'
      // ordered by updated_at — which IS when the job reached completed —
      // and payout_paid_at is the canonical settlement stamp once paid.
      'id, title, location, updated_at, payout_paid_at, client_id, contractor_id, client_price_cents, payout_amount_cents, payout_status',
    )
    .eq('status', 'completed')
    // ★ 2026-08-06 — was `.not('payout_status','eq','paid')`, i.e.
    // NOT (payout_status = 'paid'). Under SQL three-valued logic that is NULL
    // for a NULL payout_status, so the row is filtered OUT: a completed job
    // whose payout_status was never set NEVER appeared in this queue and the
    // inspector silently went unpaid. The DB's own partial index for this exact
    // set (jobs_pending_payout_idx) uses `IS DISTINCT FROM 'paid'`, which
    // includes NULL — this reproduces that predicate.
    .or('payout_status.is.null,payout_status.neq.paid')
    .order('updated_at', { ascending: true })
    .limit(200);

  if (error || !rawJobs || rawJobs.length === 0) {
    if (error) console.warn('[payoutsQueue] jobs query failed:', error.message);
    return { jobs: [], total: 0, totalOwedCents: 0 };
  }

  // Hydrate client + contractor profiles in one fetch.
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
      console.warn('[payoutsQueue] profiles query failed:', profsErr.message);
    } else {
      for (const p of profs ?? []) {
        profileMap.set(p.id as string, {
          full_name: (p.full_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        });
      }
    }
  }

  let totalOwedCents = 0;
  const jobs: PayoutJob[] = rawJobs.map((j) => {
    const client = j.client_id ? profileMap.get(j.client_id as string) : null;
    const contractor = j.contractor_id
      ? profileMap.get(j.contractor_id as string)
      : null;
    const owed = (j.payout_amount_cents as number | null) ?? 0;
    totalOwedCents += owed;
    return {
      id: j.id as string,
      title: (j.title as string | null) ?? null,
      location: (j.location as string | null) ?? null,
      completed_at: (j.updated_at as string | null) ?? null,
      payout_paid_at: (j.payout_paid_at as string | null) ?? null,
      updated_at: (j.updated_at as string | null) ?? null,
      client_id: (j.client_id as string | null) ?? null,
      client_name: client?.full_name ?? null,
      client_email: client?.email ?? null,
      contractor_id: (j.contractor_id as string | null) ?? null,
      contractor_name: contractor?.full_name ?? null,
      contractor_email: contractor?.email ?? null,
      client_price_cents: (j.client_price_cents as number | null) ?? null,
      payout_amount_cents: (j.payout_amount_cents as number | null) ?? null,
      payout_status: (j.payout_status as string | null) ?? null,
    };
  });

  return { jobs, total: jobs.length, totalOwedCents };
}

export async function fetchPayoutJob(jobId: string): Promise<PayoutJob | null> {
  if (!jobId) return null;
  const { jobs } = await fetchPayoutsQueue();
  return jobs.find((j) => j.id === jobId) ?? null;
}
