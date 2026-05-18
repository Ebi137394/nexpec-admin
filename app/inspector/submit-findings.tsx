// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/submit-findings.tsx — LANE-A-PHASE-2.4 stub
//
//  Pre-strike: orphan findings-submission screen under the literal
//  app/inspector/ folder. Zero router.push refs. Canonical findings-
//  submission flow is part of the job-level submit-report at
//  /(inspector)/jobs/[id]/submit-report.tsx.
//
//  Post-strike: forward-only redirect to the inspector dashboard. Users
//  reach the canonical submit flow from a specific job context, not from
//  a global "submit findings" route.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function LiteralInspectorSubmitFindingsRedirect() {
  return <Redirect href="/(inspector)/dashboard" />;
}
