// ════════════════════════════════════════════════════════════════════════════
//  app/(senior)/_layout.tsx — LANE-A-PHASE-2.3 route-group retirement stub
//
//  Pre-strike: tabs-style layout for the (senior) route group with admin-
//  scoped navigation. The group had only 3 child screens (inbox, profile,
//  _layout) and was reached only via app/_layout.tsx's role-based redirect
//  for `role === 'admin'`. That redirect now points to the canonical
//  /(admin)/admin-inbox (Sub-Phase 2.3 work order item 1).
//
//  Post-strike: minimal Stack layout that keeps the route group valid
//  (Expo Router requires a _layout for any route group it must walk into
//  for deep-link resolution). Child stubs in this folder forward outbound
//  navigations to their canonical destinations.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Stack } from 'expo-router';

export default function SeniorLayoutStub() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
