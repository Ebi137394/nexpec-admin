// ════════════════════════════════════════════════════════════════════════════
//  app/(agency)/create-job.tsx — JOB-POST-FRAGMENTATION-001 redirect stub
//
//  Orphan screen — zero inbound router.push references. The agency
//  dashboard already routes to /post-new-job. Replaced with a thin
//  redirect so the (agency) route group resolves to the canonical
//  surface for any out-of-band deep link.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function AgencyGroupCreateJobRedirect() {
  return <Redirect href="/post-new-job" />;
}
