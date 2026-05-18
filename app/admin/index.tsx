// ════════════════════════════════════════════════════════════════════════════
//  app/admin/index.tsx — LANE-A-PHASE-2.5 route-consolidation stub
//
//  Pre-strike: standalone admin landing screen under the literal app/admin/
//  folder (parallel to the canonical (super-admin) route group). Zero
//  inbound router.push refs.
//
//  Post-strike: forward-only redirect to /(admin)/admin-inbox, the
//  canonical admin-tier landing. Phase 2b (super-admin) → (admin) rename
//  will sweep this redirect target along with all other (super-admin) refs.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function LiteralAdminIndexRedirect() {
  return <Redirect href="/(admin)/admin-inbox" />;
}
