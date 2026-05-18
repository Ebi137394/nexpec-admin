// ════════════════════════════════════════════════════════════════════════════
//  app/(senior)/profile.tsx — LANE-A-PHASE-2.3 route-consolidation stub
//
//  Pre-strike: standalone profile screen scoped to the (senior) route
//  group. No inbound router.push references (zero grep hits). Reached only
//  via deep link, which is the same posture as the now-stubbed
//  (senior)/inbox.tsx.
//
//  Post-strike: out-of-band navigation forwards to the universal
//  /(tabs)/profile screen, which already role-resolves correctly for admin
//  users via the same profile.tsx role-conditional branches that handle
//  client/inspector/agency.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function SeniorProfileRedirect() {
  return <Redirect href="/(tabs)/profile" />;
}
