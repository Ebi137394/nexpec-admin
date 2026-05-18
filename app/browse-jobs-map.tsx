// ════════════════════════════════════════════════════════════════════════════
//  app/browse-jobs-map.tsx — LANE-A-PHASE-1 dead-code retirement stub
//
//  Pre-strike: map-view companion to the orphan browse-jobs.tsx. Its only
//  inbound reference was from that same dead sibling (now stubbed). No
//  production code routes to /browse-jobs-map.
//
//  Verification (LANE-A audit + Phase-1 grep):
//      $ grep -r "/browse-jobs-map|browseJobsMap" — only the dead sibling.
//
//  Post-strike: forward-only redirect to /(tabs).
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function OrphanedBrowseJobsMapRedirect() {
  return <Redirect href="/(tabs)" />;
}
