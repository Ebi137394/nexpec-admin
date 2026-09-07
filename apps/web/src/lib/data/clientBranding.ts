// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientBranding.ts — fetcher for client branding configuration
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ClientBranding } from './clientBranding.types';

export type { ClientBranding };

const LOGO_BUCKET = 'branding_assets';
const LOGO_URL_TTL_SECONDS = 300;

/** Mint a short-lived signed URL for a private logo object. Never persist the
 *  result: it expires, and an expired stored URL cannot be told apart from a
 *  broken one. */
async function signLogo(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  path: string | null,
  legacyUrl: string | null,
): Promise<string | null> {
  if (path) {
    try {
      const { data, error } = await supabase.storage
        .from(LOGO_BUCKET)
        .createSignedUrl(path, LOGO_URL_TTL_SECONDS);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      /* fall through to the legacy value */
    }
  }
  // Only an absolute legacy URL is usable directly.
  if (legacyUrl && /^https?:\/\//.test(legacyUrl)) return legacyUrl;
  return null;
}

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
        'company_logo_url, company_logo_path, report_header_text, report_footer_text, use_custom_branding, company_name',
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
      // branding_assets is private, so the canonical company_logo_path is
      // signed at READ time. company_logo_url is only honoured when it is a
      // legacy absolute URL — a stored public URL of a private bucket was the
      // original defect and is no longer written.
      companyLogoUrl: await signLogo(
        supabase,
        (r.company_logo_path as string | null) ?? null,
        (r.company_logo_url as string | null) ?? null,
      ),
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
