import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { Mail, Lock, Eye, EyeOff, ChevronRight, Fingerprint, Scan } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { attemptBiometricLogin, checkBiometricCapability, restoreSessionFromBiometric } from '../../src/services/BiometricAuth';
import { supabase } from '@/lib/supabase';
// ★ SOCIAL-AUTH — Apple + Google via Supabase OAuth. Logic lives in
//   src/lib/social-auth.ts and is independent of the visual layer here.
import {
  signInWithApple,
  signInWithGoogle,
  signInWithLinkedIn,
  postAuthRoute,
} from '@/src/lib/social-auth';

// ============================================
// COLORS — Phosphorescent palette.
//   Background matches sign-up (#070716) so the two screens read as
//   one continuous canvas. Vibrant violet primary, cyan neon for the X.
// ============================================
const LOCAL_COLORS = {
  background:  '#070716',          // Matches sign-up.tsx exactly
  primary:     '#B154F0',          // Vibrant phosphorescent violet (Sign In)
  primaryGlow: 'rgba(177,84,240,0.55)', // Soft outer halo
  cyanAccent:  '#7C3AED',          // Phosphorescent purple for the X halo
  text:        '#FFFFFF',
  textMuted:   '#9CA3AF',
  inputBg:     'rgba(255, 255, 255, 0.05)',
  border:      'rgba(255, 255, 255, 0.1)',
  logoPurple:  '#B154F0',          // NEPEC letters in vibrant violet
};

// ────────────────────────────────────────────────────────────────────
// SECURITY (Phase 1): the DEV-ONLY SSO bypass was removed entirely — it
// shipped a hardcoded password and a password-based auth shortcut in the
// bundle. There is no bypass path; sign-in uses real password auth or
// supabase.auth.signInWithSSO().
// ────────────────────────────────────────────────────────────────────

// ============================================
// CUSTOM INPUT COMPONENT
// ============================================
const InputField = ({ icon, placeholder, value, onChangeText, secureTextEntry = false, keyboardType = 'default', autoCapitalize = 'none', rightIcon, onRightIconPress, testID }: any) => {
  const animatedBorderColor = useRef(new Animated.Value(0)).current;

  const handleFocus = () => {
    Animated.timing(animatedBorderColor, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  };

  const handleBlur = () => {
    Animated.timing(animatedBorderColor, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const borderColor = animatedBorderColor.interpolate({
    inputRange: [0, 1],
    outputRange: [LOCAL_COLORS.border, LOCAL_COLORS.primary],
  });

  return (
    <Animated.View style={[styles.inputContainer, { borderColor: borderColor, borderWidth: 1 }]}>
      <View style={styles.inputIconContainer}>{icon}</View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={LOCAL_COLORS.textMuted}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        onFocus={handleFocus}
        onBlur={handleBlur}
        selectionColor={LOCAL_COLORS.primary}
        testID={testID}
      />
      {rightIcon && (
        <TouchableOpacity style={styles.rightIconContainer} onPress={onRightIconPress} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {rightIcon}
        </TouchableOpacity>
      )}
    </Animated.View>
  );
};

// ============================================
// BIOMETRIC BUTTON
// ============================================
const BiometricButton = ({ capability, onPress, loading = false }: any) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePressIn = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} disabled={loading} style={styles.biometricButton}>
      <Animated.View style={[styles.biometricButtonContent, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.biometricIconContainer}>
          {capability.biometricType === 'faceId' ? <Scan size={36} color={LOCAL_COLORS.primary} /> : <Fingerprint size={36} color={LOCAL_COLORS.primary} />}
        </View>
        <View style={styles.biometricTextContainer}>
          <Text style={styles.biometricText}>Sign in with {capability.displayName}</Text>
          <Text style={styles.biometricSubtext}>Tap to authenticate</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

// ============================================
// GLOW BUTTON (Purple Neon)
// ============================================
const GlowButton = ({ title, onPress, loading = false, testID }: any) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePressIn = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} disabled={loading} testID={testID}>
      <Animated.View style={[styles.glowButtonContainer, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.glowEffect} />
        <View style={styles.buttonContent}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Text style={styles.buttonText}>{title}</Text>
              <ChevronRight size={22} color="#FFFFFF" strokeWidth={3} />
            </>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

// ============================================
// SOCIAL AUTH BUTTON (Apple / Google)
//   Dark card surface with a 1px border, matching the input + SSO row.
//   The icon recolors per-provider so the buttons feel distinct without
//   leaving the dark/purple system.
// ============================================
const SocialAuthButton = ({
  provider,
  label,
  onPress,
  loading = false,
  disabled = false,
}: {
  provider: 'apple' | 'google' | 'linkedin_oidc';
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePressIn  = () => Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
    >
      <Animated.View
        style={[
          styles.socialAuthButton,
          (disabled || loading) && { opacity: 0.6 },
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={LOCAL_COLORS.text} size="small" />
        ) : (
          <>
            <Ionicons
              name={provider === 'apple' ? 'logo-apple' : provider === 'google' ? 'logo-google' : 'logo-linkedin'}
              size={16}
              color={LOCAL_COLORS.text}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.socialAuthButtonText}>{label}</Text>
          </>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
};

// ============================================
// MAIN SCREEN
// ============================================
export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [isAppReady, setIsAppReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [biometric, setBiometric] = useState<any>(null);
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  // ★ Social-auth busy state (per provider, so the spinner only lands
  //   on the button the user actually tapped).
  const [socialBusy, setSocialBusy] = useState<'apple' | 'google' | 'linkedin_oidc' | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  // ★ Phosphorescent X pulse — drives both the sharp core letter and
  //   the outer cyan halo. One loop, multiple interpolations.
  const xPulse = useRef(new Animated.Value(0)).current;

  // X-letter breathing transforms — scale + opacity only, no second
  // layered glyph (that's what caused the visible square block).
  const xCoreScale   = xPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const xCoreOpacity = xPulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });

  useEffect(() => {
    // Logo Pulse Animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, { toValue: 1.05, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(logoScale, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();

    // ★ X-letter phosphorescent pulse (slightly faster than the image
    //   logo so the two cycles don't lock-step and feel mechanical).
    Animated.loop(
      Animated.sequence([
        Animated.timing(xPulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(xPulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    // Transition from Splash to Form
    const timer = setTimeout(() => {
      setIsAppReady(true);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start();
    }, 2000); // Shortened splash time

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    initBiometrics();
  }, []);

  const initBiometrics = async () => {
    try {
      const capability = await checkBiometricCapability();
      setBiometric(capability);
      setBiometricChecked(true);
      if (capability.isSupported && capability.isEnrolled) {
        handleBiometricLogin();
      }
    } catch (error) {
      setBiometricChecked(true);
    }
  };

  const handleBiometricLogin = useCallback(async () => {
    setBiometricLoading(true);
    try {
      const result = await attemptBiometricLogin();
      if (result.success && result.userId) {
        // The unlock only proves the fingerprint/face matched — it does NOT
        // create a session. Exchange the keystore-held refresh token for a
        // live one; AuthGate then routes exactly as after a password sign-in.
        const restored = await restoreSessionFromBiometric();
        if (!restored.ok) {
          Alert.alert(
            'Session expired',
            'Your saved session is no longer valid. Please sign in with your password once to re-enable biometric login.',
          );
        }
        return;
      }
      if (!result.success && !result.shouldFallback && result.error) {
        Alert.alert('Biometric sign-in failed', result.error);
      }
    } finally {
      setBiometricLoading(false);
    }
  }, []);

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      Alert.alert('Sign In Failed', error?.message || 'Invalid credentials. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Apple / Google sign-in handler ─────────────────────────────────
  // Routes through src/lib/social-auth.ts, which uses Supabase OAuth so
  // we don't need a native module. After a successful sign-in we let
  // AuthGate take over routing UNLESS the user has no role yet — in
  // that case postAuthRoute() returns /(auth)/choose-role.
  const handleSocialSignIn = async (provider: 'apple' | 'google' | 'linkedin_oidc') => {
    setSocialBusy(provider as any);
    try {
      const result =
        provider === 'apple' ? await signInWithApple()
        : provider === 'google' ? await signInWithGoogle()
        : await signInWithLinkedIn();
      if (!result.ok) {
        if (result.error && result.error !== 'cancelled') {
          Alert.alert(
            provider === 'apple' ? 'Apple sign-in failed'
            : provider === 'google' ? 'Google sign-in failed'
            : 'LinkedIn sign-in failed',
            result.error,
          );
        }
        return;
      }
      const next = postAuthRoute(result);
      if (next) router.replace(next as any);
      // else: AuthGate routes based on the user's role.
    } finally {
      setSocialBusy(null);
    }
  };

  // ─── Phase 3 / Task 1 — SSO + Enterprise sign-in ────────────────────
  // No UI change. Uses the email already typed in the field above; if
  // empty, prompts for it via Alert. Looks the domain up in
  // public.enterprise_domains, then calls supabase.auth.signInWithSSO()
  // which redirects to the configured SAML / OIDC provider.
  const handleSsoLogin = async (variant: 'sso' | 'enterprise') => {
    const tryDomain = async (domainStr: string) => {
      // (DEV-ONLY SSO bypass removed in Phase 1 — all sign-in uses real auth.)

      setIsLoading(true);
      try {
        // 1. Resolve the domain — may also tell us the provider name.
        const { data: rows, error: lookupErr } = await supabase
          .rpc('lookup_sso_for_email', { p_email: domainStr.includes('@') ? domainStr : `x@${domainStr}` });
        if (lookupErr) throw lookupErr;

        const match = (rows ?? [])[0];
        if (!match) {
          Alert.alert(
            'No SSO configured',
            `The domain "${(domainStr.split('@')[1] ?? domainStr).toLowerCase()}" is not registered for SSO. ` +
              `Use email + password, or contact your administrator.`,
          );
          return;
        }

        // 2. Trigger Supabase SSO. domain identifies which configured
        //    SAML/OIDC provider to use (configured in Supabase dashboard).
        const { data, error } = await supabase.auth.signInWithSSO({
          domain: match.domain,
        });
        if (error) throw error;

        // 3. supabase.auth.signInWithSSO returns a URL that opens the IdP.
        //    On native, expo-auth-session typically handles the redirect;
        //    on web, the browser navigates directly. If url present, open it.
        if (data?.url) {
          await Linking.openURL(data.url);
        }
      } catch (err: any) {
        // GoTrue reports unprovisioned SSO as "SAML 2.0 is disabled" (or
        // provider-not-found variants). Users must never read protocol
        // jargon — to them it simply means their company isn't onboarded.
        const raw = String(err?.message ?? '');
        const unprovisioned =
          /saml|sso/i.test(raw) &&
          /disabled|not\s+(enabled|found|configured)|no\s+provider/i.test(raw);
        Alert.alert(
          variant === 'enterprise'
            ? 'Enterprise sign-in unavailable'
            : 'SSO unavailable',
          unprovisioned
            ? 'Single sign-on is not active for this domain yet. Use email + password, or ask your administrator about NEXPEC enterprise onboarding.'
            : 'Could not start the sign-in flow. Please try again.',
        );
      } finally {
        setIsLoading(false);
      }
    };

    // Use the email already in the form if valid; otherwise prompt.
    const trimmed = email.trim();
    if (trimmed && trimmed.includes('@')) {
      await tryDomain(trimmed);
      return;
    }

    // Alert.prompt is iOS-only. On Android, fall back to a 2-step Alert
    // that asks the user to type their email into the email field first.
    if (Platform.OS === 'ios' && (Alert as any).prompt) {
      (Alert as any).prompt(
        variant === 'enterprise' ? 'Enterprise sign-in' : 'Single sign-on',
        'Enter your work email or domain (e.g. you@acme.com)',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: (val: string) => val && tryDomain(val) },
        ],
        'plain-text',
      );
    } else {
      Alert.alert(
        variant === 'enterprise' ? 'Enterprise sign-in' : 'Single sign-on',
        'Type your work email in the field above, then tap this button again.',
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={LOCAL_COLORS.background} />

      <KeyboardAvoidingView style={styles.keyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false}>

          <Animated.View style={[styles.content, { opacity: isAppReady ? fadeAnim : 1, transform: [{ translateY: isAppReady ? slideAnim : 0 }] }]}>

            {/* ========== LOGO SECTION ========== */}
            <View style={[styles.logoSection, !isAppReady && { flex: 1, justifyContent: 'center', marginTop: 100 }]}>
              <Animated.View
                style={[
                  styles.logoContainer,
                  !isAppReady && styles.logoContainerSplash,
                  { transform: [{ scale: logoScale }] },
                ]}
              >
                {/* Make sure your glowing X logo is exactly at this path */}
                <Image source={require('../../assets/images/logo.png')} style={styles.logoImage} resizeMode="contain" />
              </Animated.View>

              {/* ★ PHOSPHORESCENT NEXPEC WORDMARK
                  Three Text blocks: "NE" / "X" / "PEC". The X is
                  rendered as two stacked layers — a back layer with
                  a huge textShadowRadius for the outer halo bloom,
                  and a sharp front layer with a tight shadow for the
                  bright tube core. Both layers share color #06B6D4
                  and font metrics so they overlap perfectly (no
                  square-block artifact). Whole stack breathes on
                  the xPulse loop. */}
              <View style={styles.appTitleRow}>
                <Text style={styles.appTitleSegment}>NE</Text>
                <View style={styles.xWrap}>
                  <Animated.Text
                    style={[
                      styles.xGlowHalo,
                      { transform: [{ scale: xCoreScale }], opacity: xCoreOpacity },
                    ]}
                  >
                    X
                  </Animated.Text>
                  <Animated.Text
                    style={[
                      styles.xCoreSharp,
                      { transform: [{ scale: xCoreScale }], opacity: xCoreOpacity },
                    ]}
                  >
                    X
                  </Animated.Text>
                </View>
                <Text style={styles.appTitleSegment}>PEC</Text>
              </View>
              <Text style={styles.appSubtitle}>The Future of Inspection</Text>
            </View>

            {/* ========== FORM SECTION (Only shows after splash) ========== */}
            {isAppReady && (
              <View style={styles.formSection}>
                <Text style={styles.welcomeText}>Welcome Back</Text>
                <Text style={styles.instructionText}>Sign in to continue your inspections</Text>

                <InputField testID="signin-email" icon={<Mail size={20} color={LOCAL_COLORS.textMuted} />} placeholder="Email Address" value={email} onChangeText={setEmail} keyboardType="email-address" />
                <InputField testID="signin-password" icon={<Lock size={20} color={LOCAL_COLORS.textMuted} />} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} rightIcon={showPassword ? <EyeOff size={20} color={LOCAL_COLORS.textMuted} /> : <Eye size={20} color={LOCAL_COLORS.textMuted} />} onRightIconPress={() => setShowPassword(!showPassword)} />

                <TouchableOpacity style={styles.forgotPasswordContainer} onPress={async () => {
                  const addr = email.trim();
                  if (!addr) { Alert.alert('Enter your email', 'Type your email above, then tap Forgot Password to get a reset link.'); return; }
                  // redirectTo brings the email link back to app/(auth)/reset-password.tsx
                  // (bare path — route-group parens are not part of the deep-link URL).
                  const { error } = await supabase.auth.resetPasswordForEmail(addr, {
                    redirectTo: Linking.createURL('reset-password'),
                  });
                  Alert.alert(error ? 'Could not send' : 'Check your email', error ? error.message : 'We sent a password reset link to your email.');
                }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                </TouchableOpacity>

                {biometricChecked && biometric?.isSupported && biometric?.isEnrolled && (
                  <BiometricButton capability={biometric} onPress={handleBiometricLogin} loading={biometricLoading} />
                )}

                <GlowButton testID="signin-submit" title="Sign In" onPress={handleSignIn} loading={isLoading} />

                <View style={styles.dividerContainer}>
                  <View style={styles.dividerLine} /><Text style={styles.dividerText}>or continue with</Text><View style={styles.dividerLine} />
                </View>

                {/* ★ SOCIAL AUTH — Apple + Google, full-width, themed. */}
                <SocialAuthButton
                  provider="apple"
                  label="Continue with Apple"
                  onPress={() => handleSocialSignIn('apple')}
                  loading={socialBusy === 'apple'}
                  disabled={socialBusy !== null && socialBusy !== 'apple'}
                />
                <SocialAuthButton
                  provider="google"
                  label="Continue with Google"
                  onPress={() => handleSocialSignIn('google')}
                  loading={socialBusy === 'google'}
                  disabled={socialBusy !== null && socialBusy !== 'google'}
                />
                <SocialAuthButton
                  provider="linkedin_oidc"
                  label="Continue with LinkedIn"
                  onPress={() => handleSocialSignIn('linkedin_oidc')}
                  loading={socialBusy === 'linkedin_oidc'}
                  disabled={socialBusy !== null && socialBusy !== 'linkedin_oidc'}
                />

                {/* ★ ENTERPRISE — SSO + Enterprise sign-in, RESTORED (owner
                    order, 2026-08-21). These are working product features, not
                    placeholders: the flow resolves the user's work domain via
                    lookup_sso_for_email and starts supabase.auth.signInWithSSO
                    for a registered domain. When no provider is registered for
                    the domain it answers honestly ("not registered for SSO —
                    use email + password or contact your administrator"), which
                    is correct behaviour today and works end-to-end the moment
                    an enterprise IdP is configured — no app update needed. */}
                <View style={styles.socialContainer}>
                  <TouchableOpacity
                    style={styles.socialButton}
                    onPress={() => handleSsoLogin('sso')}
                    disabled={socialBusy !== null}
                    testID="sso-sign-in"
                    accessibilityRole="button"
                    accessibilityLabel="Single sign-on"
                  >
                    <Text style={styles.socialButtonText}>🔐 SSO</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.socialButton}
                    onPress={() => handleSsoLogin('enterprise')}
                    disabled={socialBusy !== null}
                    testID="enterprise-sso-sign-in"
                    accessibilityRole="button"
                    accessibilityLabel="Enterprise sign-in"
                  >
                    <Text style={styles.socialButtonText}>🏢 Enterprise</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {isAppReady && (
              <View style={styles.footerSection}>
                <Text style={styles.footerText}>Don't have an account? </Text>
                <Link href="/(auth)/sign-up" asChild><TouchableOpacity><Text style={styles.signUpText}>Sign Up</Text></TouchableOpacity></Link>
              </View>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: LOCAL_COLORS.background },
  keyboardAvoidingView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 10 },
  content: { flex: 1, justifyContent: 'center' },

  logoSection: { alignItems: 'center', marginBottom: 14 },
  logoContainer: { width: 124, height: 124, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  // ★ Splash phase: dramatically larger logo for "first impression" gravitas.
  logoContainerSplash: { width: 200, height: 200, marginBottom: 24 },
  logoImage: { width: '100%', height: '100%' },
  appTitle: { fontSize: 26, fontWeight: '800', color: LOCAL_COLORS.text, letterSpacing: 6, marginBottom: 4 },
  highlightedX: { color: LOCAL_COLORS.logoPurple, fontWeight: '900' },
  appSubtitle: { fontSize: 12, color: LOCAL_COLORS.textMuted, letterSpacing: 1 },

  // ★ Phosphorescent wordmark — separate-letter row so we can animate
  //   only the X without breaking RN's text-shadow rules.
  appTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  // ★ The flanking "NE" and "PEC" blocks. Sharp white, bigger and
  //   heavier than before so the wordmark feels chiseled. The subtle
  //   cyan inner-glow ties them visually to the neon X without
  //   stealing focus from it.
  appTitleSegment: {
    fontSize: 32,
    fontWeight: '900',
    color: LOCAL_COLORS.text,
    letterSpacing: 6,
    textShadowColor: 'rgba(124,58,237,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  // ★ X — STACKED neon. Two perfectly overlapping Text layers:
  //   xGlowHalo (absolute, huge radius bloom) underneath, xCoreSharp
  //   (in-flow, tight radius) on top. Same color #06B6D4 on both so
  //   they merge into a single phosphor letter — never producing a
  //   visible second-letter "box."
  xWrap: {
    marginHorizontal: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  xGlowHalo: {
    position: 'absolute',
    top: 0,
    left: 0,
    fontSize: 32,
    fontWeight: '900',
    color: '#7C3AED',
    letterSpacing: 6,
    textShadowColor: '#7C3AED',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 28,
    paddingHorizontal: 4,
    includeFontPadding: false as any,
  },
  xCoreSharp: {
    fontSize: 32,
    fontWeight: '900',
    color: '#7C3AED',
    letterSpacing: 6,
    textShadowColor: '#7C3AED',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    paddingHorizontal: 4,
    includeFontPadding: false as any,
  },

  formSection: { marginBottom: 14 },
  welcomeText: { fontSize: 24, fontWeight: '700', color: LOCAL_COLORS.text, marginBottom: 4, textAlign: 'left' },
  instructionText: { fontSize: 14, color: LOCAL_COLORS.textMuted, marginBottom: 14 },

  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: LOCAL_COLORS.inputBg, borderRadius: 12, marginBottom: 10, paddingHorizontal: 16, height: 48 },
  inputIconContainer: { marginRight: 12 },
  input: { flex: 1, fontSize: 14, color: LOCAL_COLORS.text, height: '100%' },
  rightIconContainer: { padding: 4 },

  forgotPasswordContainer: { alignSelf: 'flex-end', marginBottom: 12, marginTop: -2 },
  forgotPasswordText: { fontSize: 12, color: LOCAL_COLORS.textMuted, fontWeight: '500' },

  glowButtonContainer: { position: 'relative', borderRadius: 12, overflow: 'visible' },
  glowEffect: { position: 'absolute', top: 2, left: 8, right: 8, bottom: -2, backgroundColor: LOCAL_COLORS.primary, borderRadius: 12, opacity: 0.6, shadowColor: LOCAL_COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.8, shadowRadius: 12, elevation: 10 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: LOCAL_COLORS.primary, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24 },
  buttonText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5, marginRight: 8 },

  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: LOCAL_COLORS.border },
  dividerText: { fontSize: 12, color: LOCAL_COLORS.textMuted, marginHorizontal: 16 },

  // ★ Apple/Google buttons — compact, sit comfortably between the CTA
  //   and the SSO/Enterprise row without crowding either.
  socialAuthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LOCAL_COLORS.inputBg,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: LOCAL_COLORS.border,
    marginBottom: 6,
    height: 38,
  },
  socialAuthButtonText: {
    fontSize: 13,
    color: LOCAL_COLORS.text,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  socialContainer: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 4 },
  socialButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: LOCAL_COLORS.inputBg, borderRadius: 10, paddingVertical: 9, borderWidth: 1, borderColor: LOCAL_COLORS.border },
  socialButtonText: { fontSize: 13, color: LOCAL_COLORS.text, fontWeight: '600' },
  comingSoonButton: { opacity: 0.45 },
  comingSoonText: { fontSize: 12 },

  footerSection: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 14, paddingBottom: 10 },
  footerText: { fontSize: 13, color: LOCAL_COLORS.textMuted },
  signUpText: { fontSize: 13, color: LOCAL_COLORS.primary, fontWeight: '700' },

  biometricButton: { backgroundColor: LOCAL_COLORS.inputBg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: LOCAL_COLORS.border, marginBottom: 12 },
  biometricButtonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  biometricIconContainer: { marginRight: 16 },
  biometricTextContainer: { alignItems: 'flex-start', flex: 1 },
  biometricText: { fontSize: 15, color: LOCAL_COLORS.text, fontWeight: '700', marginBottom: 2 },
  biometricSubtext: { fontSize: 12, color: LOCAL_COLORS.textMuted, fontWeight: '500' },
});
