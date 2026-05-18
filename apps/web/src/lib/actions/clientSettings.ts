// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/clientSettings.ts — server action: update client profile
//
//  GOLDEN_RULE_2 — Zod schema explicitly accepts ONLY client-side fields.
//  Submitting any payout / role / verification field through this action
//  is dropped by the validator. Role mutations live in admin RPCs, never
//  in self-service surfaces.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UpdateClientProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { message: 'Tell us your name.' })
    .max(80, { message: 'Name is too long.' }),
  companyName: z
    .string()
    .trim()
    .max(120, { message: 'Company name is too long.' })
    .optional()
    .or(z.literal('')),
  phone: z
    .string()
    .trim()
    .max(40, { message: 'Phone is too long.' })
    .optional()
    .or(z.literal('')),
});

function buildRedirect(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/client/settings?${qs}` : '/client/settings';
}

export async function updateClientSettings(formData: FormData): Promise<void> {
  const parsed = UpdateClientProfileSchema.safeParse({
    fullName: formData.get('fullName'),
    companyName: formData.get('companyName'),
    phone: formData.get('phone'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not save — check the form.';
    redirect(buildRedirect({ error: msg }));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/client/settings'));
  }

  // GOLDEN_RULE_2 — explicit field list. Never expand this object with
  // payout/role/verification fields. RLS on profiles SHOULD prevent
  // self-writes to those columns; this is belt-and-braces.
  const update = {
    full_name: parsed.data.fullName,
    company_name: parsed.data.companyName?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[updateClientSettings] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildRedirect({
        error: 'Could not save profile. Try again or contact support.',
      }),
    );
  }

  revalidatePath('/client/settings');
  revalidatePath('/client', 'layout'); // re-render Header userLabel
  redirect(buildRedirect({ saved: '1' }));
}
