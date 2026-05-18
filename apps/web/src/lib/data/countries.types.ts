// ════════════════════════════════════════════════════════════════════════════
//  lib/data/countries.types.ts — ISO country reference
//
//  Backed by public.country_codes (FK target for profiles.country_of_residence
//  and jobs.job_country). Source of truth lives in the DB; this module
//  fetches once per page render and passes the list to the
//  CountryMultiSelect client component as a prop (avoids 250 rows on
//  every input keystroke).
// ════════════════════════════════════════════════════════════════════════════

export interface Country {
  /** ISO 3166-1 alpha-2 — uppercase 2-letter, e.g. 'CA', 'IR', 'US'. */
  code: string;
  /** Display name, e.g. 'Canada', 'Iran', 'United States'. */
  name: string;
}
