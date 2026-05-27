// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/inspectionDomains.ts
//
//  Server-side reader for the public.inspection_domains config table
//  (introduced by migration 20260616120000_inspection_domain_primitive.sql).
//
//  Read access is governed by the table's RLS:
//    • inspection_domains_read_all     — every authenticated user sees rows
//    • inspection_domains_admin_write  — only super_admin can mutate
//
//  This fetcher reads only; mutations live in
//  apps/web/src/lib/actions/inspectionDomains.ts.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface InspectionDomainRow {
  slug: string;
  display_name: string;
  persona_label: string;
  short_pitch: string;
  description_md: string | null;
  icon_key: string;
  tint_hex: string;
  landing_url_slug: string | null;
  regulatory_bodies: string[];
  default_specialty_groups: string[];
  is_launched: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = [
  'slug',
  'display_name',
  'persona_label',
  'short_pitch',
  'description_md',
  'icon_key',
  'tint_hex',
  'landing_url_slug',
  'regulatory_bodies',
  'default_specialty_groups',
  'is_launched',
  'is_active',
  'display_order',
  'created_at',
  'updated_at',
].join(', ');

/**
 * Fetch every inspection_domain config row, ordered for display.
 * Returns an empty array on any error rather than throwing — the admin
 * surface degrades gracefully when the migration hasn't been applied
 * to the connected database yet.
 */
export async function fetchInspectionDomains(): Promise<InspectionDomainRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspection_domains')
      .select(COLUMNS)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[inspectionDomains.fetchInspectionDomains] error', error);
      return [];
    }
    return (data ?? []) as unknown as InspectionDomainRow[];
  } catch (err) {
    console.error('[inspectionDomains.fetchInspectionDomains] threw', err);
    return [];
  }
}

/**
 * Quick metric strip for the admin dashboard: counts of jobs per domain.
 * Honest reporting — uses the new public.jobs.domain column.
 */
export interface DomainJobCounts {
  slug: string;
  count: number;
}

export async function fetchJobCountsByDomain(): Promise<DomainJobCounts[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('domain')
      .is('deleted_at', null);

    if (error) {
      console.error('[inspectionDomains.fetchJobCountsByDomain] error', error);
      return [];
    }

    const tally = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ domain: string }>) {
      tally.set(row.domain, (tally.get(row.domain) ?? 0) + 1);
    }
    return Array.from(tally.entries()).map(([slug, count]) => ({ slug, count }));
  } catch (err) {
    console.error('[inspectionDomains.fetchJobCountsByDomain] threw', err);
    return [];
  }
}
