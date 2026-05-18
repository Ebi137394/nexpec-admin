// ════════════════════════════════════════════════════════════════════════════
//  app/(organization)/_layout.tsx — LANE-A-PHASE-2.2 (organization) scaffold
//
//  Greenfield route group for Enterprise / Organization-seat users.
//  Established now (rather than deferred to v2) to lock in strict isolation
//  for Enterprise concerns from day one — per the Lane A decision to pay
//  the structural cost upfront instead of accumulating Enterprise debt.
//
//  This layout is intentionally minimal. Organization-specific screens
//  (Order Form review, Seat admin panel, audit log exports, DPA-acceptance
//  history) land here in subsequent lanes (Lane B component extraction
//  will identify what migrates from (client) + ORG-AGR-001-driven UI).
//
//  Until those screens exist, Organization users continue to route through
//  /(client) as enterprise Clients (per ORG-AGR-001 §1: "CLI-AGR-001
//  applies in full to every Job posted under any Seat of the Organization").
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Stack } from 'expo-router';

export default function OrganizationLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
