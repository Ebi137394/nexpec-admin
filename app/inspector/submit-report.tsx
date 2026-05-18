// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/submit-report.tsx — LANE-A-PHASE-2.4 stub
//
//  Pre-strike: orphan report-submission screen under the literal
//  app/inspector/ folder. Zero router.push refs. Canonical report
//  submission lives at app/(inspector)/jobs/[id]/submit-report.tsx,
//  which is reached from a specific job context.
//
//  Post-strike: forward-only redirect to inspector dashboard.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function LiteralInspectorSubmitReportRedirect() {
  return <Redirect href="/(inspector)/dashboard" />;
}
