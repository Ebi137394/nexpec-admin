// ════════════════════════════════════════════════════════════════════════════
//  app/client/post-job.tsx — JOB-POST-FRAGMENTATION-001 redirect stub
//
//  Pre-strike: a 679-line parallel job-post screen reachable only from
//  app/client-dashboard.tsx (two router.push call sites). Last
//  meaningful edit was 2026-03-17, predating the JURISDICTION-002
//  Phase-2 capture work — so clients posting via the dashboard were
//  silently bypassing the country / sponsorship + specialty pickers
//  that the canonical /post-new-job exposes.
//
//  Post-strike: forward-only redirect to the canonical surface. The
//  client-dashboard quick actions transparently land on the patched,
//  validated, audit-integrated form. No call-site changes needed.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function ClientPostJobRedirect() {
  return <Redirect href="/post-new-job" />;
}
