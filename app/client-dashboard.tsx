// ════════════════════════════════════════════════════════════════════════════
//  app/client-dashboard.tsx — LANE-A-PHASE-2.1 route-consolidation stub
//
//  Pre-strike: 820-line orphan dashboard at root of app/ that duplicated
//  logic now living in src/screens/client/ClientDashboard.tsx (which is
//  what app/(tabs)/client-dashboard.tsx wraps as the canonical client-role
//  tab destination).
//
//  Sub-Phase 2.1 work order:
//    1. Migrated inbound ref in app/(client)/jobs/[id]/applications.tsx
//       (line 39: <Redirect /client-dashboard /> → /(tabs)/client-dashboard)
//    2. Migrated inbound ref in app/(tabs)/profile.tsx
//       (line 659: router.push('/client-dashboard') → /(tabs)/client-dashboard)
//    3. Replaced this file with a redirect stub.
//
//  app/_layout.tsx line 147 already navigates to /(tabs)/client-dashboard;
//  no change needed there.
//
//  Post-strike: any out-of-band deep link to /client-dashboard is forwarded
//  to the canonical tab.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function OrphanedClientDashboardRedirect() {
  return <Redirect href="/(tabs)/client-dashboard" />;
}
