// ════════════════════════════════════════════════════════════════════════════
//  integrity/riskScore.ts — P2.2 Predictive-Integrity risk scorer
//
//  Turns the per-inspector metrics + anonymous cohort baseline emitted by the
//  inspector_integrity_analytics RPC (P2.1) into ONE explainable
//  integrity_risk_score (0–100) with a component breakdown. Pure + deterministic
//  + $0 — just statistics. No react / react-native / next / network imports
//  (shared-core rule), so it's trivially unit-testable on any platform.
//
//  Axes (each → normalized 0..1 risk, then weighted):
//    • chain_breaks      z-above cohort, FLOORED at 0.5 if any break exists
//                        (a broken capture chain is categorically serious)
//    • low_evidence      captures BELOW cohort mean → corner-cutting
//    • fast_turnaround   capture→seal faster than cohort → rubber-stamping
//                        (skipped + weight-renormalized when turnaround unknown)
//    • adverse_outcomes  disputes (heavy) + client revisions (lighter)
//
//  Sparse history (< minSeals) is marked provisional and capped at 'elevated'
//  so a brand-new inspector with 1 seal is never branded 'critical'.
// ════════════════════════════════════════════════════════════════════════════

export type RiskBand = 'low' | 'elevated' | 'high' | 'critical';

export interface InspectorIntegrityMetrics {
  inspectorId: string;
  inspectorLabel?: string;
  seals: number;
  /** Fraction of seals with a broken capture chain, 0..1. */
  chainBreakRate: number;
  avgCapturesPerSeal: number;
  /** Mean capture→seal hours; null when no captures were timestamped. */
  avgTurnaroundHours: number | null;
  disputes: number;
  revisions: number;
}

export interface IntegrityCohortBaseline {
  avgCapturesMean: number;
  avgCapturesStddev: number;
  chainBreakRateMean: number;
  chainBreakRateStddev: number;
  turnaroundHoursMean: number;
  turnaroundHoursStddev: number;
}

export type RiskComponentKey =
  | 'chain_breaks'
  | 'low_evidence'
  | 'fast_turnaround'
  | 'adverse_outcomes';

export interface RiskComponent {
  key: RiskComponentKey;
  label: string;
  /** Normalized 0..1 risk for this axis. */
  risk: number;
  /** Weight of this axis within the ACTIVE component set. */
  weight: number;
  /** Signed z-score vs cohort, where applicable. */
  z?: number;
  note: string;
}

export interface IntegrityRiskScore {
  inspectorId: string;
  inspectorLabel?: string;
  /** 0..100, higher = riskier. */
  score: number;
  band: RiskBand;
  components: RiskComponent[];
  /** True when seals < minSeals → score is provisional. */
  insufficientData: boolean;
  rationale: string;
}

export interface RiskScoreOptions {
  /** Stddevs from the mean that map to full (1.0) risk on an axis. Default 3. */
  zMax?: number;
  /** Below this many seals the score is provisional + capped at 'elevated'. Default 3. */
  minSeals?: number;
  weights?: {
    chainBreaks: number;
    lowEvidence: number;
    fastTurnaround: number;
    outcomes: number;
  };
}

export const DEFAULT_RISK_WEIGHTS = {
  chainBreaks: 0.35,
  lowEvidence: 0.25,
  fastTurnaround: 0.2,
  outcomes: 0.2,
} as const;

/** disputes-equivalent that maps to full (1.0) outcome risk. */
export const OUTCOME_SATURATION = 3;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number, dp = 2): number => {
  const p = 10 ** dp;
  return Math.round(x * p) / p;
};

/** Signed z-score; 0 when stddev is non-positive/non-finite (no variance → no signal). */
function zScore(value: number, mean: number, stddev: number): number {
  if (!Number.isFinite(stddev) || stddev <= 0) return 0;
  return (value - mean) / stddev;
}

function bandFor(score: number): RiskBand {
  if (score < 20) return 'low';
  if (score < 45) return 'elevated';
  if (score < 70) return 'high';
  return 'critical';
}

export function computeIntegrityRisk(
  m: InspectorIntegrityMetrics,
  cohort: IntegrityCohortBaseline,
  opts: RiskScoreOptions = {},
): IntegrityRiskScore {
  const zMax = opts.zMax ?? 3;
  const minSeals = opts.minSeals ?? 3;
  const w = opts.weights ?? DEFAULT_RISK_WEIGHTS;
  const insufficientData = m.seals < minSeals;

  const components: RiskComponent[] = [];

  // 1) Chain breaks — categorically serious. z above cohort, floored at 0.5
  //    whenever any break exists (so it can't be normalized away by a cohort
  //    where breaks are sadly common).
  const cbZ = zScore(m.chainBreakRate, cohort.chainBreakRateMean, cohort.chainBreakRateStddev);
  const cbRisk = m.chainBreakRate > 0 ? Math.max(0.5, clamp01(cbZ / zMax)) : clamp01(cbZ / zMax);
  components.push({
    key: 'chain_breaks',
    label: 'Chain-break incidence',
    risk: cbRisk,
    weight: w.chainBreaks,
    z: round(cbZ),
    note: m.chainBreakRate > 0
      ? `${round(m.chainBreakRate * 100, 1)}% of seals had a broken capture chain`
      : 'no broken capture chains',
  });

  // 2) Low evidence — captures BELOW cohort mean → risk.
  const ceZ = zScore(m.avgCapturesPerSeal, cohort.avgCapturesMean, cohort.avgCapturesStddev);
  components.push({
    key: 'low_evidence',
    label: 'Evidence thoroughness',
    risk: clamp01(-ceZ / zMax),
    weight: w.lowEvidence,
    z: round(ceZ),
    note: `${round(m.avgCapturesPerSeal, 1)} captures/seal vs cohort ${round(cohort.avgCapturesMean, 1)}`,
  });

  // 3) Fast turnaround — faster than cohort → rubber-stamping. Skipped (and its
  //    weight renormalized away) when turnaround is unknown.
  const hasTurnaround = m.avgTurnaroundHours != null && Number.isFinite(m.avgTurnaroundHours);
  if (hasTurnaround) {
    const t = m.avgTurnaroundHours as number;
    const tZ = zScore(t, cohort.turnaroundHoursMean, cohort.turnaroundHoursStddev);
    components.push({
      key: 'fast_turnaround',
      label: 'Capture→seal turnaround',
      risk: clamp01(-tZ / zMax),
      weight: w.fastTurnaround,
      z: round(tZ),
      note: `${round(t, 1)}h vs cohort ${round(cohort.turnaroundHoursMean, 1)}h`,
    });
  }

  // 4) Adverse outcomes — disputes (heavy) + client revisions (lighter).
  const outcomeRisk = clamp01((m.disputes * 1.0 + m.revisions * 0.4) / OUTCOME_SATURATION);
  components.push({
    key: 'adverse_outcomes',
    label: 'Downstream outcomes',
    risk: outcomeRisk,
    weight: w.outcomes,
    note: `${m.disputes} dispute(s), ${m.revisions} revision request(s)`,
  });

  // Weighted + renormalized over the ACTIVE components.
  const activeWeight = components.reduce((s, c) => s + c.weight, 0) || 1;
  const weighted = components.reduce((s, c) => s + c.risk * c.weight, 0);
  const score = round((weighted / activeWeight) * 100, 1);

  let band = bandFor(score);
  if (insufficientData && (band === 'high' || band === 'critical')) band = 'elevated';

  const top = [...components].sort((a, b) => b.risk * b.weight - a.risk * a.weight)[0];
  const topLabel = top ? top.label.toLowerCase() : 'n/a';
  const rationale = insufficientData
    ? `Provisional — only ${m.seals} seal(s) in window. Leading signal: ${topLabel}.`
    : `Primary risk driver: ${topLabel} (${top ? Math.round(top.risk * 100) : 0}%).`;

  return {
    inspectorId: m.inspectorId,
    inspectorLabel: m.inspectorLabel,
    score,
    band,
    components,
    insufficientData,
    rationale,
  };
}

/** Score + rank a cohort's inspectors, riskiest first — what the dashboard renders. */
export function rankByIntegrityRisk(
  rows: InspectorIntegrityMetrics[],
  cohort: IntegrityCohortBaseline,
  opts?: RiskScoreOptions,
): IntegrityRiskScore[] {
  return rows
    .map((r) => computeIntegrityRisk(r, cohort, opts))
    .sort((a, b) => b.score - a.score);
}

/* ── Adapters: map the inspector_integrity_analytics RPC jsonb (snake_case) ── */

const toNum = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export function inspectorMetricsFromRpc(raw: Record<string, unknown>): InspectorIntegrityMetrics {
  const turnaround = raw['avg_turnaround_hours'];
  return {
    inspectorId: String(raw['inspector_id'] ?? ''),
    inspectorLabel: raw['inspector_label'] != null ? String(raw['inspector_label']) : undefined,
    seals: toNum(raw['seals']),
    chainBreakRate: toNum(raw['chain_break_rate']),
    avgCapturesPerSeal: toNum(raw['avg_captures_per_seal']),
    avgTurnaroundHours: turnaround == null ? null : toNum(turnaround),
    disputes: toNum(raw['disputes']),
    revisions: toNum(raw['revisions']),
  };
}

export function cohortFromRpc(raw: Record<string, unknown>): IntegrityCohortBaseline {
  return {
    avgCapturesMean: toNum(raw['avg_captures_mean']),
    avgCapturesStddev: toNum(raw['avg_captures_stddev']),
    chainBreakRateMean: toNum(raw['chain_break_rate_mean']),
    chainBreakRateStddev: toNum(raw['chain_break_rate_stddev']),
    turnaroundHoursMean: toNum(raw['turnaround_hours_mean']),
    turnaroundHoursStddev: toNum(raw['turnaround_hours_stddev']),
  };
}
