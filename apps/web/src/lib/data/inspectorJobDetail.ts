// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorJobDetail.ts — single-job fetcher for inspector view
//
//  Visibility rule:
//    Either the job is currently open + admin-approved (i.e. browseable
//    from /inspector/jobs), OR the inspector has an existing application
//    against this job. After applying, the inspector keeps access to the
//    job's detail page even if its status moves to assigned / completed —
//    so they can track their own application lifecycle.
//
//  GOLDEN_RULE_2 — same strict projection as openJobs.ts. No client
//  budget, no client price, no spread. Only inspector_payout_cents.
//  GOLDEN_RULE_4/7 — client COMPANY name only. No personal info.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  InspectorJobDetail,
  InspectorOwnApplication,
} from './inspectorJobDetail.types';
import type {
  JobModerationStatus,
  JobStatus,
  JobUrgency,
} from './clientJobs.types';
import type {
  InspectorApplicationStatus,
  OpenJobSponsorship,
} from './openJobs.types';

export type { InspectorJobDetail, InspectorOwnApplication };

export async function fetchInspectorJob(
  jobId: string,
): Promise<InspectorJobDetail | null> {
  if (!jobId) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // 1. Job — STRICT projection. GOLDEN_RULE_2 enforced.
    //    DO NOT add budget_cents / client_price_cents / spread here.
    const { data: rawJob, error: jobErr } = await supabase
      .from('jobs')
      .select(
        [
          'id',
          'title',
          'description',
          'location_city',
          'location',
          'job_type',
          'urgency',
          'inspection_type',
          'specialty_slugs',
          'scheduled_date',
          'inspector_payout_cents',
          'payout_amount_cents',
          'sponsorship_offered',
          'accepts_remote_inspectors',
          'client_id',
          'created_at',
          'status',
          'moderation_status',
        ].join(', '),
      )
      .eq('id', jobId)
      .is('deleted_at', null)
      .maybeSingle();

    if (jobErr || !rawJob) {
      if (jobErr && typeof console !== 'undefined') {
        console.warn('[fetchInspectorJob] job lookup failed:', jobErr.message);
      }
      return null;
    }

    const j = rawJob as unknown as Record<string, unknown>;
    const status = j.status as JobStatus;
    const moderationStatus = j.moderation_status as JobModerationStatus;

    // 2. The inspector's own application (if any). Used both for visibility
    //    decision AND to surface the "your application" panel.
    const { data: rawApp } = await supabase
      .from('applications')
      .select('id, status, cover_note, bid_amount_cents, created_at')
      .eq('job_id', jobId)
      .eq('applicant_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    let myApplication: InspectorOwnApplication | null = null;
    if (rawApp) {
      const a = rawApp as unknown as Record<string, unknown>;
      myApplication = {
        id: String(a.id),
        status: a.status as InspectorApplicationStatus,
        coverNote: (a.cover_note as string | null) ?? null,
        bidCents:
          typeof a.bid_amount_cents === 'string'
            ? Number(a.bid_amount_cents)
            : (a.bid_amount_cents as number | null) ?? null,
        createdAt: String(a.created_at),
      };
    }

    // 3. Visibility gate. Either the job is open to new applications,
    //    OR the inspector has an active application here. Otherwise the
    //    inspector has no business seeing this job's detail.
    const isOpenForApplications =
      status === 'open' && moderationStatus === 'approved';
    if (!isOpenForApplications && !myApplication) {
      return null;
    }

    // 4. Client company name (only). GOLDEN_RULE_4/7.
    const clientId = (j.client_id as string | null) ?? null;
    let clientCompanyName: string | null = null;
    if (clientId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('company_name')
        .eq('id', clientId)
        .maybeSingle();
      if (prof) {
        const p = prof as unknown as Record<string, unknown>;
        clientCompanyName = (p.company_name as string | null) ?? null;
      }
    }

    return {
      id: String(j.id),
      title: String(j.title ?? '(untitled)'),
      description: (j.description as string | null) ?? null,
      locationCity: (j.location_city as string | null) ?? null,
      locationLabel: (j.location as string | null) ?? null,
      jobType: (j.job_type as string | null) ?? null,
      urgency: (j.urgency as JobUrgency | null) ?? null,
      inspectionType: (j.inspection_type as string | null) ?? null,
      specialtySlugs: Array.isArray(j.specialty_slugs)
        ? (j.specialty_slugs as string[])
        : [],
      scheduledDate: (j.scheduled_date as string | null) ?? null,
      inspectorPayoutCents: parsePayoutCents(j),
      clientCompanyName,
      sponsorshipOffered:
        ((j.sponsorship_offered as OpenJobSponsorship | null) ?? 'none') as
          | OpenJobSponsorship,
      acceptsRemoteInspectors: Boolean(j.accepts_remote_inspectors),
      createdAt: String(j.created_at),
      status,
      moderationStatus,
      myApplication,
      isOpenForApplications,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorJob] threw:', e);
    }
    return null;
  }
}

function parsePayoutCents(j: Record<string, unknown>): number | null {
  // Prefer inspector_payout_cents (canonical), fall back to payout_amount_cents
  // (legacy column on older rows).
  const candidate =
    (j.inspector_payout_cents as number | string | null) ??
    (j.payout_amount_cents as number | string | null);
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate === 'number')
    return Number.isFinite(candidate) ? candidate : null;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
}
