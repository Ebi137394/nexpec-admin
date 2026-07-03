// ════════════════════════════════════════════════════════════════════════════
//  app/client/job/[id].tsx — LANE-A-PHASE-2.6 route-consolidation stub
//
//  Pre-strike: literal /client/ path duplicating logic now consolidated to
//  the canonical /(client)/ route group. All inbound `router.push` and
//  `<Redirect>` references swept to the canonical path.
//
//  Post-strike: forward-only redirect. Out-of-band deep links to the old
//  literal path land on the canonical (client) route group.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LiteralClientJobIdRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href={'/(tabs)/client-dashboard' as any} />;
  return <Redirect href={`/(client)/job/${id}` as any} />;
}
