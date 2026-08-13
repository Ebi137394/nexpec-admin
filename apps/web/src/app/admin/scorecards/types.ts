// ════════════════════════════════════════════════════════════════════════════
//  app/admin/scorecards/types.ts — shapes for the Supplier Scorecards console
//
//  Mirrors what 20260801470000 actually returns. Two things about this file are
//  load-bearing rather than cosmetic:
//
//   1. `score` is `number | null`, NOT `number`. The migration returns NULL —
//      never 0 — when the evidence is too thin, because absent evidence asserts
//      nothing while a zero asserts bad performance. Typing it as nullable is
//      what forces every render site to handle the "not scored" case instead of
//      defaulting it to 0 and printing a confident-looking figure.
//
//   2. `sample_size` and `numerator` travel in the SAME object as the score,
//      exactly as the RPC emits them. There is no shape in this file that can
//      carry a score without its evidence base.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  Not one field here is a price, payout, spread or margin, and none exists to
//  be read: the migration's selftest §7h fails the build if any scorecard
//  function so much as mentions a money surface. A scorecard is a PERFORMANCE
//  instrument. client_price_cents, inspector_payout_cents and platform spread
//  are out of scope for this whole route and appear nowhere in it.
// ════════════════════════════════════════════════════════════════════════════

/** The confidence ladder's vocabulary — ssc_bands_band_check. */
export type ConfidenceBand =
  | 'none'
  | 'insufficient'
  | 'low'
  | 'moderate'
  | 'high';

/** A row of public.supplier_scorecard_confidence_bands. */
export interface ConfidenceBandRow {
  band: string;
  min_sample: number;
  rounding_step: number;
  label: string;
  sort: number;
}

/** The singleton public.supplier_scorecard_policy row. */
export interface ScorecardPolicy {
  min_metrics_for_composite: number;
  confidence_z_milli: number;
}

/** A row of public.supplier_scorecard_metrics (the registry, config only). */
export interface ScorecardMetricConfig {
  metric_key: string;
  label: string;
  dimension: string;
  weight_bps: number;
  min_sample_size: number;
  evidence_source: string;
  measures: string;
  is_active: boolean;
  sort: number;
}

/** One scored metric, as nx_supplier_scorecard_metric builds it. */
export interface ScorecardMetric {
  metric_key: string;
  label: string;
  dimension: string;
  weight_bps: number;
  /** Denominator. Never optional — the RPC cannot emit a score without it. */
  sample_size: number;
  numerator: number;
  /** NULL when the evidence is too thin. Never 0 in that case. */
  score: number | null;
  confidence: string;
  /** Whole points the score was rounded to. 0 means "no score emitted". */
  rounding_step: number;
  min_sample_size: number;
  /** Wilson interval bounds — thin evidence shows up as a WIDTH. */
  interval_low: number | null;
  interval_high: number | null;
  reason: string | null;
  evidence_source: string;
  measures: string;
}

/** The whole card, as nx_supplier_scorecard builds it. */
export interface Scorecard {
  supplier_id: string;
  generated_at: string;
  overall_score: number | null;
  overall_confidence: string;
  metrics_scored: number;
  metrics_total: number;
  reason: string | null;
  metrics: ScorecardMetric[];
  disclaimer: string;
}

/** A row of nx_supplier_scorecard_evidence. */
export interface EvidenceRow {
  evidence_kind: string;
  evidence_id: string;
  occurred_at: string | null;
  counted_in_numerator: boolean;
  detail: Record<string, unknown> | null;
}

/** Identity fields from the supplier_directory view. */
export interface SupplierRow {
  id: string;
  legal_name: string;
  headline: string | null;
  country_code: string | null;
  rating_avg: number | string | null;
  rating_count: number | null;
  verified: boolean | null;
}

/**
 * A scorecard as this surface carries it. The three states must never render
 * alike: a real card, a card the caller may not read, and a read that failed.
 */
export type ScorecardResult =
  | { state: 'ok'; card: Scorecard }
  | { state: 'forbidden' }
  | { state: 'failed'; message: string };

// ── Presentation vocabulary ────────────────────────────────────────────────

/**
 * What ONE observation is, per metric. The brief's rule is that a score
 * computed from 3 jobs must say "3 jobs" — not a bare "n = 3" — so the unit is
 * spelled out. An unknown metric falls back to the neutral "observations"
 * rather than guessing a noun.
 */
const SAMPLE_UNIT: Record<string, [singular: string, plural: string]> = {
  rfq_response_timeliness: ['quote', 'quotes'],
  quote_follow_through: ['quote', 'quotes'],
  inspection_pass_rate: ['ITP point', 'ITP points'],
  ncr_free_jobs: ['inspected job', 'inspected jobs'],
  ncr_closure: ['NCR', 'NCRs'],
  document_currency: ['document', 'documents'],
  delivery_timeliness: ['job', 'jobs'],
};

export function sampleLabel(metricKey: string, n: number): string {
  const [one, many] = SAMPLE_UNIT[metricKey] ?? ['observation', 'observations'];
  return `${n} ${n === 1 ? one : many}`;
}

/** Ordering of the ladder, weakest first. Used for "is this thin?" checks. */
const BAND_RANK: Record<string, number> = {
  none: 0,
  insufficient: 1,
  low: 2,
  moderate: 3,
  high: 4,
};

export function bandRank(band: string): number {
  return BAND_RANK[band] ?? 0;
}

/** True for a band whose figures deserve visible hedging. */
export function isThin(band: string): boolean {
  return bandRank(band) <= 2;
}

export function isScoreable(band: string): boolean {
  return bandRank(band) >= 2;
}

export function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatTimestamp(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
