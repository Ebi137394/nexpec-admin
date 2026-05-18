// ─────────────────────────────────────────────────────────────────
//  lib/assignJob.ts
//  Single source of truth for the "client / agency / admin assigns a
//  contractor to a job" transition. Backed by the Postgres RPC
//  `assign_job_contractor` (Task 3) which uses SELECT … FOR UPDATE
//  row locking to prevent race conditions.
//
//  State ladder enforced server-side: open → assigned. Anything else
//  raises a Postgres exception which we translate to a UX string.
// ─────────────────────────────────────────────────────────────────

import { supabase } from '@/src/core/supabase/supabase';

export type AssignJobResult =
  | { ok: true; job: any }
  | { ok: false; code: string; message: string };

/**
 * Atomically transition a job from `open` → `assigned` and set
 * `contractor_id`. Concurrency-safe: two simultaneous callers cannot
 * both succeed — the second one will receive a clean error.
 *
 * Caller must be super-admin, the job's client, or the job's agency.
 * The contractor must exist in `profiles` with role in
 * ('inspector','agency').
 */
export async function assignJobContractor(
  jobId: string,
  contractorId: string,
): Promise<AssignJobResult> {
  const { data, error } = await supabase.rpc('assign_job_contractor', {
    p_job_id: jobId,
    p_contractor_id: contractorId,
  });

  if (error) {
    return {
      ok: false,
      code: (error as any).code ?? 'unknown',
      message: friendlyMessage(error),
    };
  }
  return { ok: true, job: data };
}

function friendlyMessage(err: { code?: string; message?: string }): string {
  const msg = err.message ?? '';
  // Map Postgres ERRCODEs raised inside the RPC to UX strings.
  if (err.code === '28000') return 'You must be signed in.';
  if (err.code === '42501') return 'You are not allowed to assign this job.';
  if (err.code === 'P0002') return 'Job or contractor not found.';
  if (msg.includes('already has a contractor'))
    return 'Someone else just hired an inspector for this job.';
  if (msg.includes('not assignable'))
    return 'This job can no longer accept assignments.';
  if (msg.includes('is deleted')) return 'This job was removed.';
  if (msg.includes('not a valid contractor'))
    return 'Selected user is not a valid inspector.';
  return msg || 'Assignment failed. Please try again.';
}


// ─────────────────────────────────────────────────────────────────
//  Admin Dispatch (Spread Editor "Confirm & Dispatch")
//
//  Single transactional RPC that replaces three loose UPDATEs in the
//  Spread Editor. Promotes the CLIENT_SELECTED application → hired,
//  locks the job (open → assigned) with contractor + admin
//  confirmation + cents pricing, and rejects every other non-terminal
//  application — all in one DB transaction.
//
//  Backed by `admin_dispatch_job` (Phase 1 strike — HIRE-002/003).
//  Concurrency-safe via SELECT ... FOR UPDATE.
// ─────────────────────────────────────────────────────────────────

export interface DispatchJobArgs {
  jobId: string;
  applicationId: string;
  clientPriceCents: number;
  payoutCents: number;
  /** Defaults to 'unpaid'. */
  payoutStatus?: string;
}

export interface DispatchJobSuccess {
  ok: true;
  jobId: string;
  applicationId: string;
  contractorId: string;
  rejectedSiblings: number;
  correlationId: string;
}

export type DispatchJobResult =
  | DispatchJobSuccess
  | { ok: false; code: string; message: string };

export async function adminDispatchJob(
  args: DispatchJobArgs,
): Promise<DispatchJobResult> {
  const { data, error } = await supabase.rpc('admin_dispatch_job', {
    p_job_id:             args.jobId,
    p_application_id:     args.applicationId,
    p_client_price_cents: args.clientPriceCents,
    p_payout_cents:       args.payoutCents,
    p_payout_status:      args.payoutStatus ?? 'unpaid',
  });

  if (error) {
    return {
      ok: false,
      code: (error as any).code ?? 'unknown',
      message: friendlyDispatchMessage(error),
    };
  }

  const payload = data as any;
  return {
    ok:               true,
    jobId:            payload.job_id,
    applicationId:    payload.application_id,
    contractorId:     payload.contractor_id,
    rejectedSiblings: payload.rejected_siblings ?? 0,
    correlationId:    payload.correlation_id,
  };
}

function friendlyDispatchMessage(err: { code?: string; message?: string }): string {
  const msg = err.message ?? '';
  if (err.code === '28000') return 'You must be signed in as an admin.';
  if (err.code === '42501') return 'Only admins can dispatch jobs.';
  if (err.code === 'P0002') return 'Job or application not found.';
  if (msg.includes('not in open state'))     return 'This job is no longer open.';
  if (msg.includes('already has a contractor')) return 'Someone else already dispatched this job.';
  if (msg.includes('not in CLIENT_SELECTED state'))
    return 'The application is no longer in the Client-Selected state.';
  if (msg.includes('does not belong to this job'))
    return 'That application belongs to a different job.';
  if (msg.includes('cannot exceed client price'))
    return 'Inspector payout cannot exceed the client price.';
  if (msg.includes('must be greater than zero'))
    return 'Client price and inspector payout must both be positive.';
  return msg || 'Dispatch failed. Please try again.';
}
