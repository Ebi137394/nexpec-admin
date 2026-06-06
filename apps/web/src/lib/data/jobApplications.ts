// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobApplications.ts — server-only fetchers for the client job
//  detail surface.
//
//  Two reads:
//
//    fetchClientJob(jobId)         → ClientJobDetail | null
//    fetchJobApplications(jobId)   → JobApplicationRow[]
//
//  Both enforce client_id = auth.uid() at the WHERE level as defence in
//  depth — RLS should already filter, but the explicit predicate protects
//  against a future RLS regression. Returns null / empty on failure
//  rather than throwing; the surface degrades, never 500.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ApplicationStatus,
  ClientJobDetail,
  JobApplicationRow,
} from './jobApplications.types';
import type {
  JobModerationStatus,
  JobStatus,
  JobUrgency,
} from './clientJobs.types';

export type { ApplicationStatus, ClientJobDetail, JobApplicationRow };

/**
 * Hydrate a single job for the current client. Returns null if the job
 * doesn't exist, isn't owned by the caller, or the query fails.
 */
export async function fetchClientJob(
  jobId: string,
): Promise<ClientJobDetail | null> {
  if (!jobId) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('jobs')
      .select(
        [
          'id',
          'title',
          'description',
          'status',
          'moderation_status',
          'urgency',
          'job_type',
          'inspection_type',
          'budget_cents',
          'location_city',
          'location',
          'specialty_slugs',
          'applications_count',
          'contractor_id',
          'created_at',
          'scheduled_date',
          // Layer 1+4 — backfilled to 'industrial_ndt'. Badge is
          // launch-state gated, so this is consumed but invisible
          // until the corresponding domain is publicly launched.
          'domain',
        ].join(', '),
      )
      .eq('id', jobId)
      .eq('client_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchClientJob] failed:', error.message);
      }
      return null;
    }

    // CLIENT_SELECTED applicant (if any) — single query, separate from
    // the full list so we can render "your pick" prominently without
    // re-scanning.
    const { data: selected } = await supabase
      .from('applications')
      .select('applicant_id')
      .eq('job_id', jobId)
      .eq('status', 'CLIENT_SELECTED')
      .maybeSingle();

    const r = data as unknown as Record<string, unknown>;
    return {
      id: String(r.id),
      title: String(r.title ?? '(untitled)'),
      description: (r.description as string | null) ?? null,
      status: r.status as JobStatus,
      moderationStatus: r.moderation_status as JobModerationStatus,
      urgency: (r.urgency as JobUrgency | null) ?? null,
      jobType: (r.job_type as string | null) ?? null,
      inspectionType: (r.inspection_type as string | null) ?? null,
      budgetCents:
        typeof r.budget_cents === 'string'
          ? Number(r.budget_cents)
          : (r.budget_cents as number | null) ?? null,
      locationCity: (r.location_city as string | null) ?? null,
      locationLabel: (r.location as string | null) ?? null,
      specialtySlugs: Array.isArray(r.specialty_slugs)
        ? (r.specialty_slugs as string[])
        : [],
      applicationsCount:
        typeof r.applications_count === 'number'
          ? r.applications_count
          : 0,
      contractorId: (r.contractor_id as string | null) ?? null,
      clientSelectedApplicantId:
        (selected?.applicant_id as string | null) ?? null,
      createdAt: String(r.created_at),
      scheduledDate: (r.scheduled_date as string | null) ?? null,
      // Layer 1+4 — surfaced for the launch-state-gated InspectionDomainBadge.
      domain: (r.domain as string | null) ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchClientJob] threw:', e);
    }
    return null;
  }
}

/**
 * Fetch every application for a given job (client-owned). Embeds the
 * inspector profile via the applications_applicant_id_fkey FK.
 */
export async function fetchJobApplications(
  jobId: string,
): Promise<JobApplicationRow[]> {
  if (!jobId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    // First confirm the caller owns the job (RLS should enforce, but
    // explicit guard means we never accidentally leak applications for
    // someone else's job through a future policy regression).
    const { data: ownership } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('client_id', user.id)
      .maybeSingle();
    if (!ownership) return [];

    const { data, error } = await supabase
      .from('applications')
      .select(
        `
        id, job_id, applicant_id, status, cover_note,
        bid_amount_cents, created_at,
        inspector:profiles!applicant_id(
          id,
          rating_average, completed_jobs_count,
          years_of_experience
        )
        `,
      )
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchJobApplications] failed:', error.message);
      }
      return [];
    }

    return data.map((row): JobApplicationRow => {
      const r = row as unknown as Record<string, unknown>;
      // Supabase's embedded select returns either a single object or
      // (rarely) an array — normalise to single-or-null.
      const rawInspector = r.inspector;
      const insp = Array.isArray(rawInspector)
        ? (rawInspector[0] as unknown as Record<string, unknown> | undefined)
        : (rawInspector as unknown as Record<string, unknown> | null);

      return {
        id: String(r.id),
        jobId: String(r.job_id),
        applicantId: String(r.applicant_id),
        status: r.status as ApplicationStatus,
        coverNote: (r.cover_note as string | null) ?? null,
        bidCents:
          typeof r.bid_amount_cents === 'string'
            ? Number(r.bid_amount_cents)
            : (r.bid_amount_cents as number | null) ?? null,
        createdAt: String(r.created_at),
        inspector: insp
          ? {
              id: String(insp.id),
              // ANTI-POACHING: the client never receives inspector PII during
              // the application/dispatch phase. Identity escrow reveals the
              // real name only after report-confirm or a VIP early-disclosure.
              // The card renders the pseudonymous NX- handle from `id`, exactly
              // like /p/[userId] and /inspectors. (Admin keeps god-mode views.)
              fullName: null,
              email: null,
              avatarUrl: null,
              ratingAverage:
                typeof insp.rating_average === 'number'
                  ? (insp.rating_average as number)
                  : insp.rating_average
                    ? Number(insp.rating_average)
                    : null,
              completedJobsCount:
                typeof insp.completed_jobs_count === 'number'
                  ? (insp.completed_jobs_count as number)
                  : null,
              locationCity: null,
              yearsOfExperience:
                (insp.years_of_experience as string | null) ?? null,
            }
          : null,
      };
    });
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchJobApplications] threw:', e);
    }
    return [];
  }
}
