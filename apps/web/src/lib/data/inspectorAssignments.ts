// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorAssignments.ts — active-work feed for the inspector
//
//  "Active assignments" = applications WHERE applicant_id = auth.uid()
//  AND status IN ('hired', 'accepted'), joined to the jobs they came from.
//  Pre-hire applications (pending / shortlisted / offered / CLIENT_SELECTED)
//  surface on /inspector/jobs in the "You've applied" group, not here.
//
//  GOLDEN_RULE_2 — strict projection. inspector_payout_cents only.
//  GOLDEN_RULE_4/7 — clientCompanyName only.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  AssignmentBucket,
  BucketedAssignments,
  InspectorAssignmentRow,
} from './inspectorAssignments.types';
import type {
  JobStatus,
  JobUrgency,
} from './clientJobs.types';
import type { InspectorApplicationStatus } from './openJobs.types';

export type { InspectorAssignmentRow, BucketedAssignments };

const HIRED_APPLICATION_STATUSES: ReadonlyArray<string> = ['hired', 'accepted'];

export async function fetchInspectorAssignments(): Promise<BucketedAssignments> {
  const empty: BucketedAssignments = {
    workImminent: [],
    inProgress: [],
    completed: [],
    disputed: [],
    total: 0,
  };

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;

    // 1. Applications where this inspector is hired.
    const { data: rawApps, error: appsErr } = await supabase
      .from('applications')
      .select('id, job_id, status, created_at, hired_at')
      .eq('applicant_id', user.id)
      .in('status', HIRED_APPLICATION_STATUSES as string[])
      .is('deleted_at', null)
      .order('hired_at', { ascending: false, nullsFirst: false });

    if (appsErr || !rawApps || rawApps.length === 0) {
      if (appsErr && typeof console !== 'undefined') {
        console.warn('[inspectorAssignments] apps query failed:', appsErr.message);
      }
      return empty;
    }

    const jobIds = rawApps.map(
      (a) => (a as unknown as Record<string, unknown>).job_id as string,
    );

    // 2. Jobs — strict projection. GOLDEN_RULE_2 enforced.
    const { data: rawJobs, error: jobsErr } = await supabase
      .from('jobs')
      .select(
        [
          'id',
          'title',
          'status',
          'urgency',
          'location_city',
          'scheduled_date',
          'inspector_payout_cents',
          'payout_amount_cents',
          'client_id',
          'payout_status',
        ].join(', '),
      )
      .in('id', jobIds)
      .is('deleted_at', null);

    if (jobsErr) {
      console.warn('[inspectorAssignments] jobs query failed:', jobsErr.message);
      return empty;
    }

    const jobById = new Map<string, Record<string, unknown>>();
    for (const j of rawJobs ?? []) {
      const r = j as unknown as Record<string, unknown>;
      jobById.set(r.id as string, r);
    }

    // 3. Client company names. GOLDEN_RULE_4/7 — company only.
    const clientIds = Array.from(
      new Set(
        (rawJobs ?? [])
          .map(
            (j) =>
              (j as unknown as Record<string, unknown>).client_id as
                | string
                | null,
          )
          .filter((v): v is string => !!v),
      ),
    );
    const companyNameById = new Map<string, string | null>();
    if (clientIds.length > 0) {
      const { data: rawProfs } = await supabase
        .from('profiles')
        .select('id, company_name')
        .in('id', clientIds);
      for (const p of rawProfs ?? []) {
        const r = p as unknown as Record<string, unknown>;
        companyNameById.set(
          r.id as string,
          (r.company_name as string | null) ?? null,
        );
      }
    }

    // 4. Assemble rows + bucket.
    const result: BucketedAssignments = {
      workImminent: [],
      inProgress: [],
      completed: [],
      disputed: [],
      total: 0,
    };

    for (const app of rawApps) {
      const a = app as unknown as Record<string, unknown>;
      const job = jobById.get(a.job_id as string);
      if (!job) continue;

      const jobStatus = job.status as JobStatus;
      const clientId = (job.client_id as string | null) ?? null;

      const row: InspectorAssignmentRow = {
        jobId: String(job.id),
        jobTitle: String(job.title ?? '(untitled)'),
        jobStatus,
        jobUrgency: (job.urgency as JobUrgency | null) ?? null,
        jobLocationCity: (job.location_city as string | null) ?? null,
        jobScheduledDate: (job.scheduled_date as string | null) ?? null,
        applicationId: String(a.id),
        applicationStatus: a.status as InspectorApplicationStatus,
        applicationCreatedAt: String(a.created_at),
        hiredAt: (a.hired_at as string | null) ?? null,
        inspectorPayoutCents: parsePayout(job),
        clientCompanyName: clientId
          ? companyNameById.get(clientId) ?? null
          : null,
        payoutStatus: (job.payout_status as string | null) ?? null,
      };

      const bucket = bucketOf(jobStatus);
      result[bucketKey(bucket)].push(row);
      result.total += 1;
    }

    return result;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[inspectorAssignments] threw:', e);
    }
    return empty;
  }
}

function bucketOf(jobStatus: JobStatus): AssignmentBucket {
  if (jobStatus === 'in_progress') return 'in_progress';
  if (jobStatus === 'completed') return 'completed';
  if (jobStatus === 'disputed') return 'disputed';
  // assigned / open / cancelled (cancelled shouldn't appear if filtered
  // correctly upstream — but assignment fetches don't filter status, so
  // we map it conservatively to workImminent so it isn't lost in the UI).
  return 'work_imminent';
}

function bucketKey(b: AssignmentBucket): keyof Omit<BucketedAssignments, 'total'> {
  switch (b) {
    case 'in_progress':
      return 'inProgress';
    case 'completed':
      return 'completed';
    case 'disputed':
      return 'disputed';
    default:
      return 'workImminent';
  }
}

function parsePayout(j: Record<string, unknown>): number | null {
  const candidate =
    (j.inspector_payout_cents as number | string | null) ??
    (j.payout_amount_cents as number | string | null);
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate === 'number')
    return Number.isFinite(candidate) ? candidate : null;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
}
