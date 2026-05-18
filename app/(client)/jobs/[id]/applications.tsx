// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/jobs/[id]/applications.tsx
//
//  ★ DEPRECATED — kept as a redirect shim, NOT a real screen.
//
//  This file previously hosted a client-facing applicant-management UI
//  that wrote application.status as lowercase 'client_selected'. Every
//  admin surface reads uppercase 'CLIENT_SELECTED', so any hire made
//  through this screen was silently invisible to admin and could never
//  be dispatched (defect HIRE-001 in the Phase 1 audit).
//
//  The canonical screen at `app/client/jobs/[id]/applicants.tsx`
//  uses uppercase, enforces a real state machine, and requires a
//  cover-note modal before selection. We retired this duplicate
//  rather than try to keep two divergent implementations in sync
//  (defect HIRE-004).
//
//  Pure deletion would 404 deep links. A declarative redirect forwards
//  any traffic — push, deep link, cached navigation history — to the
//  canonical path. No UI flash; expo-router replaces the route stack.
//
//  Verification:
//    1. Old screen route `/jobs/<id>/applications` should redirect.
//    2. Grep across the repo for the deprecated path → zero results.
//    3. Sign in as a client, select an inspector → application row
//       has status='CLIENT_SELECTED' (uppercase) — visible to admin
//       Pending Hires and dispatchable from the Spread Editor.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ApplicationsRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // Defensive: if the route param is missing for any reason, send the
  // user back to a known-good list page rather than a broken canonical URL.
  if (!id) {
    // ★ LANE-A-PHASE-2.1 — Repointed from /client-dashboard (root-level
    //   orphan-soon) to the canonical /(tabs)/client-dashboard.
    return <Redirect href={'/(tabs)/client-dashboard' as any} />;
  }

  // ★ LANE-A-PHASE-2.6 — Repointed from /client/jobs/{id}/applicants
  //   (literal-folder, now stubbed) to canonical /(client)/jobs/{id}/applicants.
  return <Redirect href={`/(client)/jobs/${id}/applicants` as any} />;
}
