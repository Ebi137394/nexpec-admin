// app/(inspector)/_layout.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Isolated route group. Auth-guarded for inspectors — admins keep
// god-mode oversight (admin ≡ super_admin). Mirrors app/(admin)/_layout.tsx.
// Dark-themed Stack navigator. ZERO contact with other groups.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/src/contexts/AuthContext';

/** Roles admitted to the inspector route group. 'senior' is a Senior Inspector,
 *  who is an inspector with review duties — not a separate portal. */
const INSPECTOR_GROUP_ROLES = ['inspector', 'senior', 'admin', 'super_admin'];

const BG = '#020420';
const ACCENT = '#7C3AED';

export default function InspectorLayout() {
  const router = useRouter();
  const { user, role, loading } = useAuth();

  /* ── Auth Guard ─────────────────────────────────── */
  useEffect(() => {
    if (loading) return;

    // Signed out entirely (null) — let AuthGate notice and route it.
    if (!user) return;

    // Signed in but not an inspector (or overseeing admin) — send home.
    // 'senior' belongs here too: a Senior Inspector IS an inspector who also
    // reviews. Omitting the role bounced them out of the whole group, which is
    // why the Senior Review inbox was unreachable on mobile no matter what
    // linked to it.
    if (!INSPECTOR_GROUP_ROLES.includes(role as string)) {
      router.replace('/');
    }
  }, [user, role, loading]);

  if (loading || !user || !INSPECTOR_GROUP_ROLES.includes(role as string)) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  /* ── Navigator ──────────────────────────────────── */
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: BG },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: BG },
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
