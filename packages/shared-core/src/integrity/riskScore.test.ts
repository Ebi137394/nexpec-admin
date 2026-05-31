// ════════════════════════════════════════════════════════════════════════════
//  integrity/riskScore.test.ts — Predictive-Integrity scorer (P3.1)
//
//  Locks the scoring contract the admin dashboard depends on: clean → low,
//  compromised → high/critical, chain-break floor, provisional capping, cohort
//  zero-variance handling, turnaround skip, adapters, and ranking.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeIntegrityRisk,
  rankByIntegrityRisk,
  inspectorMetricsFromRpc,
  cohortFromRpc,
  type InspectorIntegrityMetrics,
  type IntegrityCohortBaseline,
} from './riskScore';

const cohort: IntegrityCohortBaseline = {
  avgCapturesMean: 8,
  avgCapturesStddev: 2,
  chainBreakRateMean: 0.02,
  chainBreakRateStddev: 0.04,
  turnaroundHoursMean: 6,
  turnaroundHoursStddev: 2,
};

describe('computeIntegrityRisk', () => {
  it('scores a clean veteran low', () => {
    const r = computeIntegrityRisk(
      { inspectorId: 'a', seals: 40, chainBreakRate: 0, avgCapturesPerSeal: 9, avgTurnaroundHours: 7, disputes: 0, revisions: 0 },
      cohort,
    );
    expect(r.band).toBe('low');
    expect(r.score).toBeLessThan(20);
    expect(r.insufficientData).toBe(false);
  });

  it('scores a compromised inspector high/critical', () => {
    const r = computeIntegrityRisk(
      { inspectorId: 'b', seals: 30, chainBreakRate: 0.25, avgCapturesPerSeal: 2, avgTurnaroundHours: 0.5, disputes: 3, revisions: 4 },
      cohort,
    );
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(['high', 'critical']).toContain(r.band);
    expect(r.components.find((c) => c.key === 'chain_breaks')!.risk).toBeGreaterThanOrEqual(0.5);
  });

  it('floors any chain break at >= 0.5 on the chain axis', () => {
    const r = computeIntegrityRisk(
      { inspectorId: 'c', seals: 10, chainBreakRate: 0.02, avgCapturesPerSeal: 8, avgTurnaroundHours: 6, disputes: 0, revisions: 0 },
      cohort,
    );
    expect(r.components.find((c) => c.key === 'chain_breaks')!.risk).toBeGreaterThanOrEqual(0.5);
  });

  it('caps sparse history at elevated and flags it provisional', () => {
    const r = computeIntegrityRisk(
      { inspectorId: 'd', seals: 1, chainBreakRate: 1, avgCapturesPerSeal: 0, avgTurnaroundHours: 0.1, disputes: 2, revisions: 2 },
      cohort,
    );
    expect(r.insufficientData).toBe(true);
    expect(['high', 'critical']).not.toContain(r.band);
  });

  it('uses only absolute signals when the cohort has no variance', () => {
    const flat: IntegrityCohortBaseline = {
      avgCapturesMean: 8, avgCapturesStddev: 0, chainBreakRateMean: 0,
      chainBreakRateStddev: 0, turnaroundHoursMean: 6, turnaroundHoursStddev: 0,
    };
    const r = computeIntegrityRisk(
      { inspectorId: 'e', seals: 10, chainBreakRate: 0, avgCapturesPerSeal: 4, avgTurnaroundHours: 1, disputes: 0, revisions: 0 },
      flat,
    );
    expect(r.score).toBeLessThan(10);
  });

  it('skips the turnaround axis when turnaround is unknown', () => {
    const r = computeIntegrityRisk(
      { inspectorId: 'f', seals: 10, chainBreakRate: 0, avgCapturesPerSeal: 8, avgTurnaroundHours: null, disputes: 0, revisions: 0 },
      cohort,
    );
    expect(r.components.find((c) => c.key === 'fast_turnaround')).toBeUndefined();
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe('adapters + ranking', () => {
  it('maps snake_case RPC rows to typed metrics', () => {
    const m = inspectorMetricsFromRpc({
      inspector_id: 'x', inspector_label: 'Ann', seals: 5, chain_break_rate: 0.1,
      avg_captures_per_seal: 7, avg_turnaround_hours: null, disputes: 1, revisions: 2,
    });
    expect(m.inspectorId).toBe('x');
    expect(m.avgTurnaroundHours).toBeNull();
    expect(m.disputes).toBe(1);

    const c = cohortFromRpc({
      avg_captures_mean: 8, avg_captures_stddev: 2, chain_break_rate_mean: 0.02,
      chain_break_rate_stddev: 0.04, turnaround_hours_mean: 6, turnaround_hours_stddev: 2,
    });
    expect(c.avgCapturesMean).toBe(8);
    expect(c.turnaroundHoursStddev).toBe(2);
  });

  it('ranks the riskiest inspector first', () => {
    const rows: InspectorIntegrityMetrics[] = [
      { inspectorId: 'safe', seals: 20, chainBreakRate: 0, avgCapturesPerSeal: 9, avgTurnaroundHours: 7, disputes: 0, revisions: 0 },
      { inspectorId: 'risky', seals: 20, chainBreakRate: 0.3, avgCapturesPerSeal: 2, avgTurnaroundHours: 0.3, disputes: 3, revisions: 3 },
    ];
    expect(rankByIntegrityRisk(rows, cohort)[0]!.inspectorId).toBe('risky');
  });
});
