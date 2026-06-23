// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/mfa-challenge.tsx — AAL2 step-up challenge.
//
//  Shown by the AuthGate (app/_layout.tsx) whenever an authenticated session is
//  still AAL1 while the user has a verified TOTP factor (mfaRequired). The whole
//  app is blocked behind this screen until the session is stepped up to AAL2.
//  On success we call recheckMfa() → mfaRequired flips false → the gate routes
//  the user to their role home. Sign Out is the only escape.
// ════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const C = {
  background: '#020420',
  surface: '#0F172A',
  border: '#1F2937',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  red: '#EF4444',
};

export default function MfaChallengeScreen() {
  const { recheckMfa, signOut } = useAuth();
  const [factorId, setFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [preparing, setPreparing] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a fresh challenge against the user's verified TOTP factor.
  const prepare = async () => {
    setPreparing(true);
    setError(null);
    try {
      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const totp = (factors?.totp ?? []).find((f) => f.status === 'verified');
      if (!totp) throw new Error('No verified authenticator is set up for this account.');
      setFactorId(totp.id);

      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (cErr) throw cErr;
      setChallengeId(ch.id);
    } catch (e: any) {
      setError(e.message || 'Could not start verification. Please sign out and try again.');
    } finally {
      setPreparing(false);
    }
  };

  useEffect(() => {
    prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    if (code.length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (vErr) throw vErr;
      // Session is now AAL2. Tell the context to re-evaluate → the gate releases.
      setCode('');
      await recheckMfa();
    } catch (e: any) {
      setError(e.message || 'Invalid code. Please try again.');
      setCode('');
      // A consumed/expired challenge can't be reused — get a fresh one.
      prepare();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <SafeAreaView style={st.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.background} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={st.flex}
      >
        <View style={st.content}>
          <View style={st.iconWrap}>
            <Ionicons name="shield-checkmark" size={34} color={C.primaryLight} />
          </View>

          <Text style={st.title}>Two-Factor Verification</Text>
          <Text style={st.subtitle}>
            Enter the 6-digit code from your authenticator app to finish signing in.
          </Text>

          {preparing ? (
            <ActivityIndicator color={C.primaryLight} size="large" style={{ marginTop: 28 }} />
          ) : (
            <>
              <TextInput
                style={st.codeInput}
                placeholder="000000"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
                autoFocus
                textContentType="oneTimeCode"
              />

              {!!error && <Text style={st.errorText}>{error}</Text>}

              <TouchableOpacity
                style={[st.verifyBtn, (code.length < 6 || verifying) && st.verifyBtnDisabled]}
                onPress={verify}
                disabled={code.length < 6 || verifying}
                activeOpacity={0.85}
              >
                {verifying ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={st.verifyBtnText}>Verify &amp; Continue</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={st.signOutBtn} onPress={() => signOut()} activeOpacity={0.7}>
            <Text style={st.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  iconWrap: {
    width: 68, height: 68, borderRadius: 20, alignSelf: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.12)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '800', color: C.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: C.textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 20 },
  codeInput: {
    marginTop: 28, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingVertical: 16, color: C.text, fontSize: 28, fontWeight: '700',
    letterSpacing: 8, textAlign: 'center',
  },
  errorText: { color: C.red, fontSize: 13, textAlign: 'center', marginTop: 12 },
  verifyBtn: {
    marginTop: 20, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  verifyBtnDisabled: { backgroundColor: C.surface, opacity: 0.7 },
  verifyBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  signOutBtn: { marginTop: 28, alignSelf: 'center', padding: 8 },
  signOutText: { color: C.textMuted, fontSize: 14, fontWeight: '600' },
});
