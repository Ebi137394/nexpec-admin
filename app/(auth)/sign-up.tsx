import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView, Image, StatusBar } from 'react-native';
import { useRouter, Link } from 'expo-router';
// ✅ FIX: Corrected import path
import { useAuth } from '@/src/contexts/AuthContext';
import { UserRole } from '@/types/core';
import Animated, { FadeInDown } from 'react-native-reanimated';

// ============================================
// 🚨 HARDCODED COLORS TO BYPASS CLINE'S RUINED THEME 🚨
// ============================================
const LOCAL_COLORS = {
  background: '#070716', // Deep dark navy/purple background
  surface: 'rgba(255, 255, 255, 0.05)',
  primary: '#B154F0',    // Vibrant phosphorescent violet (matches sign-in.tsx)
  primaryLight: 'rgba(177, 84, 240, 0.18)',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  border: 'rgba(255, 255, 255, 0.1)',
  warning: '#F59E0B',
  logoPurple: '#B154F0',
};

// ============================================================================
// SIGN UP SCREEN COMPONENT
// ============================================================================
export default function SignUpScreen(): JSX.Element {
  const router = useRouter();
  const { signUp } = useAuth(); 

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [role, setRole] = useState<UserRole>('inspector');
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const isFormValid = (): boolean => {
    return email.trim().length > 0 && password.trim().length >= 6 && termsAccepted;
  };

  const handleSignUp = async (): Promise<void> => {
    if (!email.trim() || password.length < 6) {
      Alert.alert('Error', 'Please enter a valid email and password (min 6 chars).');
      return;
    }
    if (!termsAccepted) {
      Alert.alert('Legal', 'You must accept the terms to continue.');
      return;
    }

    setLoading(true);
    const result = await signUp(email, password, role);
    setLoading(false);

    if (result.success) {
      Alert.alert('Success', 'Account created! Check your email for verification.', [
        // ✅ FIX: Corrected routing path
        { text: 'OK', onPress: () => router.replace('/(auth)/sign-in') }
      ]);
    } else {
      Alert.alert('Sign Up Failed', result.error || 'Something went wrong');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={LOCAL_COLORS.background} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}
          <Animated.View 
            entering={FadeInDown.delay(100).duration(600)}
            style={styles.header}
          >
            <Image
              source={require('../../assets/images/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Join our platform and get started today
            </Text>
          </Animated.View>

          {/* ROLE SELECTOR (INCLUDES ALL 3 ROLES) */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Select your role</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.roleContainer}
            >
              {/* Inspector Button */}
              <TouchableOpacity
                style={[
                  styles.roleButton,
                  role === 'inspector' && styles.roleButtonSelected,
                ]}
                onPress={() => setRole('inspector')}
                activeOpacity={0.7}
                disabled={loading}
              >
                <Text style={styles.roleEmoji}>👷</Text>
                <Text
                  style={[
                    styles.roleTitle,
                    role === 'inspector' && styles.roleTitleSelected,
                  ]}
                >
                  Inspector
                </Text>
                <Text style={styles.roleDescription}>
                  Conduct safety inspections
                </Text>
                {role === 'inspector' && (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Client Button */}
              <TouchableOpacity
                style={[
                  styles.roleButton,
                  role === 'client' && styles.roleButtonSelected,
                ]}
                onPress={() => setRole('client')}
                activeOpacity={0.7}
                disabled={loading}
              >
                <Text style={styles.roleEmoji}>💼</Text>
                <Text
                  style={[
                    styles.roleTitle,
                    role === 'client' && styles.roleTitleSelected,
                  ]}
                >
                  Client
                </Text>
                <Text style={styles.roleDescription}>
                  Request & manage inspections
                </Text>
                {role === 'client' && (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Agency Button */}
              <TouchableOpacity
                style={[
                  styles.roleButton,
                  role === 'agency' && styles.roleButtonSelected,
                ]}
                onPress={() => setRole('agency')}
                activeOpacity={0.7}
                disabled={loading}
              >
                <Text style={styles.roleEmoji}>🏢</Text>
                <Text
                  style={[
                    styles.roleTitle,
                    role === 'agency' && styles.roleTitleSelected,
                  ]}
                >
                  Agency
                </Text>
                <Text style={styles.roleDescription}>
                  Manage multiple inspectors
                </Text>
                {role === 'agency' && (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* INPUTS */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>✉️</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor={LOCAL_COLORS.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!loading}
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={styles.input}
                placeholder="Create a password (min. 6 chars)"
                placeholderTextColor={LOCAL_COLORS.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password-new"
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={handleSignUp}
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowPassword(!showPassword)}
                disabled={loading}
              >
                <Text style={styles.passwordToggleText}>
                  {showPassword ? '🙈' : '👁️'}
                </Text>
              </TouchableOpacity>
            </View>
            {password.length > 0 && password.length < 6 && (
              <Text style={styles.inputHint}>
                Password must be at least 6 characters
              </Text>
            )}
          </View>

          {/* LEGAL SHIELD */}
          <TouchableOpacity
            style={styles.termsContainer}
            onPress={() => setTermsAccepted(!termsAccepted)}
            activeOpacity={0.7}
            disabled={loading}
          >
            <View
              style={[
                styles.checkbox,
                termsAccepted && styles.checkboxChecked,
              ]}
            >
              {termsAccepted && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.termsTextContainer}>
              <Text style={styles.termsText}>
                I agree to the{' '}
                <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
                <Text style={styles.termsLink}>Privacy Policy</Text>
                {'\n'}and acknowledge{' '}
                <Text style={styles.termsHighlight}>
                  I am responsible for safety compliance
                </Text>
                .
              </Text>
            </View>
          </TouchableOpacity>

          {/* SUBMIT — GlowButton-style violet neon CTA (mirrors sign-in). */}
          <View style={styles.glowButtonContainer}>
            <View
              style={[
                styles.glowEffect,
                (!isFormValid() || loading) && styles.glowEffectDimmed,
              ]}
              pointerEvents="none"
            />
            <TouchableOpacity
              style={[
                styles.submitButton,
                (!isFormValid() || loading) && styles.submitButtonDisabled,
              ]}
              onPress={handleSignUp}
              disabled={loading || !isFormValid()}
              activeOpacity={0.85}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.loadingText}>Creating Account...</Text>
                </View>
              ) : (
                <Text style={styles.submitButtonText}>Sign Up</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* REDIRECT */}
          <View style={styles.signInContainer}>
            <Text style={styles.signInText}>Already have an account? </Text>
            {/* ✅ FIX: Corrected routing path */}
            <Link href="/(auth)/sign-in" asChild>
              <TouchableOpacity disabled={loading}>
                <Text style={styles.signInLink}>Sign In</Text>
              </TouchableOpacity>
            </Link>
          </View>
          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: LOCAL_COLORS.background },
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24 },
  bottomSpacer: { height: 40 },
  header: { alignItems: 'center', marginBottom: 32 },
  logo: { 
    width: 120, 
    height: 120, 
    marginBottom: 24,
  },
  title: { fontSize: 32, fontWeight: '800', color: LOCAL_COLORS.text, marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: LOCAL_COLORS.textSecondary, lineHeight: 24, textAlign: 'center' },
  section: { marginBottom: 28 },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: LOCAL_COLORS.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  roleContainer: { gap: 12, paddingBottom: 8 },
  roleButton: { 
    width: 150, 
    backgroundColor: LOCAL_COLORS.surface, 
    borderRadius: 16, 
    padding: 20, 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderWidth: 2, 
    borderColor: LOCAL_COLORS.border, 
    position: 'relative', 
    minHeight: 140 
  },
  roleButtonSelected: { 
    borderColor: LOCAL_COLORS.primary, 
    backgroundColor: LOCAL_COLORS.primaryLight 
  },
  roleEmoji: { fontSize: 40, marginBottom: 12 },
  roleTitle: { fontSize: 18, fontWeight: '700', color: LOCAL_COLORS.textSecondary, marginBottom: 4 },
  roleTitleSelected: { color: LOCAL_COLORS.primary },
  roleDescription: { fontSize: 12, color: LOCAL_COLORS.textMuted, textAlign: 'center' },
  selectedBadge: { position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: LOCAL_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  selectedBadgeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  inputContainer: { marginBottom: 20 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: LOCAL_COLORS.text, marginBottom: 8 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: LOCAL_COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: LOCAL_COLORS.border, paddingHorizontal: 16 },
  inputIcon: { fontSize: 18, marginRight: 12 },
  input: { flex: 1, paddingVertical: 16, fontSize: 16, color: LOCAL_COLORS.text },
  inputHint: { fontSize: 12, color: LOCAL_COLORS.warning, marginTop: 6, marginLeft: 4 },
  passwordToggle: { padding: 8 },
  passwordToggleText: { fontSize: 18 },
  termsContainer: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 28, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: LOCAL_COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: LOCAL_COLORS.border },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: LOCAL_COLORS.border, backgroundColor: LOCAL_COLORS.surface, alignItems: 'center', justifyContent: 'center', marginRight: 14, marginTop: 2 },
  checkboxChecked: { backgroundColor: LOCAL_COLORS.primary, borderColor: LOCAL_COLORS.primary },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  termsTextContainer: { flex: 1 },
  termsText: { fontSize: 14, color: LOCAL_COLORS.textSecondary, lineHeight: 22 },
  termsLink: { color: LOCAL_COLORS.primary, fontWeight: '600' },
  termsHighlight: { color: LOCAL_COLORS.text, fontWeight: '600' },
  // ★ GlowButton-style neon CTA — mirrors GlowButton in sign-in.tsx
  //   and amplifies for prominence. Two glow sources stack:
  //     1) glowEffect — an inset rectangle BEHIND the button, nudged
  //        4px down with a strong violet shadow blooming below.
  //     2) submitButton — the button itself carries a violet halo
  //        shadow (offset 0,0, big radius) so the entire surface
  //        radiates light, not just the area below.
  //   Combined: a dense violet phosphor glow that wraps the CTA
  //   from every direction.
  glowButtonContainer: {
    position: 'relative',
    borderRadius: 14,
    overflow: 'visible',
    marginBottom: 24,
    marginTop: 4,
  },
  glowEffect: {
    position: 'absolute',
    top: 4, left: 6, right: 6, bottom: -4,
    backgroundColor: LOCAL_COLORS.primary,
    borderRadius: 14,
    opacity: 0.75,
    shadowColor: LOCAL_COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.95,
    shadowRadius: 18,
    elevation: 14,
  },
  glowEffectDimmed: { opacity: 0, shadowOpacity: 0 },
  submitButton: {
    backgroundColor: LOCAL_COLORS.primary,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: LOCAL_COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 12,
  },
  submitButtonDisabled: { backgroundColor: 'rgba(177, 84, 240, 0.3)', shadowOpacity: 0 },
  submitButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  signInContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signInText: { fontSize: 15, color: LOCAL_COLORS.textSecondary },
  signInLink: { fontSize: 15, color: LOCAL_COLORS.primary, fontWeight: '700' },
});