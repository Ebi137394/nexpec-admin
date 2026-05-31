// ════════════════════════════════════════════════════════════════════════════
//  integrity/rbi.ts — Risk-Based Inspection scoring (Predictive Integrity)
//
//  Deterministic, API-580-inspired Risk = Likelihood × Consequence, with defect
//  progression projected from the sealed observation history. Pure TS, $0, no
//  model needed — turns the sealed inspection record into a maintenance schedule.
// ════════════════════════════════════════════════════════════════════════════

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface DefectObservation {
  defectId: string;
  /** 0..5 severity rank (e.g. ISO 4628 Ri grade). */
  severityRank?: number;
  confidence?: number;
  observedAt: string; // ISO
  source?: string;
}

export interface ProgressionTrend {
  defectId: string;
  firstSeen: string;
  lastSeen: string;
  ranks: number[];
  /** Least-squares slope of severity rank per year (degradation rate). */
  slopePerYear: number;
}

export interface RbiInput {
  /** Asset criticality 1..5 (consequence of failure). */
  criticality: number;
  observations: DefectObservation[];
  nowIso?: string;
  baseIntervalDays?: number;
}

export interface RbiResult {
  riskTier: RiskTier;
  score: number; // 0..100
  likelihood: number; // 0..1
  consequence: number; // 0..1
  nextDueDays: number;
  nextDueDate: string;
  rationale: string[];
  progression: ProgressionTrend[];
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function projectProgression(observations: DefectObservation[]): ProgressionTrend[] {
  const groups = new Map<string, DefectObservation[]>();
  for (const o of observations) {
    const arr = groups.get(o.defectId) ?? [];
    arr.push(o);
    groups.set(o.defectId, arr);
  }
  const out: ProgressionTrend[] = [];
  for (const [defectId, arr] of groups) {
    const sorted = arr.slice().sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    const ranks: number[] = [];
    const times: number[] = [];
    for (const o of sorted) {
      ranks.push(typeof o.severityRank === 'number' ? o.severityRank : 0);
      times.push(Date.parse(o.observedAt));
    }
    let slopePerYear = 0;
    if (ranks.length >= 2) {
      const n = ranks.length;
      const t0 = times[0] ?? 0;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) {
        const x = ((times[i] ?? t0) - t0) / YEAR_MS;
        const y = ranks[i] ?? 0;
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      const denom = n * sxx - sx * sx;
      slopePerYear = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    out.push({ defectId, firstSeen: first?.observedAt ?? '', lastSeen: last?.observedAt ?? '', ranks, slopePerYear });
  }
  return out;
}

export function computeRiskScore(input: RbiInput): RbiResult {
  const now = input.nowIso ? Date.parse(input.nowIso) : Date.now();
  const base = input.baseIntervalDays ?? 365;
  const consequence = clamp(input.criticality, 1, 5) / 5; // 0.2..1
  const progression = projectProgression(input.observations);

  let maxRank = 0;
  let maxSlope = 0;
  for (const o of input.observations) {
    const r = typeof o.severityRank === 'number' ? o.severityRank : 0;
    if (r > maxRank) maxRank = r;
  }
  for (const p of progression) if (p.slopePerYear > maxSlope) maxSlope = p.slopePerYear;

  const rankComponent = clamp(maxRank / 5, 0, 1);
  const slopeComponent = clamp(maxSlope / 2, 0, 1); // 2 ranks/yr ≈ maximal degradation
  const likelihood = clamp(0.15 + 0.6 * rankComponent + 0.25 * slopeComponent, 0, 1);
  const score = Math.round(likelihood * consequence * 100);
  const riskTier: RiskTier = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
  const risk01 = score / 100;
  const nextDueDays = Math.max(30, Math.round(base * (1 - 0.75 * risk01)));
  const nextDueDate = new Date(now + nextDueDays * 24 * 3600 * 1000).toISOString();

  const rationale = [
    `Consequence ${(consequence * 100).toFixed(0)}% (criticality ${input.criticality}/5).`,
    `Likelihood ${(likelihood * 100).toFixed(0)}% (max severity ${maxRank}/5; progression ${maxSlope.toFixed(2)} ranks/yr).`,
    `Risk ${score}/100 → ${riskTier}; next inspection in ~${nextDueDays} days.`,
  ];
  return { riskTier, score, likelihood, consequence, nextDueDays, nextDueDate, rationale, progression };
}
