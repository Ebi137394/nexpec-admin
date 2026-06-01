// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/inspectorsDirectory.ts
//
//  Server-side reader for the public.inspectors_directory view. Backs:
//    • /inspectors      — directory listing with URL-driven filters
//    • /p/[userId]      — single profile card (fetchInspectorCardById)
//    • sitemap.ts       — emits one entry per active inspector
//
//  The view is the column-whitelisted public surface; this file never
//  touches public.profiles directly for unauthenticated reads.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ─────────────────────────────────────────────────────────────────── */

export interface InspectorDirectoryRow {
  id: string;
  full_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  location_city: string | null;
  location_province: string | null;
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

/**
 * ANTI-POACHING projection for the public /p/[userId] trust card. A strict
 * subset of the directory columns with EVERY identity vector removed — no
 * full_name, headline, bio, avatar_url, or city is ever requested, so none can
 * reach the page, the network tab, or the API. The opaque `id` is kept only for
 * the NX- handle, the generated sigil, and the admin-brokered hire reference.
 */
export interface InspectorTrustCard {
  id: string;
  location_province: string | null;
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

export interface DirectoryFilter {
  /** Free-text search across full_name + headline. */
  search?: string;
  /** Case-insensitive ilike on location_city. */
  city?: string;
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

export type DirectorySort =
  | 'top_rated'
  | 'most_jobs'
  | 'newest'
  | 'alphabetical';

export interface DirectoryPage {
  rows: InspectorDirectoryRow[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

/* ─────────────────────────────────────────────────────────────────── */

const VIEW_COLUMNS =
  'id, full_name, headline, bio, avatar_url, location_city, location_province, ' +
  'specialty_slugs, ndt_methods, certifications, verification_status, ' +
  'rating_average, rating_count, recommend_percent, completed_jobs_count, ' +
  'total_jobs, travel_radius_km, created_at';

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

/** Parse the sort URL param into one of the four allowed values. */
export function parseSortParam(
  raw: string | string[] | undefined,
): DirectorySort {
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  if (
    v === 'top_rated' ||
    v === 'most_jobs' ||
    v === 'newest' ||
    v === 'alphabetical'
  ) {
    return v;
  }
  return 'top_rated';
}

/** Parse the min-rating URL param into a 0-5 integer or undefined. */
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

    if (filter.city && filter.city.trim().length > 0) {
      const escaped = filter.city
        .trim()
        .replace(/[\\%_]/g, (m) => `\\${m}`);
      q = q.ilike('location_city', `%${escaped}%`);
    }

    if (filter.minRating != null) {
      q = q.gte('rating_average', filter.minRating);
    }

    if (filter.verifiedOnly) {
      q = q.eq('verification_status', 'verified');
    }

    if (filter.search && filter.search.trim().length > 0) {
      const escaped = filter.search
        .trim()
        .replace(/[\\%_]/g, (m) => `\\${m}`);
      q = q.or(`full_name.ilike.%${escaped}%,headline.ilike.%${escaped}%`);
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
 * Fetch a single inspector's public card by ID. Used by /p/[userId] when
 * the row's role is 'inspector' — this is the anon-safe path that
 * unblocks the public-profile bug. Returns null if the inspector is not
 * directory-eligible (suspended / deleted / nameless / not an inspector).
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

const TRUST_CARD_COLUMNS =
  'id, location_province, specialty_slugs, ndt_methods, certifications, ' +
  'verification_status, rating_average, rating_count, recommend_percent, ' +
  'completed_jobs_count, total_jobs, travel_radius_km, created_at';

/**
 * Fetch an inspector's ANONYMIZED trust card for the public /p/[userId] route.
 * Selects ONLY PII-free columns (see InspectorTrustCard); identity never leaves
 * the server, so there is nothing on the wire to poach. Returns null if the
 * inspector isn't directory-eligible (suspended / deleted / nameless / not an
 * inspector).
 */
export async function fetchInspectorTrustCard(
  id: string,
): Promise<InspectorTrustCard | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspectors_directory')
      .select(TRUST_CARD_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('[inspectorsDirectory] trust card query error', error);
      return null;
    }
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
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
  } catch (err) {
    console.error('[inspectorsDirectory] trust card threw', err);
    return null;
  }
}

/**
 * Fetch up to SITEMAP_CAP inspector IDs + their updated-ish-timestamps
 * for the sitemap.xml entry-per-inspector. Sorted by rating so the
 * highest-trust profiles index first.
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
      return {
        id: row.id,
        lastModified: new Date(row.created_at),
      };
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
    case 'alphabetical':
      return q.order('full_name', { ascending: true });
    case 'top_rated':
    default:
      return q
        .order('rating_average', { ascending: false, nullsFirst: false })
        .order('rating_count', { ascending: false, nullsFirst: false })
        .order('completed_jobs_count', { ascending: false, nullsFirst: false });
  }
}

function normaliseRows(raw: unknown[]): InspectorDirectoryRow[] {
  return raw.map((r) => {
    const row = r as {
      id: string;
      full_name: string | null;
      headline: string | null;
      bio: string | null;
      avatar_url: string | null;
      location_city: string | null;
      location_province: string | null;
      specialty_slugs: string[] | null;
      ndt_methods: string[] | null;
      certifications: string[] | null;
      verification_status: string | null;
      rating_average: number | string | null;
      rating_count: number | null;
      recommend_percent: number | string | null;
      completed_jobs_count: number | null;
      total_jobs: number | null;
      travel_radius_km: number | null;
      created_at: string;
    };
    return {
      id: row.id,
      full_name: row.full_name,
      headline: row.headline,
      bio: row.bio,
      avatar_url: row.avatar_url,
      location_city: row.location_city,
      location_province: row.location_province,
      specialty_slugs: row.specialty_slugs ?? [],
      ndt_methods: row.ndt_methods ?? [],
      certifications: row.certifications ?? [],
      verification_status: row.verification_status,
      rating_average:
        row.rating_average == null ? null : Number(row.rating_average),
      rating_count: row.rating_count,
      recommend_percent:
        row.recommend_percent == null ? null : Number(row.recommend_percent),
      completed_jobs_count: row.completed_jobs_count,
      total_jobs: row.total_jobs,
      travel_radius_km: row.travel_radius_km,
      created_at: row.created_at,
    };
  });
}

/* ─────────────────────────────────────────────────────────────────── */

export const DIRECTORY_DEFAULTS = {
  PAGE_SIZE: DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} as const;
