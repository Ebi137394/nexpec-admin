// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/oauth-callback.tsx
//
//  Cold-start OAuth deep-link target. supabase-js v2 uses the PKCE flow, so
//  providers redirect back to nexpec://oauth-callback?code=... — this screen
//  is the belt-and-suspenders handler for the case where that link reopens
//  the app fresh (in-app round-trips are handled by src/lib/social-auth.ts).
//
//  Flow:
//    1. Read `code` from the deep-link query params.
//    2. exchangeCodeForSession(code)  →  live session.
//    3. Read profiles.role. If the user has a role, send them to their
//       canonical home; if not, send them to /(auth)/choose-role.
//    4. No code / any error → fall back to /(auth)/sign-in.
//
//  Must never crash if opened with no params — it degrades to the sign-in
//  screen.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { aegis } from '@/src/design';
import { needsRole, roleHome } from '@/src/core/navigation/routeMap';

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[]; error?: string | string[] }>();
  // Guard against the effect firing twice (param identity changes / re-render)
  // and double-exchanging the single-use code.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const first = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : v;

    const run = async () => {
      const code = first(params.code);

      // Provider returned an explicit error, or there's simply no code to
      // exchange (app opened directly / link malformed) → back to sign-in.
      if (!code) {
        router.replace('/(auth)/sign-in');
        return;
      }

      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        let user = data?.user ?? null;
        if (error || !user) {
          // The code is single-use. On Android the redirect BOTH deep-links
          // this screen AND resolves social-auth.ts's openAuthSessionAsync —
          // whichever exchanges second fails. If a session already exists,
          // sign-in succeeded; route by role instead of bouncing a freshly
          // signed-in user back to the sign-in screen.
          const { data: existing } = await supabase.auth.getSession();
          user = existing?.session?.user ?? null;
          if (!user) {
            router.replace('/(auth)/sign-in');
            return;
          }
        }

        // Decide destination from the freshly-established session's profile.
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        const role = (profile?.role ?? '').toString().trim();

        if (needsRole(role)) {
          router.replace('/(auth)/choose-role');
        } else {
          router.replace(roleHome(role) as any);
        }
      } catch {
        router.replace('/(auth)/sign-in');
      }
    };

    void run();
  }, [params.code, router]);

  return (
    <SafeAreaView style={s.bg}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.center}>
        <ActivityIndicator size="large" color={aegis.palette.iris} />
        <Text style={s.label}>Completing sign-in…</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: aegis.palette.void },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  label: {
    color: aegis.palette.inkSec,
    fontSize: 14,
    fontWeight: '600',
  },
});
