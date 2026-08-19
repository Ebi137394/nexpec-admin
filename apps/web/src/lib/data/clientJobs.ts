// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientJobs.ts — server-only fetcher for the current client's jobs
//
//  Reads from public.jobs, filtered to rows where client_id = auth.uid().
//  RLS on the jobs table should already constrain this; we add an explicit
//  WHERE as defence-in-depth in case a future RLS migration loosens reads.
//
//  Soft-deleted rows (deleted_at IS NOT NULL) are excluded. Ordering is
//  newest-first so the most recent post appears at the top.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClientJobRow,
  JobStatus,
  JobModerationStatus,
  JobUrgency,
} from './clientJobs.types';

export type { ClientJobRow } from './clientJobs.types';

/**
 * Fetch jobs owned by the current authenticated user. Returns an empty
 * array on auth failure / DB error — the dashboard surface should degrade
 * gracefully, never 500.
 */
export async function fetchClientJobs(): Promise<ClientJobRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('jobs_secure_view')
      .select(
        'id, title, status, moderation_status, created_at, budget_cents, applications_count, location_city, urgency',
      )
      .eq('client_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data) {
      if (typeof console !== 'undefined') {
        console.warn('[clientJobs] fetch failed:', error?.message);
      }
      return [];
    }

    // COUNT CONSISTENCY: show the number of admin-forwarded applications —
    // what the Applications page actually lists — not the denormalized
    // jobs.applications_count, which also counts un-forwarded proposals the
    // client can never see.
    const forwardedByJob = new Map<string, number>();
    {
      const ids = data.map((r) => String((r as Record<string, unknown>).id));
      if (ids.length > 0) {
        const { data: apps } = await supabase
          .from('applications')
          .select('job_id')
          .in('job_id', ids)
          .not('forwarded_to_client_at', 'is', null);
        for (const a of (apps ?? []) as Array<Record<string, unknown>>) {
          const k = String(a.job_id);
          forwardedByJob.set(k, (forwardedByJob.get(k) ?? 0) + 1);
        }
      }
    }

    return data.map(
      (row): ClientJobRow => ({
        id: String(row.id),
        title: String(row.title ?? '(untitled)'),
        status: row.status as JobStatus,
        moderationStatus: row.moderation_status as JobModerationStatus,
        createdAt: String(row.created_at),
        budgetCents:
          typeof row.budget_cents === 'string'
            ? Number(row.budget_cents)
            : (row.budget_cents as number | null) ?? null,
        applicationsCount: forwardedByJob.get(String(row.id)) ?? 0,
        locationCity: (row.location_city as string | null) ?? null,
        urgency: (row.urgency as JobUrgency | null) ?? null,
      }),
    );
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[clientJobs] threw:', e);
    }
    return [];
  }
}
