// ════════════════════════════════════════════════════════════════════════════
//  app/(super-admin)/_layout.tsx — LANE-A-PHASE-2.7 route-group rename stub
//
//  Pre-strike: full layout for the (super-admin) route group. Phase 2b
//  copied all 28 screens to the symmetrically-named (admin) group and
//  swept 78 inbound references across the codebase to use /(admin)/*.
//
//  Post-strike: minimal Stack layout. Expo Router requires a _layout in
//  every route group it walks into for deep-link resolution; this stub
//  keeps the (super-admin) group valid so that the child redirect-stubs
//  forward gracefully to /(admin)/* equivalents.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Stack } from 'expo-router';

export default function SuperAdminLayoutStub() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
