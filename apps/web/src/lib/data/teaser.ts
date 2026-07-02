// ════════════════════════════════════════════════════════════════════════════
//  lib/data/teaser.ts — public Teaser Marketplace data layer (RSC / ISR)
//
//  Reads the two anon-granted, privacy-isolated projections shipped in
//  migrations 20260801170000 (public_supply_feed) + 20260801172000
//  (public_demand_feed). These views emit ZERO PII by construction — handles,
//  sanitized fields, coarse timeframes only.
//
//  IMPORTANT: we use a COOKIELESS anon client (a static empty cookie store) so
//  this module never touches next/headers `cookies()`. That keeps any consuming
//  Server Component statically renderable / ISR-cacheable (revalidate). The
//  public feeds need no session, so anon is exactly right.
//
//  Fail-closed: every read degrades to [] / 0 on error, never throws to the UI.
// ════════════════════════════════════════════════════════════════════════════
import { createServerClient } from '@supabase/ssr';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function anonClient() {
  if (!URL || !ANON) return null;
  // Empty, no-op cookie adapter → no next/headers access → ISR-safe anon reads.
  return createServerClient(URL, ANON, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

// ── Types (mirror the view column lists) ──
export type SupplyKind = 'inspector' | 'agency_pool';
export interface SupplyTeaser {
  handle: string;
  source_kind: SupplyKind;
  specialty_slugs: string[] | null;
  certifications: string[] | null;
  location_city: string | null;
  location_province: string | null;
  country: string | null;
  rating_average: number | string | null; // PostgREST may serialize numeric as string
  rating_count: number | null;
  completed_jobs_count: number | null;
  is_available: boolean | null;
  is_featured: boolean | null;
  pool_size: number | null; // agency_pool: live inspector count; inspector: null
  rate_band: string | null; // coarse tier ($ / $$ / $$$); never the exact rate
}

export type DemandKind = 'client_job' | 'enterprise_mission' | 'agency_tender' | 'rfq';
export interface DemandTeaser {
  ref: string; // nx_handle(job.id) — stable opaque anchor for the canonical page
  source_kind: DemandKind;
  domain: string | null;
  specialty_slugs: string[] | null;
  location_city: string | null;
  country: string | null;
  timeframe: string | null;
  posted_at: string | null;
}

export interface TeaserStats {
  openDemand: number;
  vettedTalent: number;
}

const SUPPLY_COLS =
  'handle, source_kind, specialty_slugs, certifications, location_city, location_province, country, rating_average, rating_count, completed_jobs_count, is_available, is_featured, pool_size, rate_band';
const DEMAND_COLS =
  'ref, source_kind, domain, specialty_slugs, location_city, country, timeframe, posted_at';

// ── Reads ──
export async function fetchSupplyTeasers(limit = 6): Promise<SupplyTeaser[]> {
  const sb = anonClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('public_supply_feed')
    // Featured first (admin curation), then by rating — mirrors the mobile Discover
    // feed so Inspector Spotlights are surfaced consistently across platforms.
    .select(SUPPLY_COLS)
    .order('is_featured', { ascending: false, nullsFirst: false })
    .order('rating_average', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as SupplyTeaser[];
}

export async function fetchDemandTeasers(limit = 6): Promise<DemandTeaser[]> {
  const sb = anonClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('public_demand_feed')
    .select(DEMAND_COLS)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as DemandTeaser[];
}

export async function fetchTeaserStats(): Promise<TeaserStats> {
  const sb = anonClient();
  if (!sb) return { openDemand: 0, vettedTalent: 0 };
  const [d, s] = await Promise.all([
    sb.from('public_demand_feed').select('*', { count: 'exact', head: true }),
    sb.from('public_supply_feed').select('*', { count: 'exact', head: true }),
  ]);
  return { openDemand: d.count ?? 0, vettedTalent: s.count ?? 0 };
}

// ── Label + format helpers (i18n-light; the feeds emit canonical slugs) ──
export const DOMAIN_LABELS: Record<string, string> = {
  industrial_ndt: 'Industrial & NDT',
  civil_construction: 'Civil & Construction',
  electrical: 'Electrical',
  mechanical_field: 'Mechanical Field',
  chemical_process: 'Chemical & Process',
};

export function humanizeSlug(slug: string): string {
  return (
    DOMAIN_LABELS[slug] ??
    slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function domainLabel(domain: string | null): string {
  if (!domain) return 'Inspection';
  return DOMAIN_LABELS[domain] ?? humanizeSlug(domain);
}

// Title for a demand item — RFQs read as sourcing requests, jobs as inspections.
export function demandTitle(job: Pick<DemandTeaser, 'source_kind' | 'domain'>): string {
  if (job.source_kind === 'rfq') {
    return `${job.domain ? domainLabel(job.domain) + ' ' : ''}Sourcing RFQ`;
  }
  return `${domainLabel(job.domain)} Inspection`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// ── Per-item lookups (canonical pages) ──
export async function fetchSupplyTeaserByHandle(handle: string): Promise<SupplyTeaser | null> {
  const sb = anonClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('public_supply_feed')
    .select(SUPPLY_COLS)
    .eq('handle', handle)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as unknown as SupplyTeaser | null;
}

export async function fetchDemandTeaserByRef(ref: string): Promise<DemandTeaser | null> {
  const sb = anonClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('public_demand_feed')
    .select(DEMAND_COLS)
    .eq('ref', ref)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as unknown as DemandTeaser | null;
}

// For generateStaticParams (pre-render the live set; new rows fall back to
// on-demand ISR via dynamicParams).
export async function fetchAllSupplyHandles(limit = 1000): Promise<string[]> {
  const sb = anonClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('public_supply_feed')
    .select('handle')
    .eq('source_kind', 'inspector') // individual talent pages only
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Array<{ handle: string }>).map((r) => r.handle).filter(Boolean);
}

export async function fetchAllAgencyHandles(limit = 1000): Promise<string[]> {
  const sb = anonClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('public_supply_feed')
    .select('handle')
    .eq('source_kind', 'agency_pool')
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Array<{ handle: string }>).map((r) => r.handle).filter(Boolean);
}

export async function fetchAllDemand(limit = 1000): Promise<DemandTeaser[]> {
  const sb = anonClient();
  if (!sb) return [];
  const { data, error } = await sb.from('public_demand_feed').select(DEMAND_COLS).limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as DemandTeaser[];
}

// ── URL / slug helpers ──
export function slugify(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function talentPath(handle: string): string {
  return `/talent/${handle}`;
}

export function agencyPath(handle: string): string {
  return `/agency/${handle}`;
}

// Descriptive, SEO-friendly slug that ends with the opaque ref (NX-XXXXXX).
export function inspectionSlug(
  job: Pick<DemandTeaser, 'domain' | 'location_city' | 'ref'>,
): string {
  const parts = [domainLabel(job.domain), job.location_city ?? '', 'inspection']
    .map(slugify)
    .filter(Boolean);
  return `${parts.join('-')}-${job.ref}`;
}

export function inspectionPath(
  job: Pick<DemandTeaser, 'domain' | 'location_city' | 'ref'>,
): string {
  return `/inspections/${inspectionSlug(job)}`;
}

// Extract the trailing NX- ref from a descriptive slug (case-insensitive → upper).
export function parseRefFromSlug(slug: string): string | null {
  const m = slug.match(/NX-[0-9A-Z]{6}$/i);
  return m ? m[0].toUpperCase() : null;
}
