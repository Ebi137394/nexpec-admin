// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/specialtyTaxonomy.ts
//
//  Thin re-export shim. The canonical specialty taxonomy lives in
//  packages/shared-core/src/data/specialtyTaxonomy.ts so mobile and web
//  cannot drift. This file exists only to preserve the import paths that
//  existing web code uses — every value below is the SAME identity as
//  the one in @nexpec/shared-core.
//
//  Migration note: pre-Phase-0 this file held its own kebab-case taxonomy
//  (277 slugs across 19 groups). Phase 0B moved that content into
//  shared-core and added 26 new canonical slugs imported from the old
//  mobile taxonomy (metallurgy, corrosion engineering, vibration analysis,
//  Ex/ATEX inspection, ISO auditor series, etc.). Every kebab slug that
//  used to live here still exists with the same spelling — nothing in
//  the web app's existing slug usage needs to change.
//
//  Adding a new specialty: edit
//  packages/shared-core/src/data/specialtyTaxonomy.ts. Do NOT add
//  disciplines here — this file is intentionally derivative.
// ════════════════════════════════════════════════════════════════════════════

export {
  // Canonical types and data
  type Specialty,
  type SpecialtyGroup,
  type GroupTitle,
  DISCIPLINES,
  GROUPS,
  SPECIALTY_BY_SLUG,
  GROUP_BY_TITLE,
  SPECIALTY_LABEL_BY_SLUG,
  // Helpers
  isKnownSpecialty,
  getSpecialty,
  getSpecialtyGroup,
  // Legacy shape preserved for existing web call sites: {title, items: [{slug, label}]}
  type LegacyGroupView,
  SPECIALTY_GROUPS,
  ALL_SPECIALTIES,
  // Mobile custom-slug contract (also exported here for shared utilities)
  CUSTOM_SLUG_PREFIX,
} from '@nexpec/shared-core';

// ── Type alias for source-compat with code that imports `SpecialtyOption` ──
// Pre-Phase-0, the web file exported `interface SpecialtyOption { slug; label }`.
// The legacy {slug, label} shape still ships via SPECIALTY_GROUPS[*].items;
// expose the named alias so any consumer that imports `SpecialtyOption` from
// this module keeps compiling.
import type { LegacyGroupView } from '@nexpec/shared-core';
export type SpecialtyOption = LegacyGroupView['items'][number];
