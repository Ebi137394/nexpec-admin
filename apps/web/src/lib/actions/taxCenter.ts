// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/taxCenter.ts — Tax Center writes (web).
//
//  Payee submit + admin verify/exempt/reveal. The raw TIN NEVER touches our
//  server env directly — submit/reveal go through the tax-vault edge function,
//  the sole holder of TAX_VAULT_KEY. Verify/exempt are plain admin RPCs.
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const PAYEE_BACK = '/inspector/tax-center';
const ADMIN_BACK = '/admin/tax-center';

function friendly(message: string): string {
  if (message.includes('INVALID_FORM_TYPE')) return 'Pick a valid tax form.';
  if (message.includes('INVALID_TAX_ID') || message.includes('invalid_tax_id')) return 'Enter a valid tax identifier.';
  if (message.includes('vault_key_missing') || message.includes('VAULT_KEY_MISSING')) return 'Tax vault is not configured. Contact support.';
  if (message.includes('NOT_AUTHORIZED')) return 'You are not authorized to do that.';
  if (message.includes('EXEMPTION_REASON_REQUIRED')) return 'An exemption requires a reason.';
  return message;
}

const SubmitSchema = z.object({
  formType: z.enum(['w9', 'w8ben', 'w8bene', 't4a', 'dac7']),
  country: z.string().trim().min(2).max(2),
  taxId: z.string().trim().min(4).max(64),
});

/** Payee submits their tax form — encrypted server-side via the tax-vault fn. */
export async function submitTaxForm(formData: FormData): Promise<void> {
  const parsed = SubmitSchema.safeParse({
    formType: formData.get('formType'),
    country: formData.get('country'),
    taxId: formData.get('taxId'),
  });
  if (!parsed.success) redirect(`${PAYEE_BACK}?error=${encodeURIComponent('Check the form and retry.')}`);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.functions.invoke('tax-vault', {
    body: { action: 'submit', form_type: parsed.data.formType, country: parsed.data.country, tax_id: parsed.data.taxId },
  });
  const errMsg = error?.message || (data as { error?: string } | null)?.error;
  if (errMsg) redirect(`${PAYEE_BACK}?error=${encodeURIComponent(friendly(errMsg))}`);

  revalidatePath(PAYEE_BACK);
  redirect(`${PAYEE_BACK}?submitted=1`);
}

const StatusSchema = z.object({ userId: z.string().uuid() });

export async function adminVerifyTax(formData: FormData): Promise<void> {
  const parsed = StatusSchema.safeParse({ userId: formData.get('userId') });
  if (!parsed.success) redirect(`${ADMIN_BACK}?error=${encodeURIComponent('Invalid request.')}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_set_tax_status', { p_user_id: parsed.data.userId, p_status: 'verified' });
  if (error) redirect(`${ADMIN_BACK}?error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath(ADMIN_BACK);
  redirect(`${ADMIN_BACK}?verified=1`);
}

export async function adminNeedsUpdateTax(formData: FormData): Promise<void> {
  const parsed = StatusSchema.safeParse({ userId: formData.get('userId') });
  if (!parsed.success) redirect(`${ADMIN_BACK}?error=${encodeURIComponent('Invalid request.')}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_set_tax_status', { p_user_id: parsed.data.userId, p_status: 'needs_update' });
  if (error) redirect(`${ADMIN_BACK}?error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath(ADMIN_BACK);
  redirect(`${ADMIN_BACK}?updated=1`);
}

const ExemptSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export async function adminExemptTax(formData: FormData): Promise<void> {
  const parsed = ExemptSchema.safeParse({ userId: formData.get('userId'), reason: formData.get('reason') });
  if (!parsed.success) redirect(`${ADMIN_BACK}?error=${encodeURIComponent('An exemption requires a reason.')}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_set_tax_exemption', {
    p_user_id: parsed.data.userId, p_exempt: true, p_reason: parsed.data.reason,
  });
  if (error) redirect(`${ADMIN_BACK}?error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath(ADMIN_BACK);
  redirect(`${ADMIN_BACK}?exempt=1`);
}

/** Admin reveals a stored TIN (audited). Returns plaintext to the admin only. */
export async function revealTaxId(userId: string): Promise<{ taxId?: string; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.functions.invoke('tax-vault', {
    body: { action: 'reveal', user_id: userId },
  });
  const errMsg = error?.message || (data as { error?: string } | null)?.error;
  if (errMsg) return { error: friendly(errMsg) };
  return { taxId: (data as { tax_id?: string }).tax_id };
}
