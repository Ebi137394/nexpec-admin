// ════════════════════════════════════════════════════════════════════════════
//  lib/data/compliancePosture.ts — fetchers for the Command Center
//
//  Server-side. Calls the seven RPCs landed in 20260606120000:
//    · compliance_posture_summary
//    · detect_band_evasion_pattern
//    · detect_rubber_stamping
//    · detect_concentration_risk
//    · detect_quarter_end_clustering
//    · detect_off_hours_decisions
//    · detect_silent_overrides
//
//  fetchAllComplianceAnomalies runs all six detectors in parallel and
//  returns a flattened, severity-sorted findings list — the dashboard
//  consumes one shape, regardless of how many detectors fire.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  COMPLIANCE_DETECTORS,
  type ComplianceAnomaly,
  type ComplianceDetectorId,
  type CompliancePostureSummary,
} from '@nexpec/shared-core';
import type {
  ComplianceAnomalySet,
  CompliancePostureScore,
} from './compliancePosture.types';

export type {
  ComplianceAnomaly,
  ComplianceAnomalySet,
  ComplianceDetectorId,
  CompliancePostureScore,
  CompliancePostureSummary,
};

const RPC_MISSING_RE = /function .* does not exist|relation .* does not exist/i;

const EMPTY_POSTURE: CompliancePostureSummary = {
  ok: true,
  org_id: '',
  window_days: 90,
  attribution_coverage: { total: 0, attributed: 0, percentage: null },
  decision_substantiveness: { total: 0, substantive: 0, percentage: null },
  high_value_gating: { total: 0, gated: 0, percentage: null },
  evidence_packs_90d: 0,
  sod_violations_90d: 0,
  band_overlap_attempts_90d: 0,
  approval_latency: {
    avg_seconds: 0,
    p95_seconds: 0,
    pending_count: 0,
    oldest_pending_seconds: 0,
  },
  generated_at: new Date().toISOString(),
};

export async function fetchCompliancePosture(
  orgId: string,
): Promise<CompliancePostureSummary> {
  if (!orgId) return { ...EMPTY_POSTURE, org_id: orgId };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('compliance_posture_summary', {
    p_org_id: orgId,
  });
  if (error) {
    if (!RPC_MISSING_RE.test(error.message ?? '')) {
      console.warn('[compliancePosture] summary failed:', error.message);
    }
    return { ...EMPTY_POSTURE, org_id: orgId };
  }
  return (data as unknown as CompliancePostureSummary) ?? {
    ...EMPTY_POSTURE,
    org_id: orgId,
  };
}

const DETECTOR_RPCS: Record<ComplianceDetectorId, string> = {
  band_evasion: 'detect_band_evasion_pattern',
  rubber_stamping: 'detect_rubber_stamping',
  concentration_risk: 'detect_concentration_risk',
  quarter_end_clustering: 'detect_quarter_end_clustering',
  off_hours_decisions: 'detect_off_hours_decisions',
  silent_overrides: 'detect_silent_overrides',
};

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

/**
 * Parallel-fan-out across all six detectors. Returns a single flat array
 * of findings, each tagged with its `detector` id, plus a per-detector
 * count and the highest severity observed.
 *
 * Each detector call is wrapped — one failure should not collapse the
 * whole dashboard.
 */
export async function fetchAllComplianceAnomalies(
  orgId: string,
): Promise<ComplianceAnomalySet> {
  if (!orgId) {
    return {
      findings: [],
      byDetector: emptyByDetector(),
      topSeverity: null,
    };
  }

  const supabase = await createSupabaseServerClient();

  const results = await Promise.all(
    COMPLIANCE_DETECTORS.map(async (detectorId) => {
      try {
        const { data, error } = await supabase.rpc(DETECTOR_RPCS[detectorId], {
          p_org_id: orgId,
        });
        if (error) {
          if (!RPC_MISSING_RE.test(error.message ?? '')) {
            console.warn(
              `[compliancePosture] ${detectorId} failed:`,
              error.message,
            );
          }
          return [] as ComplianceAnomaly[];
        }
        return ((data ?? []) as unknown as ComplianceAnomaly[]).map((a) => ({
          ...a,
          detector: detectorId,
        }));
      } catch (e) {
        console.warn(`[compliancePosture] ${detectorId} threw:`, e);
        return [] as ComplianceAnomaly[];
      }
    }),
  );

  const findings = results.flat();
  findings.sort((a, b) => {
    const r =
      (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (r !== 0) return r;
    return (b.detected_at ?? '').localeCompare(a.detected_at ?? '');
  });

  const byDetector = emptyByDetector();
  for (let i = 0; i < COMPLIANCE_DETECTORS.length; i++) {
    byDetector[COMPLIANCE_DETECTORS[i]!] = results[i]!.length;
  }

  const topSeverity =
    findings.find((f) => f.severity === 'critical')
      ? 'critical'
      : findings.find((f) => f.severity === 'warning')
        ? 'warning'
        : findings.length > 0
          ? 'info'
          : null;

  return { findings, byDetector, topSeverity };
}

/**
 * Compose a single 0–100 posture score from the headline percentages +
 * the anomaly load. The math is deliberately transparent — auditors
 * can recompute by hand.
 *
 *   base = avg(attribution_pct, substantiveness_pct, high_value_gating_pct)
 *        − 6 per critical anomaly
 *        − 2 per warning anomaly
 *        − 1 per info anomaly
 *   clamp into [0, 100]
 */
export function computePostureScore(
  posture: CompliancePostureSummary,
  anomalies: ComplianceAnomalySet,
): CompliancePostureScore {
  const att = posture.attribution_coverage.percentage;
  const sub = posture.decision_substantiveness.percentage;
  const hi = posture.high_value_gating.percentage;
  const known = [att, sub, hi].filter(
    (n): n is number => typeof n === 'number',
  );
  const base = known.length === 0
    ? 100 // no data yet — start neutral
    : known.reduce((s, v) => s + v, 0) / known.length;

  let score = base;
  for (const a of anomalies.findings) {
    if (a.severity === 'critical') score -= 6;
    else if (a.severity === 'warning') score -= 2;
    else score -= 1;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const band: CompliancePostureScore['band'] =
    score >= 95
      ? 'excellent'
      : score >= 85
        ? 'strong'
        : score >= 70
          ? 'fair'
          : score >= 50
            ? 'attention'
            : 'critical';

  return { score, band };
}

function emptyByDetector(): Record<ComplianceDetectorId, number> {
  return {
    band_evasion: 0,
    rubber_stamping: 0,
    concentration_risk: 0,
    quarter_end_clustering: 0,
    off_hours_decisions: 0,
    silent_overrides: 0,
  };
}
