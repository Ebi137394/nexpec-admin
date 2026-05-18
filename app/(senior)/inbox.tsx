// ════════════════════════════════════════════════════════════════════════════
//  app/(senior)/inbox.tsx — LANE-A-PHASE-2.3 route-consolidation stub
//
//  Pre-strike: dedicated admin-inbox under the (senior) route group. Only
//  reached because app/_layout.tsx routed `role === 'admin'` users here.
//
//  Sub-Phase 2.3 work order:
//    1. Repointed app/_layout.tsx lines 145, 154 from /(senior)/inbox to
//       /(admin)/admin-inbox (which already exists as the canonical
//       admin-tier landing).
//    2. Stubbed this file (and its (senior) siblings) with redirects.
//
//  Post-strike: out-of-band navigations to /(senior)/inbox forward to
//  /(admin)/admin-inbox. The Phase 2b (super-admin) → (admin) rename
//  will sweep this redirect target along with all other (super-admin) refs.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function SeniorInboxRedirect() {
  return <Redirect href="/(admin)/admin-inbox" />;
}
