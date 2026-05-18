// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientBranding.ts — fetcher for client branding configuration
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ClientBranding } from './clientBranding.types';

export type { ClientBranding };

export async function fetchClientBranding(): Promise<ClientBranding | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'company_logo_url, report_header_text, report_footer_text, use_custom_branding, company_name',
      )
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchClientBranding] failed:', error.message);
      }
      return null;
    }

    const r = data as unknown as Record<string, unknown>;
    return {
      companyLogoUrl: (r.company_logo_url as string | null) ?? null,
      reportHeaderText: (r.report_header_text as string | null) ?? null,
      reportFooterText: (r.report_footer_text as string | null) ?? null,
      useCustomBranding: Boolean(r.use_custom_branding),
      companyName: (r.company_name as string | null) ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchClientBranding] threw:', e);
    }
    return null;
  }
}
