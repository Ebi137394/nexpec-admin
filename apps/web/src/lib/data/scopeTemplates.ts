// ════════════════════════════════════════════════════════════════════════════
//  lib/data/scopeTemplates.ts — list active compliance scope templates
//
//  RLS allows any authenticated user to SELECT active rows; this fetcher
//  intentionally projects only the columns the client form needs.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CciCredentialTier,
  ScopeTemplate,
} from './scopeTemplates.types';

export type { ScopeTemplate };

export async function fetchActiveScopeTemplates(): Promise<ScopeTemplate[]> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('inspection_scope_templates')
      .select(
        'id, slug, name, category, region, validity_months, base_price_cents, requires_credential_tier, description_md, is_active',
      )
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchActiveScopeTemplates] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      category: String(r.category ?? ''),
      region: String(r.region ?? 'global'),
      validityMonths:
        typeof r.validity_months === 'number' ? r.validity_months : 12,
      basePriceCents:
        typeof r.base_price_cents === 'number' ? r.base_price_cents : 0,
      requiresCredentialTier:
        ((r.requires_credential_tier as string | null) ??
          'cci_basic') as CciCredentialTier,
      description: (r.description_md as string | null) ?? null,
      isActive: Boolean(r.is_active),
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchActiveScopeTemplates] threw:', e);
    }
    return [];
  }
}
