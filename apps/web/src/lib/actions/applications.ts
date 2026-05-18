// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/applications.ts — server actions for application lifecycle
//
//  Two client-side actions:
//
//    selectApplication(formData)  → status='CLIENT_SELECTED'
//    rejectApplication(formData)  → status='rejected'
//
//  Neither touches public.jobs. The existing admin /admin/dispatch surface
//  picks CLIENT_SELECTED rows out of the queue and finalises the hire,
//  which is where jobs.status / jobs.contractor_id mutate. Keeping the
//  client's surface confined to applications.status means we never trip
//  guard_jobs_status_transition_trigger from the wrong actor.
//
//  Both actions verify ownership (current user owns the underlying job)
//  before issuing UPDATE — RLS should already enforce, this is belt-and-
//  braces.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ApplicationActionSchema = z.object({
  applicationId: z.string().uuid({ message: 'Invalid application id.' }),
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
});

function buildJobUrl(jobId: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  const base = `/client/jobs/${encodeURIComponent(jobId)}/applications`;
  return qs ? `${base}?${qs}` : base;
}

/**
 * Verify the current user owns the job that this application belongs to.
 * Returns the supabase client + user.id if so; redirects otherwise.
 */
async function assertOwnsJob(jobId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(`/client/jobs/${jobId}/applications`));
  }
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('client_id', user.id)
    .maybeSingle();
  if (!job) {
    redirect('/client/jobs?error=' + encodeURIComponent('Job not found or access denied.'));
  }
  return { supabase, userId: user.id };
}

/**
 * Mark an application as the client's preferred choice. Surfaces it to
 * the admin /admin/dispatch queue where the final assignment happens.
 *
 * Idempotent — re-running on an already-CLIENT_SELECTED application is a
 * no-op from the user's perspective (UPDATE just rewrites the same value).
 *
 * Note: this does NOT auto-reject other applications for the same job.
 * That's an admin / business-logic decision — keeping the surface area
 * tight here means a future "multi-hire" workflow doesn't require code
 * removal first.
 */
export async function selectApplication(formData: FormData): Promise<void> {
  const parsed = ApplicationActionSchema.safeParse({
    applicationId: formData.get('applicationId'),
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) {
    redirect(
      buildJobUrl(String(formData.get('jobId') ?? ''), {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { applicationId, jobId } = parsed.data;
  const { supabase } = await assertOwnsJob(jobId);

  const { error } = await supabase
    .from('applications')
    .update({ status: 'CLIENT_SELECTED' })
    .eq('id', applicationId)
    .eq('job_id', jobId); // belt-and-braces — never update an app from a different job

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[selectApplication] update failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildJobUrl(jobId, {
        error: 'Could not select that inspector. Try again or contact support.',
      }),
    );
  }

  revalidatePath(`/client/jobs/${jobId}`);
  revalidatePath(`/client/jobs/${jobId}/applications`);
  redirect(buildJobUrl(jobId, { selected: applicationId }));
}

/**
 * Reject an application. Inspector remains in the applications history
 * with status='rejected' so the audit trail stays intact.
 */
export async function rejectApplication(formData: FormData): Promise<void> {
  const parsed = ApplicationActionSchema.safeParse({
    applicationId: formData.get('applicationId'),
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) {
    redirect(
      buildJobUrl(String(formData.get('jobId') ?? ''), {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { applicationId, jobId } = parsed.data;
  const { supabase } = await assertOwnsJob(jobId);

  const { error } = await supabase
    .from('applications')
    .update({ status: 'rejected' })
    .eq('id', applicationId)
    .eq('job_id', jobId);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[rejectApplication] update failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildJobUrl(jobId, {
        error: 'Could not reject that application. Try again or contact support.',
      }),
    );
  }

  revalidatePath(`/client/jobs/${jobId}`);
  revalidatePath(`/client/jobs/${jobId}/applications`);
  redirect(buildJobUrl(jobId, { rejected: applicationId }));
}
