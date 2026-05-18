// ════════════════════════════════════════════════════════════════════════════
//  src/data/countryCodes.ts
//  NEXPEC — JURISDICTION-002 (Phase 2 / Capture).
//
//  Client-side cache + helpers around the public.country_codes table seeded
//  in JURISDICTION-001. Source of truth is the database; this file is a
//  thin caching layer + bundle-expansion utility for the CountryPicker.
//
//  Why a cache layer?
//    • country_codes is read-by-all (RLS policy country_codes_select).
//    • The row count is small (~249) and the table is effectively static.
//    • Fetching on every picker mount would be wasteful — one fetch per
//      session covers every CountryPicker on every screen.
//
//  Why not bundle the list as a hard-coded TS constant?
//    • The DB is the source of truth (region_group can change, codes can
//      retire). A future ISO update means a SQL data patch, not a code
//      release. Keeping reads live keeps app + DB aligned.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

export interface CountryCode {
  /** ISO 3166-1 α-2, uppercase. */
  code: string;
  /** Display name (English). */
  name: string;
  /** Primary region bundle this country belongs to. */
  region_group: RegionGroupSlug | null;
}

export type RegionGroupSlug = 'EU' | 'EEA' | 'GCC' | 'USMCA';

/** Known UX bundles. EEA includes the EU members per international convention. */
export interface RegionBundle {
  slug: RegionGroupSlug;
  label: string;
  /** Which raw region_group values to union when this bundle is tapped. */
  groups: RegionGroupSlug[];
}

export const REGION_BUNDLES: readonly RegionBundle[] = [
  { slug: 'EU',    label: 'EU (27)',      groups: ['EU'] },
  // EEA = EU members + IS/LI/NO (which carry region_group='EEA' in the DB).
  { slug: 'EEA',   label: 'EU + EEA (30)', groups: ['EU', 'EEA'] },
  { slug: 'GCC',   label: 'GCC (6)',      groups: ['GCC'] },
  { slug: 'USMCA', label: 'USMCA (3)',    groups: ['USMCA'] },
];

// ─── Session-scoped cache ────────────────────────────────────────────────

let CACHED: CountryCode[] | null = null;
let INFLIGHT: Promise<CountryCode[]> | null = null;

/**
 * Loads the full country list once per session. Subsequent calls return
 * the cached array. Concurrent first-callers share the same inflight
 * promise — no thundering-herd against the country_codes table.
 */
export async function loadCountryCodes(): Promise<CountryCode[]> {
  if (CACHED) return CACHED;
  if (INFLIGHT) return INFLIGHT;

  INFLIGHT = (async () => {
    const { data, error } = await supabase
      .from('country_codes')
      .select('code, name, region_group')
      .order('name', { ascending: true });
    if (error) {
      INFLIGHT = null; // allow retry on next call
      throw error;
    }
    CACHED = (data ?? []) as CountryCode[];
    return CACHED;
  })();

  return INFLIGHT;
}

/** Force-clears the cache. Used by tests / admin tools — not for app code. */
export function _invalidateCountryCodeCache(): void {
  CACHED = null;
  INFLIGHT = null;
}

// ─── Read helpers (operate on whatever's currently cached) ───────────────

/** O(n) name lookup. Synchronous. Returns null until loadCountryCodes resolves. */
export function findCountryByCode(code: string | null | undefined): CountryCode | null {
  if (!code || !CACHED) return null;
  const u = code.toUpperCase();
  return CACHED.find((c) => c.code === u) ?? null;
}

/** Display-only name fallback that never throws. */
export function getCountryName(code: string | null | undefined): string {
  if (!code) return '';
  const found = findCountryByCode(code);
  return found?.name ?? code.toUpperCase();
}

/**
 * Expands a region bundle into its constituent ISO codes. Pure function
 * over the cached list — use after loadCountryCodes resolves.
 */
export function expandBundle(bundle: RegionBundle, all: CountryCode[]): string[] {
  return all
    .filter((c) => c.region_group !== null && bundle.groups.includes(c.region_group))
    .map((c) => c.code);
}

/**
 * Case-insensitive search across code + name. Empty query returns the
 * whole list. Pure function over the passed-in list.
 */
export function searchCountries(
  all: CountryCode[],
  query: string,
): CountryCode[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
  );
}

/** Defensive helper used at write time — strips non-α-2 garbage. */
export function normaliseCountryArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const u = v.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}
