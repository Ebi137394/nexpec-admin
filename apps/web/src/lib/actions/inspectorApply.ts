// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorApply.ts — server actions for inspector applications
//
//  Two actions:
//
//    submitApplication(formData)   — INSERT into applications with
//                                    applicant_id = auth.uid(), status='pending'.
//                                    DB triggers handle: audit_capture,
//                                    increment_app_count, rate-limit enforcement.
//                                    23505 (unique_job_application) is treated
//                                    as a soft "already applied".
//
//    withdrawApplication(formData) — UPDATE applications.status='withdrawn'
//                                    WHERE applicant_id = auth.uid().
//                                    DB's validate_status_transition trigger
//                                    enforces legal transitions; if it rejects,
//                                    we surface the error.
//
//  Both actions verify the job is in a state where the action makes sense.
//  Submit requires status='open' + moderation_status='approved'.
//  Withdraw works regardless of job state (inspector always controls their
//  own application lifecycle).
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ApplySchema = z.object({
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
  coverNote: z
    .string()
    .trim()
    .min(50, { message: 'Tell the client at least a paragraph (min 50 chars).' })
    .max(4000, { message: 'Keep your pitch under 4000 chars.' }),
  // Bid is OPTIONAL. Inspector may choose to leave admin-set payout in place.
  // Coerce empty string → undefined so the .optional() works through FormData.
  bidDollars: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: 'Bid must be a number.' })
        .int({ message: 'Whole dollars only.' })
        .min(50, { message: 'Minimum bid is $50.' })
        .max(1_000_000, { message: 'Bid exceeds the cap.' })
        .optional(),
    )
    .optional(),
});

const WithdrawSchema = z.object({
  applicationId: z.string().uuid({ message: 'Invalid application id.' }),
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
});

function buildApplyUrl(jobId: string, params: Record<string, string>): string {
  const base = `/inspector/jobs/${encodeURIComponent(jobId)}/apply`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

function buildDetailUrl(jobId: string, params: Record<string, string>): string {
  const base = `/inspector/jobs/${encodeURIComponent(jobId)}`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

/* ─── submit application ─────────────────────────────────────────────── */

export async function submitApplication(formData: FormData): Promise<void> {
  const parsed = ApplySchema.safeParse({
    jobId: formData.get('jobId'),
    coverNote: formData.get('coverNote'),
    bidDollars: formData.get('bidDollars'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not submit, check the form.';
    redirect(
      buildApplyUrl(String(formData.get('jobId') ?? ''), { error: msg }),
    );
  }

  const { jobId, coverNote, bidDollars } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(buildApplyUrl(jobId, {})));
  }

  // Verify the job is currently applyable. Belt-and-braces — the page
  // shouldn't even render the form if the job isn't open, but a manually
  // crafted POST shouldn't sneak through.
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('id, status, moderation_status, title')
    .eq('id', jobId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!jobRow) {
    redirect(buildDetailUrl(jobId, { error: 'Job not found.' }));
  }
  const j = jobRow as unknown as Record<string, unknown>;
  if (j.status !== 'open' || j.moderation_status !== 'approved') {
    redirect(
      buildDetailUrl(jobId, {
        error: 'This job is no longer accepting applications.',
      }),
    );
  }

  // INSERT. DB triggers will:
  //   • audit_capture_trigger     → audit_events row
  //   • increment_app_count       → jobs.applications_count++
  //   • enforce_application_rate_limit → BEFORE INSERT throttle
  //   • trg_log_application_event → log row
  // Uniqueness constraint unique_job_application(job_id, applicant_id)
  // surfaces as PG error 23505 if the inspector re-applies.
  const insert: Record<string, unknown> = {
    job_id: jobId,
    applicant_id: user.id,
    status: 'pending',
    cover_note: coverNote,
  };
  if (bidDollars !== undefined) {
    insert.bid_amount_cents = bidDollars * 100;
  }

  const { error } = await supabase.from('applications').insert(insert);

  if (error) {
    if (error.code === '23505') {
      // unique_job_application — already applied. Soft redirect to detail.
      redirect(buildDetailUrl(jobId, { already: '1' }));
    }
    if (typeof console !== 'undefined') {
      console.error('[submitApplication] insert failed', {
        code: error.code,
        message: error.message,
      });
    }
    // Common case worth surfacing distinctly: rate limit trigger.
    const friendly =
      error.message?.includes('rate') || error.message?.includes('limit')
        ? 'You\'ve hit the daily application limit. Try again later or upgrade your account.'
        : 'Could not submit your application. Try again or contact support.';
    redirect(buildApplyUrl(jobId, { error: friendly }));
  }

  revalidatePath('/inspector/jobs');
  revalidatePath(`/inspector/jobs/${jobId}`);
  redirect(buildDetailUrl(jobId, { applied: '1' }));
}

/* ─── withdraw application ───────────────────────────────────────────── */

export async function withdrawApplication(formData: FormData): Promise<void> {
  const parsed = WithdrawSchema.safeParse({
    applicationId: formData.get('applicationId'),
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) {
    redirect(
      buildDetailUrl(String(formData.get('jobId') ?? ''), {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }

  const { applicationId, jobId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      '/sign-in?next=' + encodeURIComponent(buildDetailUrl(jobId, {})),
    );
  }

  // Update. WHERE includes applicant_id = auth.uid() so an attacker can't
  // withdraw someone else's application even with a tampered URL. RLS
  // should also enforce this; defence in depth.
  // The validate_status_transition trigger may reject the transition if
  // current status doesn't permit 'withdrawn' (e.g. already 'hired').
  const { error } = await supabase
    .from('applications')
    .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('applicant_id', user.id);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[withdrawApplication] update failed', {
        code: error.code,
        message: error.message,
      });
    }
    const friendly =
      error.message?.toLowerCase().includes('transition')
        ? 'This application can no longer be withdrawn, contact support if you need to make a change.'
        : 'Could not withdraw your application. Try again or contact support.';
    redirect(buildDetailUrl(jobId, { error: friendly }));
  }

  revalidatePath('/inspector/jobs');
  revalidatePath(`/inspector/jobs/${jobId}`);
  redirect(buildDetailUrl(jobId, { withdrawn: '1' }));
}
