// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/supplierContracts.ts — the only way the Supplier Agreement is
//  mutated from the web:
//    adminGenerateSupplierContract  → admin_generate_supplier_contract
//    supplierSignContract           → supplier_sign_contract
//    adminCountersignSupplierContract → admin_countersign_supplier_contract (executes + seals)
//
//  All wrap SECURITY DEFINER, RLS/role-gated RPCs. Typed name + timestamp + IP +
//  user-agent become the e-signature evidence (ESIGN / eIDAS).
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_BACK = '/admin/supplier-payouts';

async function clientIp(): Promise<string | null> {
  const h = (await headers()).get('x-forwarded-for') ?? null;
  return h ? h.split(',')[0]?.trim() ?? null : null;
}

/* ─── ADMIN: generate the agreement for an awarded quote ─────────────── */

const GenerateSchema = z.object({
  quoteId: z.string().regex(UUID),
  contractTextMd: z.string().trim().max(50_000).optional().or(z.literal('')),
  customContractUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .optional()
    .or(z.literal('')),
});

export async function adminGenerateSupplierContract(
  formData: FormData,
): Promise<void> {
  const parsed = GenerateSchema.safeParse({
    quoteId: formData.get('quoteId'),
    contractTextMd: formData.get('contractTextMd') ?? '',
    customContractUrl: formData.get('customContractUrl') ?? '',
  });
  if (!parsed.success) {
    redirect(
      `${ADMIN_BACK}?error=` +
        encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid input.'),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_generate_supplier_contract', {
    p_quote_id: parsed.data.quoteId,
    p_contract_text_md: parsed.data.contractTextMd || null,
    p_custom_contract_url: parsed.data.customContractUrl || null,
  });
  if (error) {
    const msg = error.message.includes('CONTRACT_REQUIRES_AWARD')
      ? 'The quote must be awarded before generating an agreement.'
      : error.message;
    redirect(`${ADMIN_BACK}?error=` + encodeURIComponent(msg));
  }
  revalidatePath(ADMIN_BACK);
  revalidatePath('/suppliers/contracts');
  redirect(`${ADMIN_BACK}?generated=1`);
}

/* ─── SUPPLIER: sign ─────────────────────────────────────────────────── */

const SignSchema = z.object({
  contractId: z.string().regex(UUID),
  typedName: z.string().trim().min(2).max(160),
  termsAccepted: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.literal(true, { message: 'Tick the box to sign.' }),
  ),
});

export async function supplierSignContract(formData: FormData): Promise<void> {
  const parsed = SignSchema.safeParse({
    contractId: formData.get('contractId'),
    typedName: formData.get('typedName'),
    termsAccepted: formData.get('termsAccepted'),
  });
  if (!parsed.success) {
    const id = String(formData.get('contractId') ?? '');
    redirect(
      `/suppliers/contracts/${id}?error=` +
        encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid input.'),
    );
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('supplier_sign_contract', {
    p_contract_id: parsed.data.contractId,
    p_typed_name: parsed.data.typedName,
    p_ip: await clientIp(),
  });
  if (error) {
    redirect(
      `/suppliers/contracts/${parsed.data.contractId}?error=` +
        encodeURIComponent(error.message),
    );
  }
  revalidatePath(`/suppliers/contracts/${parsed.data.contractId}`);
  revalidatePath('/suppliers/contracts');
  revalidatePath(ADMIN_BACK);
  redirect(`/suppliers/contracts/${parsed.data.contractId}?signed=1`);
}

/* ─── ADMIN: countersign → execute + seal ────────────────────────────── */

const CountersignSchema = z.object({
  contractId: z.string().regex(UUID),
  typedName: z.string().trim().min(2).max(160),
  termsAccepted: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.literal(true, { message: 'Tick the box to countersign.' }),
  ),
});

export async function adminCountersignSupplierContract(
  formData: FormData,
): Promise<void> {
  const parsed = CountersignSchema.safeParse({
    contractId: formData.get('contractId'),
    typedName: formData.get('typedName'),
    termsAccepted: formData.get('termsAccepted'),
  });
  if (!parsed.success) {
    redirect(
      `${ADMIN_BACK}?error=` +
        encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid input.'),
    );
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_countersign_supplier_contract', {
    p_contract_id: parsed.data.contractId,
    p_typed_name: parsed.data.typedName,
    p_ip: await clientIp(),
  });
  if (error) {
    redirect(`${ADMIN_BACK}?error=` + encodeURIComponent(error.message));
  }
  revalidatePath(ADMIN_BACK);
  revalidatePath('/suppliers/contracts');
  redirect(`${ADMIN_BACK}?executed=1`);
}
