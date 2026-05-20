// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorAssignments.ts — active-work feed for the inspector
//
//  "Active assignments" = every job this inspector is engaged on. There are
//  TWO authoritative sources we read and MERGE so a single missed status
//  hop never makes work invisible:
//
//    A. applications WHERE applicant_id = me AND status IN ('hired','accepted')
//       — the historical primary source.
//    B. inspector_job_contracts_view WHERE inspector_id = me AND status IN
//       ('pending_inspector_signature', 'fully_executed')
//       — a fully_executed contract is BINDING: the inspector IS engaged on
//         this job, full stop, regardless of what applications.status says.
//
//  Why two sources? In production we hit a UX black hole where a contract
//  was fully_executed (all three signatures landed) but applications.status
//  never got bumped to 'hired' (because admin issued the contract straight
//  out of a counter-offer accept, skipping the standard accept path) AND
//  jobs.status never reached 'in_progress' (because the signing RPC's
//  guarded UPDATE was a no-op for the off-path state). The job vanished
//  from the inspector's surface even though they were contractually on the
//  hook for it. Reading from contracts as a second source — together with
//  the self-healing trigger in 20260520200000_self_heal_contract_to_job_
//  status.sql — guarantees this never recurs.
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
// Contract states that mean "inspector is engaged on this job" even if the
// satellite tables are stale. fully_executed is the contractual fact; the
// pending_inspector_signature row is included so the work shows up the
// moment the client signs (rather than waiting for the inspector to sign
// and trigger the self-heal).
const ACTIVE_CONTRACT_STATES: ReadonlyArray<string> = [
  'pending_inspector_signature',
  'fully_executed',
];

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

    // 1. SOURCE A — Applications where this inspector is hired.
    const appsRes = await supabase
      .from('applications')
      .select('id, job_id, status, created_at, hired_at')
      .eq('applicant_id', user.id)
      .in('status', HIRED_APPLICATION_STATUSES as string[])
      .is('deleted_at', null)
      .order('hired_at', { ascending: false, nullsFirst: false });

    if (appsRes.error) {
      console.warn('[inspectorAssignments] apps query failed:', appsRes.error.message);
    }
    const rawApps = appsRes.data ?? [];

    // 1b. SOURCE B — Contracts where this inspector is bound. Read via the
    // inspector_job_contracts_view so RLS + GR2 projection are already
    // baked in (no payload columns the inspector shouldn't see).
    const contractsRes = await supabase
      .from('inspector_job_contracts_view')
      .select(
        'id, job_id, application_id, status, inspector_payout_cents, updated_at',
      )
      .eq('inspector_id', user.id)
      .in('status', ACTIVE_CONTRACT_STATES as string[])
      .order('updated_at', { ascending: false });

    if (contractsRes.error) {
      console.warn(
        '[inspectorAssignments] contracts query failed:',
        contractsRes.error.message,
      );
    }
    const rawContracts = (contractsRes.data ?? []) as Array<{
      id: string;
      job_id: string | null;
      application_id: string | null;
      status: string;
      inspector_payout_cents: number | null;
      updated_at: string | null;
    }>;

    // 2. Union the two sources by job_id. We need ONE row per job, regardless
    //    of how we discovered it. The contract data wins for payout figures
    //    (authoritative) but the application data wins for hire timestamps.
    interface SourceRow {
      jobId: string;
      applicationId: string | null;
      applicationStatus: string | null;
      applicationCreatedAt: string | null;
      hiredAt: string | null;
      contractPayoutCents: number | null;
      contractStatus: string | null;
    }
    const sourceByJob = new Map<string, SourceRow>();

    for (const app of rawApps) {
      const a = app as unknown as Record<string, unknown>;
      const jobId = a.job_id as string;
      if (!jobId) continue;
      sourceByJob.set(jobId, {
        jobId,
        applicationId: (a.id as string) ?? null,
        applicationStatus: (a.status as string) ?? null,
        applicationCreatedAt: (a.created_at as string) ?? null,
        hiredAt: (a.hired_at as string | null) ?? null,
        contractPayoutCents: null,
        contractStatus: null,
      });
    }

    for (const c of rawContracts) {
      if (!c.job_id) continue;
      const existing = sourceByJob.get(c.job_id);
      if (existing) {
        // Application AND contract both surfaced this job — merge.
        existing.contractPayoutCents = c.inspector_payout_cents;
        existing.contractStatus = c.status;
        if (!existing.applicationId && c.application_id) {
          existing.applicationId = c.application_id;
        }
      } else {
        // CONTRACT-ONLY: this is the rescued row that the application
        // filter would have missed. Synthesize a SourceRow so the user
        // sees the job. applicationId/status stay null — the renderer
        // tolerates that.
        sourceByJob.set(c.job_id, {
          jobId: c.job_id,
          applicationId: c.application_id ?? null,
          applicationStatus: null,
          applicationCreatedAt: null,
          hiredAt: c.updated_at,
          contractPayoutCents: c.inspector_payout_cents,
          contractStatus: c.status,
        });
      }
    }

    if (sourceByJob.size === 0) return empty;

    const jobIds = Array.from(sourceByJob.keys());

    // 3. Jobs — strict projection. GOLDEN_RULE_2 enforced.
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

    // 4. Client company names. GOLDEN_RULE_4/7 — company only.
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

    // 5. Assemble rows + bucket. We iterate the unioned source map so
    //    every contract-rescued job lands in the UI even when there's no
    //    matching application row.
    const result: BucketedAssignments = {
      workImminent: [],
      inProgress: [],
      completed: [],
      disputed: [],
      total: 0,
    };

    for (const src of sourceByJob.values()) {
      const job = jobById.get(src.jobId);
      if (!job) continue;

      const jobStatus = job.status as JobStatus;
      const clientId = (job.client_id as string | null) ?? null;

      // Payout: contract figure wins (authoritative — admin set it on the
      // contract). Fall back to the jobs.inspector_payout_cents column for
      // pre-contract rows.
      const payoutCents =
        src.contractPayoutCents ?? parsePayout(job);

      const row: InspectorAssignmentRow = {
        jobId: String(job.id),
        jobTitle: String(job.title ?? '(untitled)'),
        jobStatus,
        jobUrgency: (job.urgency as JobUrgency | null) ?? null,
        jobLocationCity: (job.location_city as string | null) ?? null,
        jobScheduledDate: (job.scheduled_date as string | null) ?? null,
        // applicationId is a stable React key on the card. Fall back to
        // the contract id when we discovered the row via the contract.
        applicationId: src.applicationId ?? `contract:${src.jobId}`,
        applicationStatus:
          (src.applicationStatus as InspectorApplicationStatus | null) ??
          ('hired' as InspectorApplicationStatus),
        applicationCreatedAt:
          src.applicationCreatedAt ?? src.hiredAt ?? new Date().toISOString(),
        hiredAt: src.hiredAt,
        inspectorPayoutCents: payoutCents,
        clientCompanyName: clientId
          ? companyNameById.get(clientId) ?? null
          : null,
        payoutStatus: (job.payout_status as string | null) ?? null,
      };

      const bucket = bucketOf(jobStatus, src.contractStatus);
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

function bucketOf(
  jobStatus: JobStatus,
  contractStatus: string | null,
): AssignmentBucket {
  // Terminal job states are authoritative — never override.
  if (jobStatus === 'completed') return 'completed';
  if (jobStatus === 'disputed') return 'disputed';
  if (jobStatus === 'in_progress') return 'in_progress';

  // SAFETY NET: a fully_executed contract means the inspector IS engaged
  // even if jobs.status hasn't advanced yet. Treat it as in_progress so
  // it doesn't get lost in the workImminent fallback bucket the user can't
  // tell apart from "the job will start later".
  if (contractStatus === 'fully_executed') return 'in_progress';

  // assigned / open / awarded / pending_approval / cancelled fall through.
  // We bucket them conservatively as workImminent.
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
