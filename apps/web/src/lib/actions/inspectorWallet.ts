// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorWallet.ts — inspector requests a manual payout (web).
//  Wraps request_withdrawal (SECURITY DEFINER): validates against Available,
//  reserves the funds, and creates the admin Treasury queue row. No Stripe.
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BACK = '/inspector/wallet';

const Schema = z.object({
  amount: z.string().min(1),
  method: z.enum(['bank_transfer', 'stripe_manual', 'other']).default('bank_transfer'),
  note: z.string().trim().max(200).optional().or(z.literal('')),
});

function friendly(message: string): string {
  if (message.includes('INSUFFICIENT_BALANCE')) return 'That amount exceeds your available balance.';
  if (message.includes('OPEN_REQUEST_EXISTS')) return 'You already have a payout request in review.';
  if (message.includes('NOT_ELIGIBLE')) return 'Your account is not eligible for payouts.';
  if (message.includes('INVALID_AMOUNT')) return 'Enter a valid amount.';
  if (message.includes('INVALID_METHOD')) return 'Pick a valid payout method.';
  return message;
}

export async function requestWithdrawal(formData: FormData): Promise<void> {
  const parsed = Schema.safeParse({
    amount: formData.get('amount'),
    method: formData.get('method') ?? 'bank_transfer',
    note: (formData.get('note') as string) ?? '',
  });
  if (!parsed.success) redirect(`${BACK}?error=${encodeURIComponent('Check the form and retry.')}`);

  const dollars = Number(parsed.data.amount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent('Enter a valid amount greater than zero.')}`);
  }
  const cents = Math.round(dollars * 100);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('request_withdrawal', {
    p_amount_cents: cents,
    p_method: parsed.data.method,
    p_note: parsed.data.note ? parsed.data.note : null,
    p_client_op_id: globalThis.crypto.randomUUID(),
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent(friendly(error.message))}`);

  revalidatePath(BACK);
  redirect(`${BACK}?requested=1`);
}
