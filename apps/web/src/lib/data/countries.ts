// ════════════════════════════════════════════════════════════════════════════
//  lib/data/countries.ts — server-only fetcher for the country reference
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Country } from './countries.types';

export type { Country };

export async function fetchCountries(): Promise<Country[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('country_codes')
      .select('code, name')
      .order('name', { ascending: true });
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchCountries] failed:', error.message);
      }
      return [];
    }
    return (data as unknown as Country[]).map((c) => ({
      code: String(c.code ?? '').toUpperCase(),
      name: String(c.name ?? c.code ?? ''),
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchCountries] threw:', e);
    }
    return [];
  }
}
