// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/manualPayments.ts — admin-only manual settlement recording.
//
//  RELEASE POSTURE: online card payments are disabled, so NEXPEC settles every
//  engagement out of band and records it here. This action RECORDS a payment
//  that already happened; it never moves money and never touches Stripe.
//
//  Authorization is the database's, not this file's: admin_record_manual_payment
//  is SECURITY DEFINER and re-checks nx_is_admin() server-side, so a crafted
//  POST from a non-admin session is refused even though this action ran.
//  Every write is audit-logged by the same RPC.
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RecordSchema = z.object({
  jobId: z.string().regex(UUID),
  direction: z.enum(['client_payment', 'inspector_payout']),
  amountDollars: z.preprocess((v) => Number(v), z.number().positive().max(10_000_000)),
  method: z.enum(['bank_transfer', 'cheque', 'cash', 'wire', 'other']),
  paidOn: z.string().trim().max(10).optional().or(z.literal('')),
  reference: z.string().trim().max(200).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  status: z.enum(['pending', 'recorded', 'paid_manually']).default('recorded'),
});

export interface ManualPaymentResult {
  ok: boolean;
  error?: string;
  recordId?: string;
}

export async function recordManualPayment(
  _prev: ManualPaymentResult,
  formData: FormData,
): Promise<ManualPaymentResult> {
  const parsed = RecordSchema.safeParse({
    jobId: formData.get('jobId'),
    direction: formData.get('direction'),
    amountDollars: formData.get('amountDollars'),
    method: formData.get('method'),
    paidOn: formData.get('paidOn') ?? '',
    reference: formData.get('reference') ?? '',
    notes: formData.get('notes') ?? '',
    status: formData.get('status') ?? 'recorded',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_record_manual_payment', {
    p_job_id: d.jobId,
    p_direction: d.direction,
    // Money stays in minor units end to end; the form takes dollars.
    p_amount_cents: Math.round(d.amountDollars * 100),
    p_method: d.method,
    p_paid_on: d.paidOn ? d.paidOn : null,
    p_reference: d.reference ? d.reference : null,
    p_notes: d.notes ? d.notes : null,
    p_status: d.status,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/payouts');
  revalidatePath(`/admin/jobs`);
  return { ok: true, recordId: (data as string) ?? undefined };
}
