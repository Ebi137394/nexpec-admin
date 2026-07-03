// ════════════════════════════════════════════════════════════════════════════
//  app/client/project/_layout.tsx — LANE-A-PHASE-2.6 route-consolidation stub
//
//  Pre-strike: literal /client/ path duplicating logic now consolidated to
//  the canonical /(client)/ route group. All inbound `router.push` and
//  `<Redirect>` references swept to the canonical path.
//
//  Post-strike: forward-only redirect. Out-of-band deep links to the old
//  literal path land on the canonical (client) route group.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Slot } from 'expo-router';

export default function LiteralClientProjectLayoutStub() {
  // Layout must render the child route so app/client/project/[id].tsx can
  // forward the param; redirecting here would swallow the deep link.
  return <Slot />;
}
