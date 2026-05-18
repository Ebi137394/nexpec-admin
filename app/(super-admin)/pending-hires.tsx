// ════════════════════════════════════════════════════════════════════════════
//  app/(super-admin)/pending-hires.tsx — LANE-A-PHASE-2.7 (super-admin)→(admin) rename stub
//
//  Pre-strike: canonical admin-tier screen under the (super-admin) route
//  group. Phase 2b moved the content to the symmetrically-named (admin)
//  group and swept all inbound `router.push` / `<Redirect>` references
//  across the codebase. 78 refs migrated, file content copied unchanged.
//
//  Post-strike: forward-only redirect. Out-of-band deep links to the old
//  /(super-admin)/* path land on the canonical /(admin)/* equivalent.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function SuperAdminPendingHiresRedirect() {
  return <Redirect href="/(admin)/pending-hires" />;
}
