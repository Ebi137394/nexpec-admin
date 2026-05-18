// ════════════════════════════════════════════════════════════════════════════
//  app/rate-inspector.tsx — LANE-A-PHASE-1 dead-code retirement stub
//
//  Pre-strike: 660-line orphan rate-inspector screen at the worst possible
//  location (root of app/ with no role group, no parent route, no inbound
//  references anywhere in the codebase — zero `router.push` calls, zero
//  imports, zero deep-link evidence).
//
//  Canonical rate-inspector flow lives at:
//      app/(client)/jobs/[id]/rate-inspector.tsx
//
//  Verification (LANE-A audit + Phase-1 grep):
//      $ grep -r "rate-inspector|rateInspector" — zero non-self matches.
//
//  Post-strike: forward-only redirect to /(tabs). The canonical client
//  rating flow is reached via /(client)/jobs/:id/rate-inspector and is
//  unaffected by this stub.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function OrphanedRateInspectorRedirect() {
  return <Redirect href="/(tabs)" />;
}
