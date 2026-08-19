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
      .from('jobs_secure_view')  // ★ 20260801318000 — buyer surface (fetchClientJob): budget_cents is revoked on the base table; the row-gated buyer view returns it to the owning client/admin
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
      // A job is client_id XOR agency_id (jobs_owner_xor constraint): agency /
      // enterprise buyers own via agency_id, so a client_id-only filter matched
      // NOTHING for them → null → the job-details page crashed. Match either
      // buyer column; RLS still scopes the row to the caller's own jobs.
      .or(`client_id.eq.${user.id},agency_id.eq.${user.id}`)
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

    // COUNT CONSISTENCY: the applications figure must equal what the
    // Applications page actually lists — the SAME predicate (forwarded OR
    // engaged; see fetchJobApplications). The denormalized
    // jobs.applications_count column counts EVERY application (un-forwarded
    // ones included), which produced "Review 1 application" against an
    // Applications page truthfully showing 0.
    const { count: reviewableCount } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .or(
        'forwarded_to_client_at.not.is.null,status.in.(CLIENT_SELECTED,hired,accepted)',
      );

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
      applicationsCount: reviewableCount ?? 0,
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

    // ⚠ COLUMN NAMING — this file is named for the DEPRECATED job_applications
    //   VIEW, but it reads the canonical `applications` TABLE. Do not "align"
    //   the projection below to cover_letter: three different fields carry that
    //   name.
    //     • applications.cover_note        ← CANONICAL, what every writer and
    //                                        every admin surface uses. Read it.
    //     • applications.cover_letter      — real column, no canonical writer,
    //                                        no admin reader. Not the note.
    //     • job_applications.cover_letter  — the deprecated view's ALIAS FOR
    //                                        cover_note (baseline:23469).
    const { data, error } = await supabase
      .from('applications')
      .select(
        `
        id, job_id, applicant_id, status, cover_note,
        created_at,
        inspector:profiles!applicant_id(
          id,
          rating_average, completed_jobs_count,
          years_of_experience
        )
        `,
      )
      .eq('job_id', jobId)
      // LIFECYCLE VISIBILITY (matches RLS, migration 20260801562000):
      //   • pre-engagement proposals — only after an admin has vetted and
      //     forwarded them (anti-poaching gate, 272000), AND
      //   • the ENGAGED record (CLIENT_SELECTED / hired / accepted) — always.
      // A hired application is permanent job history: it must not disappear
      // after hiring or completion, even when the forwarding timestamp was
      // never stamped (e.g. admin direct assignment). This explicit filter is
      // defense-in-depth mirroring the RLS predicate.
      .or(
        'forwarded_to_client_at.not.is.null,status.in.(CLIENT_SELECTED,hired,accepted)',
      )
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchJobApplications] failed:', error.message);
      }
      return [];
    }

    // ── DISCLOSURE ──────────────────────────────────────────────────────────
    //  Which identity fields this Client may see is decided by the project
    //  policy (jobs.identity_mode) and projected server-side by
    //  job_applicant_identity_view — professional|full reveal name/résumé/
    //  certifications; FULL additionally authorizes email/phone
    //  (20260801566000). This applicant-card surface deliberately does not
    //  select contact: identity + contact display live on the contract page
    //  and inspector-detail, the policy-scoped surfaces.
    //
    //  This surface previously hard-coded fullName/email/avatarUrl/locationCity
    //  to null with a comment asserting the client "never" receives PII, which
    //  made Professional and Full behave identically to Protected no matter
    //  what an Admin saved. The policy engine was working; this reader simply
    //  never asked it.
    //
    //  The view is the authority, not this code: it is job- and
    //  application-scoped, requires the caller to own the job, and (since
    //  20260801516000) requires the application to have been forwarded. Fields
    //  absent under the active policy come back NULL, so a downgrade removes
    //  PII on the next read with no cache of its own.
    const disclosureById = new Map<string, Record<string, unknown>>();
    {
      const { data: disc } = await supabase
        .from('job_applicant_identity_view')
        .select(
          // Contact (email/phone) is deliberately not selected here: applicant
          // cards stay contact-free by design. FULL-mode contact display lives
          // on the contract page and inspector-detail (20260801566000).
          'application_id, identity_mode, inspector_display_name, ' +
            'inspector_avatar_url, inspector_headline, ' +
            'inspector_resume_summary, inspector_resume_url, inspector_cv_url, ' +
            'inspector_certifications, inspector_qualifications, location_city, ' +
            'rating_average, completed_jobs_count, experience_years',
        )
        .eq('job_id', jobId);
      for (const d of (disc ?? []) as unknown as Record<string, unknown>[]) {
        disclosureById.set(String(d.application_id), d);
      }
    }

    return data.map((row): JobApplicationRow => {
      const r = row as unknown as Record<string, unknown>;
      // Supabase's embedded select returns either a single object or
      // (rarely) an array — normalise to single-or-null.
      const rawInspector = r.inspector;
      const insp = Array.isArray(rawInspector)
        ? (rawInspector[0] as unknown as Record<string, unknown> | undefined)
        : (rawInspector as unknown as Record<string, unknown> | null);
      const disclosure = disclosureById.get(String(r.id));

      return {
        id: String(r.id),
        jobId: String(r.job_id),
        applicantId: String(r.applicant_id),
        status: r.status as ApplicationStatus,
        coverNote: (r.cover_note as string | null) ?? null,
        createdAt: String(r.created_at),
        // OWNER-REVIEW ROOT CAUSE (identity rendering): this object used to be
        // built ONLY when the raw `profiles` embed returned a row — and
        // profiles RLS is itself mode-aware, blocking clients from the raw row
        // in every mode except `full`. Under `protected`/`professional` the
        // embed came back null, the whole inspector object was discarded, and
        // the card rendered the pseudonymous fallback even when the disclosure
        // view had released the name. The inspector object is now built
        // unconditionally from the applicant id + the DISCLOSURE VIEW (the
        // policy authority); the embed only overlays reputation numbers when
        // RLS happens to allow it. What the policy does not authorize still
        // arrives NULL from the view — the decision remains the database's.
        inspector: {
          id: String(r.applicant_id),
          fullName: (disclosure?.inspector_display_name as string | null) ?? null,
          avatarUrl: (disclosure?.inspector_avatar_url as string | null) ?? null,
          ratingAverage:
            insp && insp.rating_average != null
              ? Number(insp.rating_average)
              : disclosure?.rating_average != null
                ? Number(disclosure.rating_average)
                : null,
          completedJobsCount:
            insp && typeof insp.completed_jobs_count === 'number'
              ? (insp.completed_jobs_count as number)
              : disclosure?.completed_jobs_count != null
                ? Number(disclosure.completed_jobs_count)
                : null,
          locationCity: (disclosure?.location_city as string | null) ?? null,
          yearsOfExperience:
            (insp?.years_of_experience as string | null) ??
            (disclosure?.experience_years != null
              ? String(disclosure.experience_years)
              : null),
        },
      };
    });
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchJobApplications] threw:', e);
    }
    return [];
  }
}
