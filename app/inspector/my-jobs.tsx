// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/my-jobs.tsx — LANE-A-PHASE-2.4 route-consolidation stub
//
//  Pre-strike: standalone "my jobs" screen under the literal app/inspector/
//  folder (parallel to the canonical (inspector) route group). Verification:
//  zero router.push or href references in the codebase point to
//  /inspector/my-jobs. The canonical inspector job list lives at
//  /(inspector)/dashboard with the role-resolved feed.
//
//  Post-strike: forward-only redirect. Any out-of-band deep link to
//  /inspector/my-jobs lands on the canonical inspector dashboard.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function LiteralInspectorMyJobsRedirect() {
  return <Redirect href="/(inspector)/dashboard" />;
}
