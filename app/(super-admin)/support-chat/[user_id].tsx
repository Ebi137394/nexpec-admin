// ════════════════════════════════════════════════════════════════════════════
//  app/(super-admin)/support-chat/[user_id].tsx — LANE-A-PHASE-2.7 (super-admin)→(admin) rename stub
//
//  Pre-strike: canonical admin-tier screen under the (super-admin) route
//  group. Phase 2b moved the content to the symmetrically-named (admin)
//  group and swept all inbound `router.push` / `<Redirect>` references
//  across the codebase. 78 refs migrated, file content copied unchanged.
//
//  Post-strike: forward-only redirect. Out-of-band deep links to the old
//  /(super-admin)/* path land on the canonical /(admin)/* equivalent.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function SuperAdminSupportChatRedirect() {
  const { user_id } = useLocalSearchParams<{ user_id: string }>();
  if (!user_id) return <Redirect href={'/(admin)/support-inbox' as any} />;
  return <Redirect href={`/(admin)/support-chat/${user_id}` as any} />;
}
