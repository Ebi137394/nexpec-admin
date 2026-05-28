// ════════════════════════════════════════════════════════════════════════════
//  schemas/inspectionDomain.ts — canonical inspection-domain primitive
//
//  Layer 1 of the multi-domain expansion (migration
//  20260616120000_inspection_domain_primitive.sql) introduced the
//  `public.inspection_domain` ENUM on the database. This module is the
//  cross-platform mirror — mobile (Expo) and web (Next.js) import the
//  identical set of slugs, labels, and metadata from here, so the two
//  surfaces structurally cannot drift.
//
//  Adding a fifth domain in the future means:
//    1. Adding its slug to `INSPECTION_DOMAIN_SLUGS`.
//    2. Adding its meta to `INSPECTION_DOMAIN_META`.
//    3. Adding the ENUM value to the database via ALTER TYPE.
//    4. Inserting the config row into `public.inspection_domains`.
//
//  Steps 3 and 4 happen in a follow-up migration. Steps 1 and 2 are this
//  module. Both must ship in the same release.
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

/**
 * Every inspection domain NEXPEC currently models. Order is platform
 * launch order — `industrial_ndt` is the legacy / current production
 * domain; the three new domains are gated by `inspection_domains.is_launched`
 * at the database layer.
 *
 * NEVER rename a slug. They are written into `jobs.domain`,
 * `inspection_reports.domain`, `inspector_domain_practice.domain`, and the
 * `inspection_domains` config table.
 */
export const INSPECTION_DOMAIN_SLUGS = [
  'industrial_ndt',
  'civil_construction',
  'electrical',
  'mechanical_field',
  // Layer 5 expansion — Chemical & Process Engineering.
  // Process Safety Management (OSHA 1910.119), EPA Risk Management Programs,
  // hazardous-process validation, batch-chemistry inspection across
  // refining, petrochemical, and specialty-chemical sites. Gated by
  // inspection_domains.is_launched at the DB layer — invisible on
  // consumer surfaces until launched.
  'chemical_process',
] as const;

export type InspectionDomainSlug = (typeof INSPECTION_DOMAIN_SLUGS)[number];

/**
 * Zod parser for any string claiming to be an inspection-domain slug.
 * Use this at every form boundary, every RPC input, every URL param.
 */
export const inspectionDomainSlug = z.enum(INSPECTION_DOMAIN_SLUGS);

/**
 * The platform default. Every existing row (jobs, reports, scope templates,
 * inspector practices) is backfilled to this value. Until Layer 5+ we
 * also use it as the implicit value for any code path that doesn't
 * yet thread a domain through.
 */
export const DEFAULT_INSPECTION_DOMAIN: InspectionDomainSlug = 'industrial_ndt';

/**
 * Icon key — abstract identifier mapped to a concrete icon at the
 * presentation layer. We cannot ship `lucide-react` (web) and
 * `lucide-react-native` (mobile) symbols here because they are
 * different packages with different runtimes.
 *
 * Each surface's <InspectionDomainBadge> reads this key and maps it
 * to its own icon source.
 */
export const INSPECTION_DOMAIN_ICON_KEYS = [
  'shield',
  'building',
  'zap',
  'wrench',
  // Layer 5 — Chemical & Process. Each badge component maps this key
  // to the Lucide `FlaskConical` icon (lucide-react / lucide-react-native).
  'flask',
] as const;
export type InspectionDomainIconKey =
  (typeof INSPECTION_DOMAIN_ICON_KEYS)[number];

export interface InspectionDomainDisplayMeta {
  slug: InspectionDomainSlug;
  /** Title-case, customer-facing. Used in badges, headers, marketing copy. */
  label: string;
  /** Abstract icon identifier. Each platform resolves this to its own Lucide variant. */
  iconKey: InspectionDomainIconKey;
}

/**
 * Single source of truth for display metadata. The `inspection_domains`
 * table on the database carries richer marketing data (persona, pitch,
 * regulatory bodies) for the admin management surface; these three
 * fields are the universally cacheable subset that every client UI
 * needs without a database round-trip.
 */
export const INSPECTION_DOMAIN_META: Readonly<
  Record<InspectionDomainSlug, InspectionDomainDisplayMeta>
> = {
  industrial_ndt: {
    slug: 'industrial_ndt',
    label: 'Industrial & NDT',
    iconKey: 'shield',
  },
  civil_construction: {
    slug: 'civil_construction',
    label: 'Civil',
    iconKey: 'building',
  },
  electrical: {
    slug: 'electrical',
    label: 'Electrical',
    iconKey: 'zap',
  },
  mechanical_field: {
    slug: 'mechanical_field',
    label: 'Mechanical',
    iconKey: 'wrench',
  },
  chemical_process: {
    slug: 'chemical_process',
    label: 'Chemical & Process',
    iconKey: 'flask',
  },
};

/**
 * Type guard for narrowing arbitrary strings to known slugs. Useful
 * when reading domain values back from PostgREST — the wire type is
 * `string`, the in-memory type should be the union.
 */
export function isInspectionDomainSlug(
  value: unknown,
): value is InspectionDomainSlug {
  return (
    typeof value === 'string' &&
    (INSPECTION_DOMAIN_SLUGS as readonly string[]).includes(value)
  );
}

/**
 * Convenience accessor — returns the meta row for a slug, or null if
 * the slug is unknown (i.e. a future domain not yet defined in this
 * module). Callers can render nothing on null to remain forward-compatible.
 */
export function getInspectionDomainMeta(
  slug: string | null | undefined,
): InspectionDomainDisplayMeta | null {
  if (!slug || !isInspectionDomainSlug(slug)) return null;
  return INSPECTION_DOMAIN_META[slug];
}
