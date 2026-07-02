// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/reset-password.tsx
//
//  Password-recovery deep-link target. The "Forgot Password?" flow on the
//  sign-in screen calls supabase.auth.resetPasswordForEmail(addr, {
//    redirectTo: Linking.createURL('reset-password')
//  }), so the email link reopens the app at nexpec://reset-password.
//
//  Establishing the recovery session — we accept it from any of three paths,
//  because the carrier differs by Supabase project config / link age:
//    1. A `?code=` query param (PKCE)            → exchangeCodeForSession.
//    2. A PASSWORD_RECOVERY auth event           → onAuthStateChange.
//    3. An already-restored recovery session     → getSession on mount.
//  Once a session is present we reveal the "new password" + "confirm" form,
//  call supabase.auth.updateUser({ password }), then bounce to sign-in.
//
//  Must never crash if opened with no params — it shows a "link expired"
//  state with a path back to sign-in.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Eye, EyeOff, Lock } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  aegis,
  AegisLogo,
  BloomInput,
  LucentButton,
  buzzError,
  buzzSuccess,
} from '@/src/design';

const MIN_LEN = 10;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();

  // 'checking' → resolving whether we have a recovery session
  // 'ready'    → form shown, user can set a new password
  // 'invalid'  → no recovery session could be established (expired link, etc.)
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resolved = useRef(false);

  const markReady = useCallback(() => {
    if (resolved.current) return;
    resolved.current = true;
    setPhase('ready');
  }, []);

  useEffect(() => {
    const first = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : v;

    // 2) PASSWORD_RECOVERY event — fires when the recovery link is opened and
    //    Supabase detects the recovery token. Subscribe FIRST so we don't miss it.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) markReady();
    });

    const bootstrap = async () => {
      // 1) PKCE: exchange a `?code=` if present.
      const code = first(params.code);
      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error && data?.session) {
            markReady();
            return;
          }
        } catch {
          /* fall through to the other paths */
        }
      }

      // 3) A recovery session may already be restored on mount.
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          markReady();
          return;
        }
      } catch {
        /* ignore */
      }

      // Give the PASSWORD_RECOVERY event a brief window to arrive before we
      // declare the link invalid (deep-link → event can lag a tick).
      setTimeout(() => {
        if (!resolved.current) setPhase('invalid');
      }, 2500);
    };

    void bootstrap();
    return () => sub.subscription.unsubscribe();
  }, [params.code, markReady]);

  const handleSubmit = async () => {
    setFormError(null);
    if (password.length < MIN_LEN) {
      setFormError(`Use at least ${MIN_LEN} characters.`);
      return;
    }
    if (password !== confirm) {
      setFormError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      buzzSuccess();
      // Sign out the recovery session so the user re-authenticates with the
      // new password, then land them on sign-in with a success hint.
      try {
        await supabase.auth.signOut();
      } catch {
        /* best-effort */
      }
      router.replace({ pathname: '/(auth)/sign-in', params: { reset: '1' } } as any);
    } catch (e: any) {
      buzzError();
      setFormError(e?.message ?? 'Could not update your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── CHECKING ──────────────────────────────────────────────────────────────
  if (phase === 'checking') {
    return (
      <SafeAreaView style={s.bg}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={aegis.palette.iris} />
          <Text style={s.muted}>Verifying your reset link…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── INVALID ───────────────────────────────────────────────────────────────
  if (phase === 'invalid') {
    return (
      <SafeAreaView style={s.bg}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.center}>
          <AegisLogo size={56} noHalo />
          <Text style={s.title}>Reset link expired</Text>
          <Text style={s.sub}>
            This password reset link is invalid or has expired. Request a new one from
            the sign-in screen.
          </Text>
          <View style={{ width: '100%', marginTop: aegis.space.lg }}>
            <LucentButton
              variant="primary"
              label="Back to sign in"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── READY ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.bg}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.hero}>
            <AegisLogo size={56} noHalo />
            <Text style={s.title}>Set a new password</Text>
            <Text style={s.sub}>
              Choose a strong password you don&apos;t use anywhere else.
            </Text>
          </View>

          <View style={s.form}>
            <BloomInput
              label="New password"
              placeholder="At least 10 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              leadingIcon={<Lock size={18} color={aegis.palette.inkDim} />}
              trailingIcon={
                <TouchableOpacity
                  onPress={() => setShowPw((v) => !v)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {showPw ? (
                    <EyeOff size={18} color={aegis.palette.inkDim} />
                  ) : (
                    <Eye size={18} color={aegis.palette.inkDim} />
                  )}
                </TouchableOpacity>
              }
            />

            <BloomInput
              label="Confirm password"
              placeholder="Re-enter your new password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              error={formError}
              leadingIcon={<Lock size={18} color={aegis.palette.inkDim} />}
            />

            <View style={{ marginTop: aegis.space.sm }}>
              <LucentButton
                variant="primary"
                label="Update password"
                onPress={handleSubmit}
                loading={submitting}
              />
            </View>

            <TouchableOpacity
              style={s.cancel}
              onPress={() => router.replace('/(auth)/sign-in')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: aegis.palette.void },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: aegis.space.xl,
    gap: 12,
  },
  muted: { color: aegis.palette.inkSec, fontSize: 14, fontWeight: '600' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: aegis.space.xl,
    paddingVertical: aegis.space.xxl,
  },
  hero: { alignItems: 'center', gap: 10, marginBottom: aegis.space.xl },
  title: {
    ...aegis.type.d2,
    color: aegis.palette.ink,
    textAlign: 'center',
    marginTop: 8,
  },
  sub: {
    color: aegis.palette.inkDim,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 320,
  },
  form: { width: '100%' },
  cancel: { alignSelf: 'center', marginTop: aegis.space.lg, padding: 8 },
  cancelText: { color: aegis.palette.inkDim, fontSize: 13, fontWeight: '600' },
});
