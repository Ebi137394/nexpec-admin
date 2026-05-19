// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/negotiation.ts — Admin ↔ Inspector negotiation loop
//
//  Server actions backing the new admin_counter_application,
//  inspector_respond_to_counter, and admin_forward_application_to_client
//  RPCs introduced in migration 20260518350000.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CounterSchema = z.object({
  applicationId: z.string().regex(UUID_RE),
  jobId: z.string().regex(UUID_RE),
  counterDollars: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
      z.number().int().min(0).max(1_000_000),
    ),
  comment: z.string().trim().max(2000).optional().or(z.literal('')),
});

function backTo(jobId: string, error?: string, ok?: string): string {
  const params = new URLSearchParams();
  params.set('inspect', jobId);
  if (error) params.set('error', error);
  if (ok) params.set('ok', ok);
  params.set('_anchor', 'moderation');
  return `/admin/jobs?${params.toString()}#moderation`;
}

/** Admin sends a counter offer to the inspector. */
export async function adminCounterApplication(formData: FormData): Promise<void> {
  const parsed = CounterSchema.safeParse({
    applicationId: formData.get('applicationId'),
    jobId: formData.get('jobId'),
    counterDollars: formData.get('counterDollars'),
    comment: formData.get('comment') ?? '',
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
    redirect(backTo(String(formData.get('jobId') ?? ''), msg));
  }
  const supabase = await createSupabaseServerClient();
  const cents = Math.round(parsed.data.counterDollars * 100);
  const { error } = await supabase.rpc('admin_counter_application', {
    p_application_id: parsed.data.applicationId,
    p_counter_cents: cents,
    p_comment: parsed.data.comment || null,
  });
  if (error) {
    redirect(backTo(parsed.data.jobId, `Counter failed: ${error.message}`));
  }
  revalidatePath('/admin/jobs');
  revalidatePath('/inspector/assignments');
  redirect(backTo(parsed.data.jobId, undefined, 'countered'));
}

const InspectorResponseSchema = z.object({
  applicationId: z.string().regex(UUID_RE),
  decision: z.enum(['accepted', 'rejected']),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
  returnTo: z.string().min(1),
});

/** Inspector accepts or rejects the admin's counter offer. */
export async function inspectorRespondToCounter(
  formData: FormData,
): Promise<void> {
  const parsed = InspectorResponseSchema.safeParse({
    applicationId: formData.get('applicationId'),
    decision: formData.get('decision'),
    note: formData.get('note') ?? '',
    returnTo: formData.get('returnTo') ?? '/inspector/assignments',
  });
  if (!parsed.success) {
    redirect('/inspector/assignments?error=invalid');
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('inspector_respond_to_counter', {
    p_application_id: parsed.data.applicationId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note || null,
  });
  const ret = parsed.data.returnTo;
  if (error) {
    redirect(`${ret}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(ret);
  revalidatePath('/inspector/dashboard');
  redirect(`${ret}?ok=${parsed.data.decision}`);
}

const ForwardSchema = z.object({
  applicationId: z.string().regex(UUID_RE),
  jobId: z.string().regex(UUID_RE),
});

/** Admin forwards a settled application to the client. */
export async function adminForwardApplication(
  formData: FormData,
): Promise<void> {
  const parsed = ForwardSchema.safeParse({
    applicationId: formData.get('applicationId'),
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) {
    redirect('/admin/jobs?error=invalid');
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_forward_application_to_client', {
    p_application_id: parsed.data.applicationId,
  });
  if (error) {
    redirect(backTo(parsed.data.jobId, `Forward failed: ${error.message}`));
  }
  revalidatePath('/admin/jobs');
  revalidatePath(`/client/jobs/${parsed.data.jobId}/applications`);
  redirect(backTo(parsed.data.jobId, undefined, 'forwarded'));
}
