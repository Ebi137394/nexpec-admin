// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/create-job.tsx — JOB-POST-FRAGMENTATION-001 redirect stub
//
//  Orphan screen — zero inbound router.push references. Replaced with
//  a thin redirect so the (client) route group resolves to the
//  canonical /post-new-job surface.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function ClientGroupCreateJobRedirect() {
  return <Redirect href="/post-new-job" />;
}
