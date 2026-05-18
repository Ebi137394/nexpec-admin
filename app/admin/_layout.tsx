// ════════════════════════════════════════════════════════════════════════════
//  app/admin/_layout.tsx — LANE-A-PHASE-2.5 route-group retirement stub
//
//  Pre-strike: Stack layout for the literal app/admin/ folder. The only
//  child screen (index.tsx) is now a redirect stub; this layout no longer
//  hosts any reachable content.
//
//  Post-strike: minimal Stack layout that keeps the route group valid for
//  Expo Router's deep-link resolution. When Phase 2b's (super-admin) →
//  (admin) rename happens, this literal folder gets superseded entirely
//  by the renamed route group.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Stack } from 'expo-router';

export default function LiteralAdminLayoutStub() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
