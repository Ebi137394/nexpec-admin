// ════════════════════════════════════════════════════════════════════════════
//  app/browse-jobs.tsx — LANE-A-PHASE-1 dead-code retirement stub
//
//  Pre-strike: standalone job-browse screen at root of app/ with zero
//  inbound references. Its only outbound reference is to its dead sibling
//  app/browse-jobs-map.tsx (also stubbed in Phase 1).
//
//  Job discovery for clients now lives at app/(client)/explore/index.tsx;
//  job discovery for inspectors lives in the (tabs) feed.
//
//  Verification (LANE-A audit + Phase-1 grep):
//      $ grep -r "/browse-jobs|browseJobs" — zero inbound matches.
//
//  Post-strike: forward-only redirect to /(tabs).
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function OrphanedBrowseJobsRedirect() {
  return <Redirect href="/(tabs)" />;
}
