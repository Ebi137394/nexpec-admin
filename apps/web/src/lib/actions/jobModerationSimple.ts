// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobModerationSimple.ts — server action used by the
//  pure-server-component JobModerationPanel.
//
//  Plain form post → call admin_review_job_with_pricing → redirect. No
//  useActionState, no hooks; the page just reloads with the result.
//
//  ── 2026-08-04, two bugs fixed here ────────────────────────────────────────
//  1. redirect() INSIDE try/catch. next/navigation's redirect() works by
//     THROWING a control-flow signal whose message is the literal string
//     'NEXT_REDIRECT'. The old code called it inside a `try`, so the sibling
//     `catch (e)` swallowed that signal and re-redirected with
//     `Review failed: ${e.message}` → the admin saw "Review failed:
//     NEXT_REDIRECT" and the REAL Postgres error ('Illegal jobs.status
//     transition: pending_approval → open') was destroyed before it could be
//     read. Every redirect now happens AFTER the try/catch closes, so the
//     signal propagates to Next.js untouched and real errors survive.
//  2. Two RPCs = two transactions. Pricing committed, the review rolled back,
//     and the job was left priced-but-unapproved. Both now go through the
//     single transactional RPC admin_review_job_with_pricing (migration
//     20260801302000), so one confirmation is all-or-nothing.
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

  // Payout is only meaningful on approve, and only when a number was typed.
  // null ⇒ "leave pricing alone", which the RPC honours.
  let payoutCents: number | null = null;
  if (rawDecision === 'approved' && rawPayout !== '') {
    const dollars = Number(rawPayout);
    if (!Number.isFinite(dollars) || dollars < 0) {
      redirect(backTo(rawJobId, 'Payout must be a positive number.'));
    }
    payoutCents = Math.round(dollars * 100);
  }

  // ONE round trip = ONE transaction. Pricing and the decision land together
  // or not at all. NOTE: no redirect() may appear inside this try — see the
  // header note; a redirect thrown here would be caught as a fake error.
  let failure: string | null = null;
  try {
    // ★ CLOSEOUT — "Request edits" must actually reach the client.
    //   admin_review_job_with_pricing() writes jobs.moderation_notes and
    //   nothing else: no notification, no message, no audit row, so the reason
    //   was stored where only an admin could read it. For this ONE decision we
    //   call admin_request_job_edits(), which sets the same
    //   moderation_status='edits_requested' AND posts the reason into the
    //   client's canonical Help & Support thread, with a duplicate guard and an
    //   audit event. Approve and Reject deliberately keep the original path so
    //   their behaviour is untouched.
    if (rawDecision === 'edits_requested') {
      const { error: editsErr } = await supabase.rpc('admin_request_job_edits', {
        p_job_id: rawJobId,
        p_notes: rawNotes,
      });
      failure = editsErr ? `Could not request edits: ${editsErr.message}` : null;
      return;
    }

    const { error } = await supabase.rpc('admin_review_job_with_pricing', {
      p_job_id: rawJobId,
      p_decision: rawDecision,
      p_notes: rawNotes.length > 0 ? rawNotes : null,
      p_inspector_payout_cents: payoutCents,
    });
    if (error) failure = error.message;
  } catch (e) {
    failure = e instanceof Error ? e.message : 'review failed';
  }

  // Redirects happen only once we are outside the try/catch.
  if (failure) {
    redirect(backTo(rawJobId, `Review failed: ${failure}`));
  }

  revalidatePath('/admin/jobs');
  revalidatePath('/admin/dashboard');
  redirect(backTo(null, undefined, rawDecision));
}
