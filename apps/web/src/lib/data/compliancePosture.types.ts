// ════════════════════════════════════════════════════════════════════════════
//  lib/data/compliancePosture.types.ts — Compliance Command Center types
//
//  NOTE: a sibling `compliance.types.ts` exists for the older credential
//  review surface. This file is the home for anomaly + posture dashboard
//  shapes (Sprint 10). Keep the two filenames distinct to avoid concept
//  drift.
//
//  Cross-platform definitions live in @nexpec/shared-core; web-only
//  convenience shapes live here.
// ════════════════════════════════════════════════════════════════════════════

export type {
  ComplianceAnomaly,
  ComplianceDetectorId,
  CompliancePostureSummary,
  ComplianceSeverity,
} from '@nexpec/shared-core';

import type {
  ComplianceAnomaly,
  ComplianceDetectorId,
} from '@nexpec/shared-core';

/** Aggregate output of fetchAllComplianceAnomalies. */
export interface ComplianceAnomalySet {
  /** All findings flattened, sorted by severity (critical → info), then time. */
  findings: ComplianceAnomaly[];
  /** Per-detector breakdown for the dashboard's tile strip. */
  byDetector: Record<ComplianceDetectorId, number>;
  /** Highest severity observed anywhere. Null if no findings. */
  topSeverity: 'critical' | 'warning' | 'info' | null;
}

/** Posture score result + the colour band the UI should render. */
export interface CompliancePostureScore {
  score: number; // 0..100
  band: 'excellent' | 'strong' | 'fair' | 'attention' | 'critical';
}
