// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/supplierReleases.ts — admin brokered release of supplier funds.
//  Wraps release_supplier_contract (SECURITY DEFINER, admin-gated, over-release
//  proof). Amounts are entered in dollars and converted to integer cents here.
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BACK = '/admin/supplier-payouts';

const Schema = z.object({
  quoteId: z.string().uuid(),
  amount: z.string().min(1),
  note: z.string().max(500).optional(),
});

export async function releaseSupplierContract(formData: FormData): Promise<void> {
  const parsed = Schema.safeParse({
    quoteId: formData.get('quoteId'),
    amount: formData.get('amount'),
    note: (formData.get('note') as string) || undefined,
  });
  if (!parsed.success) redirect(`${BACK}?error=${encodeURIComponent('Invalid input.')}`);

  const dollars = Number(parsed.data.amount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent('Enter a valid amount.')}`);
  }
  const cents = Math.round(dollars * 100);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('release_supplier_contract', {
    p_quote_id: parsed.data.quoteId,
    p_amount_cents: cents,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    const msg = error.message.includes('OVER_RELEASE')
      ? 'Amount exceeds the remaining contract value.'
      : error.message.includes('CONTRACT_NOT_AWARDED')
        ? 'This contract is not in an awarded state.'
        : error.message;
    redirect(`${BACK}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath(BACK);
  redirect(`${BACK}?released=1`);
}
