// app/(admin)/_layout.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Isolated route group. Auth-guarded for platform admins (admin ≡ super_admin).
// Dark-themed Stack navigator. ZERO contact with other groups.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/src/contexts/AuthContext';       // ← adjust import
import { SA } from '@/lib/super-admin/theme';

export default function SuperAdminLayout() {
  const router = useRouter();
  const { user, role, loading } = useAuth();              // ← adjust destructure

 /* ── Auth Guard ─────────────────────────────────── */
  useEffect(() => {
    if (loading) return;

    // اگر کاربر کامل خارج شده (null)، اینجا هیچ کاری نکن!
    // اجازه بده AuthGate خودش متوجه بشه و مسیر رو مدیریت کنه.
    if (!user) return;

    // اگر کاربر لاگین بود اما نقشش سوپر ادمین نبود، بندازش بیرون
    if (role !== 'super_admin' && role !== 'admin') {
      router.replace('/');
    }
  }, [user, role, loading]);

  if (loading || !user || (role !== 'super_admin' && role !== 'admin')) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={SA.accent} />
      </View>
    );
  }

  /* ── Navigator ──────────────────────────────────── */
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: SA.bg },
          headerTintColor: SA.text,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: SA.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="dashboard"               options={{ headerShown: false }} />
        <Stack.Screen name="pending-hires"            options={{ title: 'Pending Approvals' }} />
        <Stack.Screen name="jobs/index"               options={{ title: 'Job Moderation' }} />
        <Stack.Screen name="jobs/[id]"                options={{ title: 'Spread Editor' }} />
        <Stack.Screen name="live-radar"               options={{ title: 'Live Radar' }} />
        <Stack.Screen name="communications/index"     options={{ title: 'Chat Oversight' }} />
        <Stack.Screen name="communications/support"   options={{ title: 'Support Center' }} />
        <Stack.Screen name="verification/index"       options={{ title: 'Verification Queue' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications & Alerts' }} />
        <Stack.Screen name="payouts" options={{ title: 'Payouts & Finances' }} />
        {/* ★ Phase 4 — Financial Control Center.
            Analytics dashboard pulling from jobs / transactions /
            payout_requests. Linked from the main dashboard card grid. */}
        <Stack.Screen name="financial" options={{ title: 'Financial Center' }} />
        {/* ★ Phase 4.2 — Financial detail screens. Each handles a single
            heavy list (leaderboards, balances, pipeline, active jobs,
            pending payouts) so the main dashboard stays scrollable. */}
        <Stack.Screen name="financial/inspectors"      options={{ title: 'Inspector Earnings' }} />
        <Stack.Screen name="financial/clients"         options={{ title: 'Client Accounts' }} />
        <Stack.Screen name="financial/pipeline"        options={{ title: 'Job Pipeline' }} />
        <Stack.Screen name="financial/active-jobs"     options={{ title: 'Active Jobs' }} />
        <Stack.Screen name="financial/pending-payouts" options={{ title: 'Pending Payouts' }} />
        {/* ★ Phase 5 — Industrial Black Box: immutable audit trail.
            Top-level Command Center route. Accepts optional ?jobId query
            param to deep-link to a single job's timeline. */}
        <Stack.Screen name="audit-trail" options={{ title: 'Audit Trail' }} />
        {/* ★ Phase 6 — Reviews & Reputation Engine: admin moderation queue. */}
        <Stack.Screen name="reviews-moderation" options={{ title: 'Reviews Moderation' }} />
      </Stack>
    </>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: SA.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
});