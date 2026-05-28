// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/domainReadiness.ts
//
//  Server-side readiness aggregator for the /admin/domains/[slug]/readiness
//  dashboard. Computes the same Step 1 + Step 2 metrics documented in
//  DOMAIN_LAUNCH_PLAYBOOK.md, but live, against the production database.
//
//  Step 1 — Content readiness: domain row, default_specialty_groups count,
//  scope_templates count, evidence_requirements count.
//  Step 2 — Inspector pool: total eligible inspectors (specialty_slugs
//  overlap), plus the top N strongest-match inspectors ranked by overlap
//  cardinality.
//
//  The discipline union per domain is derived from the canonical taxonomy
//  in @nexpec/shared-core. Resolution happens server-side at request time
//  so a future taxonomy edit reflects immediately on the readiness page
//  without a DB write.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { GROUPS } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ─────────────────────────────────────────────────────────────────── */

export interface DomainReadinessRow {
  slug: string;
  display_name: string;
  persona_label: string;
  short_pitch: string;
  icon_key: string;
  default_specialty_groups: string[];
  is_launched: boolean;
  is_active: boolean;
  display_order: number;
}

export interface InspectorMatch {
  id: string;
  full_name: string | null;
  email: string | null;
  rating_average: number | null;
  rating_count: number | null;
  completed_jobs_count: number | null;
  specialty_overlap: number;
  total_specialties: number;
}

export interface DomainReadinessReport {
  /** Domain row from public.inspection_domains, or null if slug unknown. */
  domain: DomainReadinessRow | null;
  /** Content metrics. */
  contentReadiness: {
    groupCount: number;
    scopeTemplateCount: number;
    evidenceRequirementCount: number;
  };
  /** Inspector pool metrics. */
  inspectorPool: {
    /** Total inspectors with at least one matching kebab specialty. */
    eligibleCount: number;
    /** Top-N strongest-match inspectors, ranked by overlap cardinality. */
    topMatches: InspectorMatch[];
    /** The discipline-slug union resolved from the canonical taxonomy. */
    disciplineSlugs: string[];
  };
  /** Verdict — pre-derived for the page so the JSX stays trivial. */
  verdict: ReadinessVerdict;
}

export type ReadinessVerdict =
  | { kind: 'live'; reason: string }
  | { kind: 'ready'; reason: string }
  | { kind: 'caution'; reason: string }
  | { kind: 'blocked'; reason: string };

/* ─────────────────────────────────────────────────────────────────── */

const MIN_INSPECTORS_FOR_LAUNCH = 5;
const TOP_MATCH_LIMIT = 10;
/**
 * Cap how many overlapping inspectors we materialise. We compute overlap
 * cardinality client-side (the cardinality(arr & arr) Postgres trick
 * requires the intarray extension which may not be enabled). 200 is
 * generous — domains with thousands of inspectors are a happy problem.
 */
const INSPECTOR_FETCH_CAP = 200;

/* ─────────────────────────────────────────────────────────────────── */

/**
 * Resolve the canonical kebab discipline slugs for a domain based on its
 * default_specialty_groups titles. Group titles missing from the canonical
 * taxonomy are silently ignored (defensive against a stale DB seed).
 */
function resolveDisciplineSlugs(groupTitles: string[]): string[] {
  const slugs = new Set<string>();
  const titleSet = new Set(groupTitles);
  for (const g of GROUPS) {
    if (titleSet.has(g.title)) {
      for (const s of g.disciplineSlugs) slugs.add(s);
    }
  }
  return [...slugs].sort();
}

function computeVerdict(input: {
  domain: DomainReadinessRow | null;
  scopeTemplateCount: number;
  groupCount: number;
  eligibleCount: number;
}): ReadinessVerdict {
  const { domain, scopeTemplateCount, groupCount, eligibleCount } = input;
  if (!domain) {
    return { kind: 'blocked', reason: 'Domain not found in inspection_domains.' };
  }
  if (domain.is_launched) {
    return {
      kind: 'live',
      reason: `Domain is already launched and visible on consumer surfaces.`,
    };
  }
  if (!domain.is_active) {
    return {
      kind: 'blocked',
      reason: `Domain is inactive (kill-switch off) — it is hidden from every surface, including admin lists. Re-enable from /admin/domains before launch.`,
    };
  }
  if (scopeTemplateCount === 0) {
    return {
      kind: 'blocked',
      reason: `No scope templates seeded. Apply the per-domain catalogue migration before continuing.`,
    };
  }
  if (groupCount === 0) {
    return {
      kind: 'blocked',
      reason: `default_specialty_groups is empty. Inspector matching has no language to route jobs.`,
    };
  }
  if (eligibleCount < MIN_INSPECTORS_FOR_LAUNCH) {
    return {
      kind: 'caution',
      reason: `Only ${eligibleCount} eligible inspector${eligibleCount === 1 ? '' : 's'} — below the launch target of ${MIN_INSPECTORS_FOR_LAUNCH}. Launch is reversible, but the first job posted in this domain will see thin matches.`,
    };
  }
  return {
    kind: 'ready',
    reason: `Content is complete and ${eligibleCount} inspectors are eligible. Smoke-test the consumer flow (Step 4 in DOMAIN_LAUNCH_PLAYBOOK.md), then flip is_launched from /admin/domains.`,
  };
}

/* ─────────────────────────────────────────────────────────────────── */

/**
 * Build the full readiness report for one domain slug. Returns a
 * structurally valid report even on partial failure — every numeric
 * field degrades to 0, the verdict explains the cause.
 *
 * All errors are caught + logged. The page renders gracefully on the
 * worst case (slug not found, RLS denied, etc.) rather than throwing.
 */
export async function fetchDomainReadiness(
  slug: string,
): Promise<DomainReadinessReport> {
  const supabase = await createSupabaseServerClient();

  // ── 1) Domain row ──────────────────────────────────────────────
  let domain: DomainReadinessRow | null = null;
  try {
    const { data, error } = await supabase
      .from('inspection_domains')
      .select(
        'slug, display_name, persona_label, short_pitch, icon_key, default_specialty_groups, is_launched, is_active, display_order',
      )
      .eq('slug', slug)
      .maybeSingle();
    if (error) {
      console.error('[domainReadiness] domain row error', error);
    } else if (data) {
      domain = data as unknown as DomainReadinessRow;
    }
  } catch (err) {
    console.error('[domainReadiness] domain row threw', err);
  }

  const groupCount = domain?.default_specialty_groups.length ?? 0;

  // ── 2) Scope-template count ────────────────────────────────────
  let scopeTemplateCount = 0;
  try {
    const { count, error } = await supabase
      .from('inspection_scope_templates')
      .select('id', { count: 'exact', head: true })
      .eq('domain', slug)
      .eq('is_active', true);
    if (error) console.error('[domainReadiness] scope count error', error);
    else scopeTemplateCount = count ?? 0;
  } catch (err) {
    console.error('[domainReadiness] scope count threw', err);
  }

  // ── 3) Evidence-requirement count ──────────────────────────────
  //
  // Two-step because PostgREST joins are awkward for COUNT — fetch the
  // template IDs first, then count requirements WHERE template_id IN (…).
  let evidenceRequirementCount = 0;
  try {
    const { data: templateIds, error: tplErr } = await supabase
      .from('inspection_scope_templates')
      .select('id')
      .eq('domain', slug);
    if (tplErr) console.error('[domainReadiness] template ids error', tplErr);
    const ids = (templateIds ?? []).map((r) => (r as { id: string }).id);
    if (ids.length > 0) {
      const { count, error } = await supabase
        .from('inspection_evidence_requirements')
        .select('id', { count: 'exact', head: true })
        .in('template_id', ids);
      if (error) console.error('[domainReadiness] evidence count error', error);
      else evidenceRequirementCount = count ?? 0;
    }
  } catch (err) {
    console.error('[domainReadiness] evidence count threw', err);
  }

  // ── 4) Inspector pool ──────────────────────────────────────────
  const disciplineSlugs = resolveDisciplineSlugs(
    domain?.default_specialty_groups ?? [],
  );

  let eligibleCount = 0;
  let topMatches: InspectorMatch[] = [];

  if (disciplineSlugs.length > 0) {
    // Total count of eligible inspectors.
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'inspector')
        .is('deleted_at', null)
        .overlaps('specialty_slugs', disciplineSlugs);
      if (error) console.error('[domainReadiness] inspector count error', error);
      else eligibleCount = count ?? 0;
    } catch (err) {
      console.error('[domainReadiness] inspector count threw', err);
    }

    // Top-N by overlap cardinality.
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, email, rating_average, rating_count, completed_jobs_count, specialty_slugs',
        )
        .eq('role', 'inspector')
        .is('deleted_at', null)
        .overlaps('specialty_slugs', disciplineSlugs)
        .limit(INSPECTOR_FETCH_CAP);
      if (error) {
        console.error('[domainReadiness] top matches error', error);
      } else if (data) {
        const set = new Set(disciplineSlugs);
        const ranked = (data as Array<{
          id: string;
          full_name: string | null;
          email: string | null;
          rating_average: number | string | null;
          rating_count: number | null;
          completed_jobs_count: number | null;
          specialty_slugs: string[] | null;
        }>).map((p) => {
          const slugs = p.specialty_slugs ?? [];
          return {
            id: p.id,
            full_name: p.full_name,
            email: p.email,
            rating_average:
              p.rating_average == null ? null : Number(p.rating_average),
            rating_count: p.rating_count,
            completed_jobs_count: p.completed_jobs_count,
            total_specialties: slugs.length,
            specialty_overlap: slugs.reduce(
              (n, s) => (set.has(s) ? n + 1 : n),
              0,
            ),
          } satisfies InspectorMatch;
        });
        ranked.sort((a, b) => {
          if (b.specialty_overlap !== a.specialty_overlap) {
            return b.specialty_overlap - a.specialty_overlap;
          }
          const ar = a.rating_average ?? 0;
          const br = b.rating_average ?? 0;
          if (br !== ar) return br - ar;
          return (b.completed_jobs_count ?? 0) - (a.completed_jobs_count ?? 0);
        });
        topMatches = ranked.slice(0, TOP_MATCH_LIMIT);
      }
    } catch (err) {
      console.error('[domainReadiness] top matches threw', err);
    }
  }

  // ── 5) Verdict ─────────────────────────────────────────────────
  const verdict = computeVerdict({
    domain,
    scopeTemplateCount,
    groupCount,
    eligibleCount,
  });

  return {
    domain,
    contentReadiness: {
      groupCount,
      scopeTemplateCount,
      evidenceRequirementCount,
    },
    inspectorPool: {
      eligibleCount,
      topMatches,
      disciplineSlugs,
    },
    verdict,
  };
}

/* ─────────────────────────────────────────────────────────────────── */

/** Re-exported for the page's verdict-pill helper. */
export const READINESS_THRESHOLD = MIN_INSPECTORS_FOR_LAUNCH;
