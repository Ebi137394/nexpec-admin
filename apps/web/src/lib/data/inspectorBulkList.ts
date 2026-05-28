// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/inspectorBulkList.ts
//
//  Server-side reader for the /admin/users/specialties-bulk page. Pulls
//  the inspector list under a filter the admin can drive via URL params.
//
//  Filter spec:
//    • has[]    — inspector must have at least ONE of these slugs
//    • hasnt[]  — inspector must NOT have ANY of these slugs
//    • search   — case-insensitive ilike on full_name OR email
//
//  PostgREST has the && operator (overlaps), but no native NOT-overlaps,
//  so the `hasnt` filter is applied client-side after the query.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface BulkInspectorRow {
  id: string;
  full_name: string | null;
  email: string | null;
  specialty_slugs: string[];
  rating_average: number | null;
  rating_count: number | null;
  completed_jobs_count: number | null;
}

export interface BulkInspectorFilter {
  /** Slugs the inspector must have at least one of. */
  has: string[];
  /** Slugs the inspector must NOT have any of. */
  hasnt: string[];
  /** Free-text search across full_name + email. */
  search?: string;
  /** Page size cap. Default 100, hard ceiling 500. */
  limit?: number;
}

/**
 * Parse a comma-separated URL param into a clean kebab-slug array.
 * Drops empties, normalises whitespace, lowercases. Caller provides the
 * raw string — typically `searchParams.has` from the page.
 */
export function parseSlugList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  return flat
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && /^[a-z][a-z0-9-]*$/.test(s));
}

/**
 * Pull the inspector list matching the filter. Never throws — returns
 * an empty array on any data-layer error (the page renders gracefully).
 */
export async function fetchBulkInspectorList(
  filter: BulkInspectorFilter,
): Promise<BulkInspectorRow[]> {
  const limit = Math.min(filter.limit ?? 100, 500);
  const supabase = await createSupabaseServerClient();

  try {
    let q = supabase
      .from('profiles')
      .select(
        'id, full_name, email, specialty_slugs, rating_average, rating_count, completed_jobs_count',
      )
      .eq('role', 'inspector')
      .is('deleted_at', null);

    if (filter.has.length > 0) {
      q = q.overlaps('specialty_slugs', filter.has);
    }

    if (filter.search) {
      // Escape % and _ so a paste of a slug like 'ndt_ut' doesn't behave
      // as a wildcard. The admin can still wildcard intentionally by
      // including the literal % in the search box if they want.
      const escaped = filter.search
        .trim()
        .replace(/[\\%_]/g, (m) => `\\${m}`);
      if (escaped.length > 0) {
        q = q.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
      }
    }

    q = q.order('full_name', { ascending: true, nullsFirst: false }).limit(limit);

    const { data, error } = await q;
    if (error) {
      console.error('[inspectorBulkList] query error', error);
      return [];
    }

    const rows = (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      specialty_slugs: string[] | null;
      rating_average: number | string | null;
      rating_count: number | null;
      completed_jobs_count: number | null;
    }>;

    const normalised: BulkInspectorRow[] = rows.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      specialty_slugs: p.specialty_slugs ?? [],
      rating_average:
        p.rating_average == null ? null : Number(p.rating_average),
      rating_count: p.rating_count,
      completed_jobs_count: p.completed_jobs_count,
    }));

    // Apply the `hasnt` filter client-side.
    if (filter.hasnt.length === 0) return normalised;
    const exclude = new Set(filter.hasnt);
    return normalised.filter((p) =>
      p.specialty_slugs.every((s) => !exclude.has(s)),
    );
  } catch (err) {
    console.error('[inspectorBulkList] threw', err);
    return [];
  }
}
