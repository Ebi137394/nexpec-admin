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
    if (role !== 'inspector' && role !== 'admin' && role !== 'super_admin') {
      router.replace('/');
    }
  }, [user, role, loading]);

  if (loading || !user || (role !== 'inspector' && role !== 'admin' && role !== 'super_admin')) {
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
