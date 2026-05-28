// ════════════════════════════════════════════════════════════════════════════
//  src/data/specialties.ts — mobile adapter for the unified taxonomy
//
//  Phase 0B (Layer 5 finish) moved the canonical specialty taxonomy into
//  @nexpec/shared-core/data/specialtyTaxonomy. This file is now a thin
//  adapter that re-shapes the canonical kebab-case data into the legacy
//  mobile shape (SpecialtyOption with `name`, `description`, `group`,
//  `synonyms`; SpecialtyGroup with `slug`, `name`, `disciplineSlugs`).
//
//  WHAT CHANGED
//  ────────────
//  Before Phase 0B, this file held its own snake_case taxonomy of ~58
//  disciplines that DID NOT OVERLAP with web's 277 kebab-case slugs.
//  Inspector profiles created on mobile and jobs posted from web were
//  writing different identifiers into the same DB columns, so the
//  matching engine could never intersect them.
//
//  Post Phase 0B:
//    • Every mobile slug literal has been remapped to its kebab canonical
//      equivalent per PHASE_0A_SLUG_MAPPING.md.
//    • SpecialtyGroupSlug is now an alias for the canonical GroupTitle
//      string union (titles like "NDT methods", "Welding & joining"),
//      so the `group` field on each SpecialtyOption now holds a TITLE
//      not a snake slug.
//    • SQL migration 20260622120000_unify_specialty_slugs_kebab.sql
//      backfills jobs.specialty_slugs and profiles.specialty_slugs in
//      place — every existing snake row is rewritten to kebab.
//
//  ADDING A NEW SPECIALTY: edit packages/shared-core/src/data/specialtyTaxonomy.ts.
//  Do NOT add disciplines here — this file is intentionally derivative.
// ════════════════════════════════════════════════════════════════════════════

import {
  DISCIPLINES,
  GROUPS,
  SPECIALTY_BY_SLUG,
  isKnownSpecialty as canonicalIsKnown,
  CUSTOM_SLUG_PREFIX as CANONICAL_CUSTOM_SLUG_PREFIX,
  type GroupTitle,
} from '@nexpec/shared-core';

// ── Re-export the canonical CUSTOM_SLUG_PREFIX so mobile callers keep working
export const CUSTOM_SLUG_PREFIX = CANONICAL_CUSTOM_SLUG_PREFIX;

// ─── TYPES ──────────────────────────────────────────────────────────────────

/**
 * Mobile shape for a specialty discipline. The `group` field now holds a
 * canonical group TITLE (e.g. "NDT methods"), not the old snake_case
 * group slug — that change is unavoidable because the two surfaces now
 * share one source of truth.
 */
export interface SpecialtyOption {
  /** Canonical kebab-case identifier. Stored in jobs/profiles.specialty_slugs. */
  slug: string;
  /** Display name shown in the UI. */
  name: string;
  /** One-line description used in pickers + tooltips. May be empty. */
  description: string;
  /** Title of the group this specialty belongs to. */
  group: SpecialtyGroupSlug;
  /** Lowercase tokens the search bar matches in addition to `name`. */
  synonyms: string[];
}

/**
 * Type alias preserved for source-compat. Pre-Phase-0B this was a
 * snake_case literal union ('welding_materials' | 'ndt' | …); it is now
 * the canonical GroupTitle union ('NDT methods' | 'Welding & joining' | …).
 * Any code that imports SpecialtyGroupSlug and compares against a literal
 * needs to use the title spelling.
 */
export type SpecialtyGroupSlug = GroupTitle;

export interface SpecialtyGroup {
  /** Same value as `name` — kept as `slug` for backward-compat with code
   *  that did `group.slug`. The canonical identifier of a group is its title. */
  slug: SpecialtyGroupSlug;
  /** Display name (identical to slug — both are the canonical group title). */
  name: string;
  /** Slugs of disciplines in this group, in display order. */
  disciplineSlugs: string[];
}

// ─── DISCIPLINES ────────────────────────────────────────────────────────────

/**
 * Single source of truth for the industrial-inspection discipline tree.
 * Derived from @nexpec/shared-core canonical DISCIPLINES.
 */
export const SPECIALTIES: readonly SpecialtyOption[] = DISCIPLINES.map((d) => ({
  slug: d.slug,
  name: d.label,
  description: d.description ?? '',
  group: d.group,
  synonyms: [...(d.synonyms ?? [])],
}));

// ─── GROUPS ─────────────────────────────────────────────────────────────────

/**
 * Display-ordered list of groups. Derived from the canonical GROUPS.
 */
export const SPECIALTY_GROUPS: readonly SpecialtyGroup[] = GROUPS.map((g) => ({
  slug: g.title,
  name: g.title,
  disciplineSlugs: [...g.disciplineSlugs],
}));

// ─── LOOKUPS + HELPERS (mobile-side conveniences) ───────────────────────────

const SPECIALTY_BY_MOBILE_SLUG: Map<string, SpecialtyOption> = new Map(
  SPECIALTIES.map((s) => [s.slug, s]),
);

const GROUP_BY_TITLE: Map<SpecialtyGroupSlug, SpecialtyGroup> = new Map(
  SPECIALTY_GROUPS.map((g) => [g.slug, g]),
);

const CUSTOM_SLUG_MAX_BODY_LEN = 64;

/** Returns the SpecialtyOption for `slug`, or null if unknown. */
export function getSpecialty(slug: string): SpecialtyOption | null {
  return SPECIALTY_BY_MOBILE_SLUG.get(slug) ?? null;
}

/** Returns the SpecialtyGroup for `title`, or null if unknown. */
export function getSpecialtyGroup(title: string): SpecialtyGroup | null {
  return GROUP_BY_TITLE.get(title as SpecialtyGroupSlug) ?? null;
}

/** True if `slug` is a known canonical specialty (kebab-case). */
export function isKnownSpecialty(slug: string): boolean {
  return canonicalIsKnown(slug) || SPECIALTY_BY_MOBILE_SLUG.has(slug);
}

/**
 * True if `slug` follows the custom-specialty format (user-typed free-form
 * disciplines persisted with the `custom_` prefix and an encoded body).
 */
export function isCustomSpecialtySlug(slug: string): boolean {
  if (!slug.startsWith(CUSTOM_SLUG_PREFIX)) return false;
  const body = slug.slice(CUSTOM_SLUG_PREFIX.length);
  return body.length > 0 && body.length <= CUSTOM_SLUG_MAX_BODY_LEN;
}

// Surface a small bit of typing metadata for static analysis (keeps the
// import-graph contract identical to the previous file).
export { SPECIALTY_BY_SLUG };
