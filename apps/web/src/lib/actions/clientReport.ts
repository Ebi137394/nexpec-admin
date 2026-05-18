// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/clientReport.ts — client report approval / revision signals
//
//  GOLDEN_RULE_6 — NEITHER action moves money. Both write a row to
//  audit_events; admin reads the signal in /admin/audit and processes
//  the payout via the existing super_admin process-payout edge function.
//
//  The release-payment edge function returns 501 by design (see
//  supabase/functions/release-payment/index.ts header comment, NX-STRIPE-003)
//  — that's the intended posture. Stripe Connect egress is a super_admin
//  tool; no client surface is permitted to invoke it.
//
//  Ownership: every action verifies the caller owns the job and that
//  admin has already forwarded the report (admin_confirmed_at IS NOT NULL).
//  Without admin forwarding, the approval surface doesn't even show CTAs;
//  these guards exist for the case of a manually-crafted POST.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ApproveSchema = z.object({
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
});

const RevisionSchema = z.object({
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
  reason: z
    .string()
    .trim()
    .min(10, { message: 'Tell us what needs revisiting (min 10 chars).' })
    .max(2000, { message: 'Keep it under 2000 chars.' }),
});

function buildReleaseUrl(jobId: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  const base = `/client/jobs/${encodeURIComponent(jobId)}/release`;
  return qs ? `${base}?${qs}` : base;
}

/**
 * Resolve the caller + ownership-check the job. Also asserts that admin
 * has handed the report off — otherwise there's no report for the client
 * to approve in the first place.
 */
async function resolveActor(jobId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(buildReleaseUrl(jobId, {})));
  }
  const { data: job } = await supabase
    .from('jobs')
    .select('id, admin_confirmed_at, title')
    .eq('id', jobId)
    .eq('client_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!job) {
    redirect('/client/jobs?error=' + encodeURIComponent('Job not found or access denied.'));
  }
  if (!(job as Record<string, unknown>).admin_confirmed_at) {
    redirect(
      buildReleaseUrl(jobId, {
        error:
          'Report not yet forwarded by admin. You\'ll be notified when it\'s ready for your review.',
      }),
    );
  }
  // Resolve actor's role for the audit event row (NEVER trust client-supplied).
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .maybeSingle();
  const p = (profile ?? {}) as Record<string, unknown>;
  const role = ((p.role as string | null) ?? 'client').toString().toLowerCase();
  const label =
    ((p.full_name as string | null)?.trim() ||
      ((p.email as string | null) ?? '').split('@')[0] ||
      (user.email ?? '').split('@')[0] ||
      'Client') as string;

  return {
    supabase,
    userId: user.id,
    actorRole: role,
    actorLabel: label,
    jobTitle: String((job as Record<string, unknown>).title ?? ''),
  };
}

/* ─── 1. Approve report (signal admin to release escrow) ─────────────── */

export async function clientApproveReport(formData: FormData): Promise<void> {
  const parsed = ApproveSchema.safeParse({
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) {
    redirect(
      buildReleaseUrl(String(formData.get('jobId') ?? ''), {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { jobId } = parsed.data;
  const { supabase, userId, actorRole, actorLabel, jobTitle } = await resolveActor(jobId);

  // Idempotency — if an approval already exists for this (job, user) pair,
  // skip the insert and bounce to the success state. Audit history stays
  // clean instead of accumulating spam from a refresh / double-click.
  const { data: existing } = await supabase
    .from('audit_events')
    .select('id, created_at')
    .eq('subject_table', 'jobs')
    .eq('subject_id', jobId)
    .eq('actor_id', userId)
    .eq('event_type', 'job.client_approved_report')
    .limit(1);
  if (existing && existing.length > 0) {
    redirect(buildReleaseUrl(jobId, { approved: '1', already: '1' }));
  }

  // GOLDEN_RULE_6 — this writes a signal. It does NOT call any payment
  // edge function. Admin reads /admin/audit + /admin/payouts and runs
  // process-payout when ready.
  const { error } = await supabase.from('audit_events').insert({
    event_type: 'job.client_approved_report',
    severity: 'info',
    actor_id: userId,
    actor_role: actorRole,
    actor_label: actorLabel,
    subject_table: 'jobs',
    subject_id: jobId,
    job_id: jobId,
    summary: `Client approved the report for "${jobTitle}". Awaiting admin payout release.`,
    delta: {},
    metadata: {
      source: 'web/client_portal',
      surface: 'release_page',
    },
  });

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[clientApproveReport] audit insert failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildReleaseUrl(jobId, {
        error: 'Could not record approval. Try again or contact support.',
      }),
    );
  }

  revalidatePath(`/client/jobs/${jobId}`);
  revalidatePath(`/client/jobs/${jobId}/release`);
  redirect(buildReleaseUrl(jobId, { approved: '1' }));
}

/* ─── 2. Request revision (signal admin to mediate) ──────────────────── */

export async function clientRequestRevision(formData: FormData): Promise<void> {
  const parsed = RevisionSchema.safeParse({
    jobId: formData.get('jobId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    redirect(
      buildReleaseUrl(String(formData.get('jobId') ?? ''), {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { jobId, reason } = parsed.data;
  const { supabase, userId, actorRole, actorLabel, jobTitle } = await resolveActor(jobId);

  // Allow multiple revision requests (admin may resolve one, client may
  // need to flag again later). No idempotency check here — every request
  // is a fresh audit row with its own reason text.

  const { error } = await supabase.from('audit_events').insert({
    event_type: 'job.client_requested_revision',
    // Warning severity so admin's audit filter ("severity = critical/warning")
    // surfaces it more prominently than the routine approval signal.
    severity: 'warning',
    actor_id: userId,
    actor_role: actorRole,
    actor_label: actorLabel,
    subject_table: 'jobs',
    subject_id: jobId,
    job_id: jobId,
    summary: `Client requested revision on "${jobTitle}".`,
    delta: {},
    metadata: {
      source: 'web/client_portal',
      surface: 'release_page',
      reason,
    },
  });

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[clientRequestRevision] audit insert failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildReleaseUrl(jobId, {
        error: 'Could not record revision request. Try again or contact support.',
      }),
    );
  }

  revalidatePath(`/client/jobs/${jobId}`);
  revalidatePath(`/client/jobs/${jobId}/release`);
  redirect(buildReleaseUrl(jobId, { revision: '1' }));
}
