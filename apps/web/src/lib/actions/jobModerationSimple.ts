// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobModerationSimple.ts — server action used by the
//  pure-server-component JobModerationPanel.
//
//  Plain form post → set pricing (if provided) → call admin_review_job →
//  redirect. No useActionState, no hooks; the page just reloads with the
//  result.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backTo(jobId: string | null, error?: string, ok?: string): string {
  const base = '/admin/jobs';
  const params = new URLSearchParams();
  if (jobId) params.set('inspect', jobId);
  if (error) params.set('error', error);
  if (ok) params.set('ok', ok);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function reviewJobSimple(formData: FormData): Promise<void> {
  const rawJobId = String(formData.get('jobId') ?? '').trim();
  const rawDecision = String(formData.get('decision') ?? '').trim();
  const rawNotes = String(formData.get('notes') ?? '').trim();
  const rawPayout = String(formData.get('inspectorPayoutDollars') ?? '').trim();

  if (!UUID_RE.test(rawJobId)) {
    redirect(backTo(null, 'Invalid job id.'));
  }
  if (!['approved', 'edits_requested', 'rejected'].includes(rawDecision)) {
    redirect(backTo(rawJobId, 'Invalid decision.'));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/admin/jobs'));
  }

  // Set pricing first (only on approve, only if a number was typed).
  if (rawDecision === 'approved' && rawPayout !== '') {
    const dollars = Number(rawPayout);
    if (Number.isFinite(dollars) && dollars >= 0) {
      const cents = Math.round(dollars * 100);
      try {
        const { error: priceErr } = await supabase.rpc(
          'admin_set_job_pricing',
          { p_job_id: rawJobId, p_inspector_payout_cents: cents },
        );
        if (priceErr) {
          redirect(
            backTo(rawJobId, `Could not set payout: ${priceErr.message}`),
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'pricing failed';
        redirect(backTo(rawJobId, `Could not set payout: ${msg}`));
      }
    }
  }

  // Then run the actual review.
  try {
    const { error } = await supabase.rpc('admin_review_job', {
      p_job_id: rawJobId,
      p_decision: rawDecision,
      p_notes: rawNotes.length > 0 ? rawNotes : null,
    });
    if (error) {
      redirect(backTo(rawJobId, `Review failed: ${error.message}`));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'review failed';
    redirect(backTo(rawJobId, `Review failed: ${msg}`));
  }

  revalidatePath('/admin/jobs');
  revalidatePath('/admin/dashboard');
  redirect(backTo(null, undefined, rawDecision));
}
