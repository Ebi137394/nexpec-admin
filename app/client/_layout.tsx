// ════════════════════════════════════════════════════════════════════════════
//  app/client/_layout.tsx — LANE-A-PHASE-2.6 route-group retirement stub
//
//  Pre-strike: Stack layout for the literal app/client/ folder with custom
//  contentStyle. Now that every child screen in this folder is a
//  redirect stub forwarding to the canonical /(client)/* group, this
//  layout no longer hosts any reachable rendered content.
//
//  Post-strike: minimal Stack layout that keeps the route group valid for
//  Expo Router's deep-link resolution. Custom contentStyle dropped — the
//  redirect happens before any render commits, so the contentStyle was a
//  no-op anyway.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Stack } from 'expo-router';

export default function LiteralClientLayoutStub() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
