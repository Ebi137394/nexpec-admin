// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/use-web-portal.tsx — hard-block landing for non-inspector roles
//
//  The NEXPEC mobile app is INSPECTOR-ONLY (per the Mobile Sync Ledger:
//  "This app is specifically for the Inspectors"). When a client / agency /
//  enterprise account signs in, the AuthGate in app/_layout.tsx routes
//  them here instead of into the (tabs)/client-dashboard or
//  (tabs)/agency-dashboard surfaces. Those routes still ship — they're
//  the legacy client/agency UI that hasn't been removed per the user's
//  UI freeze — but the AuthGate prevents them from being reached in a
//  signed-in state.
//
//  This screen has two affordances:
//    1. Open nexpecapp.com in the system browser
//    2. Sign out and return to (auth)/sign-in
//
//  Visual treatment mirrors sign-in.tsx (#070716 background, violet
//  primary, cyan accents) so the brand is consistent.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Globe, LogOut, Wrench } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const COLORS = {
  bg: '#070716',
  surface: '#0E0E22',
  border: 'rgba(255,255,255,0.08)',
  primary: '#B154F0',
  cyan: '#00FFFF',
  text: '#FFFFFF',
  textDim: '#9CA3B5',
  textMuted: '#5A6075',
};

const WEB_PORTAL_URL = 'https://nexpecapp.com';

export default function UseWebPortalScreen() {
  const router = useRouter();
  const { role, user } = useAuth();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleOpenWeb = React.useCallback(async () => {
    try {
      await Linking.openURL(WEB_PORTAL_URL);
    } catch (err) {
      console.warn('[use-web-portal] failed to open URL:', err);
    }
  }, []);

  const handleSignOut = React.useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      router.replace('/(auth)/sign-in' as any);
    } catch (err) {
      console.warn('[use-web-portal] sign-out failed:', err);
    } finally {
      setSigningOut(false);
    }
  }, [router, signingOut]);

  const displayRole = (role ?? '').toString();
  const friendlyRole =
    displayRole.charAt(0).toUpperCase() + displayRole.slice(1).toLowerCase();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Wrench size={32} color={COLORS.primary} strokeWidth={1.5} />
          </View>

          <Text style={styles.kicker}>NEXPEC, INSPECTOR APP</Text>

          <Text style={styles.title}>
            This app is built for inspectors
          </Text>

          <Text style={styles.body}>
            {user?.email ? (
              <>
                <Text style={styles.bodyBold}>{user.email}</Text> is signed in
                as <Text style={styles.bodyBold}>{friendlyRole || 'a client'}</Text>.
                {'\n\n'}
              </>
            ) : null}
            The mobile experience is currently inspector-only. Please use the
            web portal to manage jobs, review applicants, and run your
            workspace as a {friendlyRole?.toLowerCase() || 'client'} account.
          </Text>

          <View style={styles.buttonStack}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleOpenWeb}
              activeOpacity={0.85}
            >
              <Globe size={16} color="#FFFFFF" strokeWidth={2} />
              <Text style={styles.primaryBtnText}>Open nexpecapp.com</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleSignOut}
              disabled={signingOut}
              activeOpacity={0.7}
            >
              {signingOut ? (
                <ActivityIndicator size="small" color={COLORS.textDim} />
              ) : (
                <LogOut size={15} color={COLORS.textDim} strokeWidth={1.75} />
              )}
              <Text style={styles.secondaryBtnText}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footnote}>
            Have an inspector account? Sign out and sign back in with that
            login.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1 },
  glowTop: {
    position: 'absolute',
    top: -160,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: COLORS.primary,
    opacity: 0.18,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200,
    left: -100,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: COLORS.cyan,
    opacity: 0.06,
  },

  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 40,
    alignItems: 'center',
  },

  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(177, 84, 240, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(177, 84, 240, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },

  kicker: {
    color: COLORS.cyan,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 14,
  },
  title: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 18,
  },
  body: {
    color: COLORS.textDim,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 36,
    paddingHorizontal: 8,
  },
  bodyBold: {
    color: COLORS.text,
    fontWeight: '600',
  },

  buttonStack: {
    width: '100%',
    gap: 12,
    marginBottom: 28,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 15,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    borderRadius: 14,
  },
  secondaryBtnText: {
    color: COLORS.textDim,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  footnote: {
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 'auto',
    paddingHorizontal: 16,
  },
});
