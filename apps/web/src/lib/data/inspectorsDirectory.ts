// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/inspectorsDirectory.ts
//
//  Server-side reader for the ANONYMIZED public.inspectors_directory view. Backs:
//    • /inspectors      — directory listing with URL-driven filters
//    • /p/[userId]      — single trust card (fetchInspectorTrustCard)
//    • sitemap.ts       — emits one entry per active inspector
//
//  ANTI-POACHING: the view emits ZERO PII (no name, photo, bio, headline, city).
//  Every row is the opaque UUID `id` (→ derive an NX- handle + sigil client-side)
//  plus a coarse region, verified competencies, and performance metrics. There is
//  no free-text name search and no alphabetical-by-name sort — those signals do
//  not exist on the wire anymore.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ─────────────────────────────────────────────────────────────────── */

export interface InspectorDirectoryRow {
  id: string;
  location_province: string | null; // coarse region only (no city)
  specialty_slugs: string[];
  ndt_methods: string[];
  certifications: string[];
  verification_status: string | null;
  rating_average: number | null;
  rating_count: number | null;
  recommend_percent: number | null;
  completed_jobs_count: number | null;
  total_jobs: number | null;
  travel_radius_km: number | null;
  created_at: string;
}

/** Alias — the public /p trust card is exactly the anonymized directory row. */
export type InspectorTrustCard = InspectorDirectoryRow;

export interface DirectoryFilter {
  /** Coarse region filter — case-insensitive ilike on location_province. */
  region?: string;
  /** Inspector must have AT LEAST ONE of these kebab specialty slugs. */
  specialties: string[];
  /** Minimum aggregate rating (0-5). */
  minRating?: number;
  /** Verified inspectors only. */
  verifiedOnly?: boolean;
  /** Sort option. */
  sort: DirectorySort;
  /** 1-based page number. */
  page: number;
  /** Page size. Capped to 48. */
  pageSize: number;
}

// Name-based sort removed — the marketplace is pseudonymous.
export type DirectorySort = 'top_rated' | 'most_jobs' | 'newest';

export interface DirectoryPage {
  rows: InspectorDirectoryRow[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

/* ─────────────────────────────────────────────────────────────────── */

const VIEW_COLUMNS =
  'id, location_province, specialty_slugs, ndt_methods, certifications, ' +
  'verification_status, rating_average, rating_count, recommend_percent, ' +
  'completed_jobs_count, total_jobs, travel_radius_km, created_at';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const SITEMAP_CAP = 1000;

/* ─────────────────────────────────────────────────────────────────── */

/** Parse the comma-separated `specialties` URL param into kebab slugs. */
export function parseSpecialtiesParam(
  raw: string | string[] | undefined,
): string[] {
  if (!raw) return [];
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  return flat
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && /^[a-z][a-z0-9-]*$/.test(s));
}

/** Parse the sort URL param into one of the allowed values. */
export function parseSortParam(
  raw: string | string[] | undefined,
): DirectorySort {
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  if (v === 'top_rated' || v === 'most_jobs' || v === 'newest') {
    return v;
  }
  return 'top_rated';
}

/** Parse the min-rating URL param into a 0-5 number or undefined. */
export function parseMinRatingParam(
  raw: string | string[] | undefined,
): number | undefined {
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  const n = parseFloat(v ?? '');
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.max(0, Math.min(5, n));
  return clamped > 0 ? clamped : undefined;
}

/* ─────────────────────────────────────────────────────────────────── */

/**
 * Fetch one page of inspectors matching the filter. Never throws — on
 * data-layer failure returns an empty page with a logged error.
 */
export async function fetchInspectorsDirectoryPage(
  filter: DirectoryFilter,
): Promise<DirectoryPage> {
  const pageSize = Math.min(filter.pageSize, MAX_PAGE_SIZE);
  const page = Math.max(1, filter.page);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const supabase = await createSupabaseServerClient();

    let q = supabase
      .from('inspectors_directory')
      .select(VIEW_COLUMNS, { count: 'exact' });

    if (filter.specialties.length > 0) {
      q = q.overlaps('specialty_slugs', filter.specialties);
    }

    if (filter.region && filter.region.trim().length > 0) {
      const escaped = filter.region.trim().replace(/[\\%_]/g, (m) => `\\${m}`);
      q = q.ilike('location_province', `%${escaped}%`);
    }

    if (filter.minRating != null) {
      q = q.gte('rating_average', filter.minRating);
    }

    if (filter.verifiedOnly) {
      q = q.eq('verification_status', 'verified');
    }

    q = applySort(q, filter.sort).range(from, to);

    const { data, error, count } = await q;
    if (error) {
      console.error('[inspectorsDirectory] page query error', error);
      return { rows: [], total: 0, totalPages: 0, page, pageSize };
    }

    const rows = normaliseRows(data ?? []);
    const total = count ?? rows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return { rows, total, totalPages, page, pageSize };
  } catch (err) {
    console.error('[inspectorsDirectory] page threw', err);
    return { rows: [], total: 0, totalPages: 0, page, pageSize };
  }
}

/**
 * Fetch a single inspector's anonymized card by ID. Returns null if the
 * inspector isn't directory-eligible (suspended / deleted / nameless / not an
 * inspector). Emits no PII.
 */
export async function fetchInspectorCardById(
  id: string,
): Promise<InspectorDirectoryRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspectors_directory')
      .select(VIEW_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('[inspectorsDirectory] card query error', error);
      return null;
    }
    if (!data) return null;
    return normaliseRows([data])[0] ?? null;
  } catch (err) {
    console.error('[inspectorsDirectory] card threw', err);
    return null;
  }
}

/**
 * The public /p/[userId] trust card. Identical to the anonymized directory row —
 * named separately for call-site clarity. Emits no PII.
 */
export async function fetchInspectorTrustCard(
  id: string,
): Promise<InspectorTrustCard | null> {
  return fetchInspectorCardById(id);
}

/**
 * Fetch up to SITEMAP_CAP inspector IDs + timestamps for sitemap.xml.
 */
export async function fetchInspectorIdsForSitemap(): Promise<
  Array<{ id: string; lastModified: Date }>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspectors_directory')
      .select('id, created_at')
      .order('rating_average', { ascending: false, nullsFirst: false })
      .order('completed_jobs_count', { ascending: false, nullsFirst: false })
      .limit(SITEMAP_CAP);
    if (error) {
      console.error('[inspectorsDirectory] sitemap query error', error);
      return [];
    }
    return (data ?? []).map((r) => {
      const row = r as { id: string; created_at: string };
      return { id: row.id, lastModified: new Date(row.created_at) };
    });
  } catch (err) {
    console.error('[inspectorsDirectory] sitemap threw', err);
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────────── */

function applySort<
  T extends {
    order: (
      column: string,
      options?: { ascending?: boolean; nullsFirst?: boolean },
    ) => T;
  },
>(q: T, sort: DirectorySort): T {
  switch (sort) {
    case 'most_jobs':
      return q
        .order('completed_jobs_count', { ascending: false, nullsFirst: false })
        .order('rating_average', { ascending: false, nullsFirst: false });
    case 'newest':
      return q.order('created_at', { ascending: false });
    case 'top_rated':
    default:
      return q
        .order('rating_average', { ascending: false, nullsFirst: false })
        .order('rating_count', { ascending: false, nullsFirst: false })
        .order('completed_jobs_count', { ascending: false, nullsFirst: false });
  }
}

function normaliseRows(raw: unknown[]): InspectorDirectoryRow[] {
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return raw.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      location_province: (row.location_province as string | null) ?? null,
      specialty_slugs: (row.specialty_slugs as string[] | null) ?? [],
      ndt_methods: (row.ndt_methods as string[] | null) ?? [],
      certifications: (row.certifications as string[] | null) ?? [],
      verification_status: (row.verification_status as string | null) ?? null,
      rating_average: num(row.rating_average),
      rating_count: (row.rating_count as number | null) ?? null,
      recommend_percent: num(row.recommend_percent),
      completed_jobs_count: (row.completed_jobs_count as number | null) ?? null,
      total_jobs: (row.total_jobs as number | null) ?? null,
      travel_radius_km: (row.travel_radius_km as number | null) ?? null,
      created_at: String(row.created_at),
    };
  });
}

/* ─────────────────────────────────────────────────────────────────── */

export const DIRECTORY_DEFAULTS = {
  PAGE_SIZE: DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} as const;
