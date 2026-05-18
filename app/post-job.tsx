// ════════════════════════════════════════════════════════════════════════════
//  app/post-job.tsx — JOB-POST-FRAGMENTATION-001 redirect stub
//
//  Pre-strike: an orphan ~263-line duplicate of the job-post form with
//  zero inbound router.push references. Drifted from the canonical
//  /post-new-job, which received the Specialty + Jurisdiction Phase-2
//  capture work.
//
//  Post-strike: forward-only redirect. The canonical surface lives at
//  /post-new-job and is the only screen actively maintained. Sandbox
//  filesystem cannot rm files in-place, so this stub remains as the
//  smallest-possible artifact — a single <Redirect/> component.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect } from 'expo-router';

export default function PostJobRedirect() {
  return <Redirect href="/post-new-job" />;
}
