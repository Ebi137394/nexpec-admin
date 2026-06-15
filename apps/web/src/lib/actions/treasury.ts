// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/treasury.ts — Admin Treasury Control Tower actions.
//
//  Thin wrappers over the Phase-2 SECURITY DEFINER RPCs (all admin-gated + the
//  actual balance math lives in SQL): manual payout mark-paid / reject, and
//  early-payout advance funding. No money math here — just validate + call + redirect.
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BACK = '/admin/treasury';

function friendly(message: string): string {
  if (message.includes('NOT_AUTHORIZED')) return 'You are not authorized to do that.';
  if (message.includes('INVALID_STATE')) return 'That request is no longer actionable.';
  if (message.includes('REQUEST_NOT_FOUND') || message.includes('ADVANCE_NOT_FOUND')) return 'Record not found.';
  if (message.includes('INVALID_FUNDER')) return 'Pick a valid funding source.';
  return message;
}

const PaidSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().trim().max(200).optional().or(z.literal('')),
});

export async function markWithdrawalPaid(formData: FormData): Promise<void> {
  const parsed = PaidSchema.safeParse({
    id: formData.get('id'),
    reference: (formData.get('reference') as string) ?? '',
  });
  if (!parsed.success) redirect(`${BACK}?error=${encodeURIComponent('Invalid request.')}`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_mark_withdrawal_paid', {
    p_id: parsed.data.id,
    p_reference: parsed.data.reference ? parsed.data.reference : null,
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent(friendly(error.message))}`);

  revalidatePath(BACK);
  revalidatePath('/admin/dashboard');
  redirect(`${BACK}?paid=1`);
}

const RejectSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function rejectWithdrawal(formData: FormData): Promise<void> {
  const parsed = RejectSchema.safeParse({
    id: formData.get('id'),
    reason: (formData.get('reason') as string) ?? '',
  });
  if (!parsed.success) redirect(`${BACK}?error=${encodeURIComponent('Invalid request.')}`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_reject_withdrawal', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason ? parsed.data.reason : null,
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent(friendly(error.message))}`);

  revalidatePath(BACK);
  redirect(`${BACK}?rejected=1`);
}

const FundSchema = z.object({
  id: z.string().uuid(),
  fundedBy: z.enum(['platform', 'partner']),
});

export async function fundAdvance(formData: FormData): Promise<void> {
  const parsed = FundSchema.safeParse({
    id: formData.get('id'),
    fundedBy: formData.get('fundedBy'),
  });
  if (!parsed.success) redirect(`${BACK}?error=${encodeURIComponent('Invalid request.')}`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_fund_advance', {
    p_id: parsed.data.id,
    p_funded_by: parsed.data.fundedBy,
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent(friendly(error.message))}`);

  revalidatePath(BACK);
  revalidatePath('/admin/dashboard');
  redirect(`${BACK}?funded=1`);
}
