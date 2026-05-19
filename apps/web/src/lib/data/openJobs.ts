// ════════════════════════════════════════════════════════════════════════════
//  lib/data/openJobs.ts — server-only fetcher for the inspector job feed
//
//  Returns jobs that satisfy ALL of:
//      status='open'
//      moderation_status='approved'   (Rule #1 — admin gate before visibility)
//      deleted_at IS NULL
//
//  Projection is STRICT (Rule #2). Inspector-facing surfaces must never
//  see budget_cents / client_price_cents / contractor_payout_amount_cents
//  / platform_spread_cents. The only money column in the SELECT is
//  inspector_payout_cents, falling back to payout_amount_cents only
//  when the canonical column is NULL (legacy rows).
//
//  Three queries, joined in JS — mirrors the dispatchQueue.ts pattern so
//  we don't depend on FK auto-detection or PostgREST embed quirks.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  InspectorApplicationStatus,
  OpenJobRow,
  OpenJobSponsorship,
} from './openJobs.types';
import type {
  JobModerationStatus,
  JobStatus,
  JobUrgency,
} from './clientJobs.types';

export type { OpenJobRow, InspectorApplicationStatus };

const DEFAULT_LIMIT = 50;

export interface OpenJobFilters {
  /** Match any of these specialty slugs (case-insensitive). */
  specialties?: string[];
  /** Substring match on jobs.location_city (case-insensitive). */
  city?: string;
  /** Exact match on jobs.urgency. */
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  /** Restrict to jobs that accept remote inspectors. */
  remoteOnly?: boolean;
  /** Restrict to jobs offering visa/sponsorship. */
  sponsorshipOnly?: boolean;
  /** Filter by jobs.job_type (e.g. on_site / remote / hybrid). */
  jobType?: string;
  /** Only jobs scheduled on/after this date (ISO). */
  scheduledFrom?: string;
  /** Only jobs scheduled on/before this date (ISO). */
  scheduledTo?: string;
  /** Free-text search across title + description. */
  q?: string;
}

/**
 * Fetch the inspector job feed for the current authenticated inspector.
 * Returns [] on auth failure or DB error — never throws to the caller.
 */
export async function fetchOpenJobs(
  opts: { limit?: number; filters?: OpenJobFilters } = {},
): Promise<OpenJobRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    // 1. JOBS — strict projection. GOLDEN_RULE_2 enforced here.
    //    DO NOT add budget_cents, client_price_cents, or spread columns
    //    to this SELECT. Future maintainers: see the type file header.
    const f = opts.filters ?? {};
    let q = supabase
      .from('jobs')
      .select(
        [
          'id',
          'title',
          'description',
          'location_city',
          'job_type',
          'urgency',
          'inspection_type',
          'specialty_slugs',
          'scheduled_date',
          'inspector_payout_cents', // canonical
          'payout_amount_cents',    // legacy fallback only
          'sponsorship_offered',
          'accepts_remote_inspectors',
          'client_id',
          'created_at',
          'status',
          'moderation_status',
        ].join(', '),
      )
      .eq('status', 'open')
      .eq('moderation_status', 'approved')
      .is('deleted_at', null);

    if (f.specialties && f.specialties.length > 0) {
      // Array overlap — jobs.specialty_slugs is a text[].
      q = q.overlaps('specialty_slugs', f.specialties);
    }
    if (f.city && f.city.trim().length > 0) {
      q = q.ilike('location_city', `%${f.city.trim()}%`);
    }
    if (f.urgency) {
      q = q.eq('urgency', f.urgency);
    }
    if (f.remoteOnly) {
      q = q.eq('accepts_remote_inspectors', true);
    }
    if (f.sponsorshipOnly) {
      q = q.neq('sponsorship_offered', 'none');
    }
    if (f.jobType) {
      q = q.eq('job_type', f.jobType);
    }
    if (f.scheduledFrom) {
      q = q.gte('scheduled_date', f.scheduledFrom);
    }
    if (f.scheduledTo) {
      q = q.lte('scheduled_date', f.scheduledTo);
    }
    if (f.q && f.q.trim().length > 0) {
      const term = f.q.trim().replace(/[%_]/g, '');
      q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data: rawJobs, error: jobsErr } = await q
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? DEFAULT_LIMIT);

    if (jobsErr || !rawJobs || rawJobs.length === 0) {
      if (jobsErr && typeof console !== 'undefined') {
        console.warn('[openJobs] jobs query failed:', jobsErr.message);
      }
      return [];
    }

    const jobIds = rawJobs.map(
      (j) => (j as unknown as Record<string, unknown>).id as string,
    );
    const clientIds = Array.from(
      new Set(
        rawJobs
          .map(
            (j) =>
              (j as unknown as Record<string, unknown>).client_id as
                | string
                | null,
          )
          .filter((v): v is string => !!v),
      ),
    );

    // 2. CLIENT PROFILES — company_name only.
    //    GOLDEN_RULE_4 / 7 — never select full_name / email / phone for
    //    inspector-facing surfaces.
    const companyNameById = new Map<string, string | null>();
    if (clientIds.length > 0) {
      const { data: rawProfs, error: profsErr } = await supabase
        .from('profiles')
        .select('id, company_name')
        .in('id', clientIds);
      if (profsErr) {
        console.warn('[openJobs] profile lookup failed:', profsErr.message);
      } else {
        for (const p of rawProfs ?? []) {
          const r = p as unknown as Record<string, unknown>;
          companyNameById.set(
            r.id as string,
            (r.company_name as string | null) ?? null,
          );
        }
      }
    }

    // 3. THIS INSPECTOR'S APPLICATIONS against those jobs.
    //    Used to render the "you've applied" pill + status. We also lean
    //    on the unique_job_application DB constraint to prevent dupes on
    //    the actual apply action — this query is purely for UI signal.
    const applicationStatusByJobId = new Map<
      string,
      InspectorApplicationStatus
    >();
    {
      const { data: rawApps, error: appsErr } = await supabase
        .from('applications')
        .select('job_id, status')
        .eq('applicant_id', user.id)
        .in('job_id', jobIds)
        .is('deleted_at', null);
      if (appsErr) {
        console.warn(
          '[openJobs] applications lookup failed:',
          appsErr.message,
        );
      } else {
        for (const a of rawApps ?? []) {
          const r = a as unknown as Record<string, unknown>;
          applicationStatusByJobId.set(
            r.job_id as string,
            r.status as InspectorApplicationStatus,
          );
        }
      }
    }

    return rawJobs.map((row): OpenJobRow => {
      const j = row as unknown as Record<string, unknown>;
      const id = String(j.id);
      const description =
        typeof j.description === 'string' ? (j.description as string) : null;
      const inspectorPayout = parseCents(
        (j.inspector_payout_cents as number | string | null) ??
          (j.payout_amount_cents as number | string | null),
      );
      const clientId = (j.client_id as string | null) ?? null;
      const myStatus = applicationStatusByJobId.get(id) ?? null;

      return {
        id,
        title: String(j.title ?? '(untitled)'),
        descriptionPreview: description
          ? description.slice(0, 240) + (description.length > 240 ? '…' : '')
          : null,
        locationCity: (j.location_city as string | null) ?? null,
        jobType: (j.job_type as string | null) ?? null,
        urgency: (j.urgency as JobUrgency | null) ?? null,
        inspectionType: (j.inspection_type as string | null) ?? null,
        specialtySlugs: Array.isArray(j.specialty_slugs)
          ? (j.specialty_slugs as string[])
          : [],
        scheduledDate: (j.scheduled_date as string | null) ?? null,
        // GOLDEN_RULE_2 — payout only; no client-side money columns.
        inspectorPayoutCents: inspectorPayout,
        clientCompanyName: clientId
          ? companyNameById.get(clientId) ?? null
          : null,
        sponsorshipOffered:
          ((j.sponsorship_offered as OpenJobSponsorship | null) ?? 'none') as
            | OpenJobSponsorship,
        acceptsRemoteInspectors: Boolean(j.accepts_remote_inspectors),
        createdAt: String(j.created_at),
        hasApplied: myStatus !== null,
        myApplicationStatus: myStatus,
        status: j.status as JobStatus,
        moderationStatus: j.moderation_status as JobModerationStatus,
      };
    });
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[openJobs] threw:', e);
    }
    return [];
  }
}

function parseCents(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
