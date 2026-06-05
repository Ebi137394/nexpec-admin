// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/clientBranding.ts — update client report-branding fields
//
//  STRICT FIELD ALLOWLIST. Header/footer text + toggle only. company_logo_url
//  is written by the separate uploadCompanyLogo server action (multipart
//  uploads can't share a single form with text submits without colliding).
//
//  primary_color is intentionally omitted — column unconfirmed on schema.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UpdateBrandingSchema = z.object({
  reportHeaderText: z
    .string()
    .trim()
    .max(500, { message: 'Header text exceeds 500 chars.' })
    .optional()
    .or(z.literal('')),
  reportFooterText: z
    .string()
    .trim()
    .max(500, { message: 'Footer text exceeds 500 chars.' })
    .optional()
    .or(z.literal('')),
  useCustomBranding: z
    .preprocess(
      (v) => v === 'on' || v === 'true' || v === true,
      z.boolean(),
    )
    .default(false),
});

function buildRedirect(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/client/branding-settings?${qs}` : '/client/branding-settings';
}

export async function updateClientBranding(formData: FormData): Promise<void> {
  const parsed = UpdateBrandingSchema.safeParse({
    reportHeaderText: formData.get('reportHeaderText'),
    reportFooterText: formData.get('reportFooterText'),
    useCustomBranding: formData.get('useCustomBranding'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not save, check the form.';
    redirect(buildRedirect({ error: msg }));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/client/branding-settings'));
  }

  const update = {
    report_header_text: parsed.data.reportHeaderText?.trim() || null,
    report_footer_text: parsed.data.reportFooterText?.trim() || null,
    use_custom_branding: parsed.data.useCustomBranding,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[updateClientBranding] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildRedirect({
        error: 'Could not save branding. Try again or contact support.',
      }),
    );
  }

  revalidatePath('/client/branding-settings');
  redirect(buildRedirect({ saved: '1' }));
}
