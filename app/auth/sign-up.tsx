import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider'; // ✅ اتصال به مغز متفکر
import { UserRole } from '@/types/core';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { COLORS } from '../../src/constants/theme';

// ============================================================================
// SIGN UP SCREEN COMPONENT
// ============================================================================

export default function SignUpScreen(): JSX.Element {
  const router = useRouter();
  const { signUp } = useAuth(); // ✅ استفاده از متد signUp که در پروایدر ساختیم

  // ---------------------------------------------------------------------------
  // STATE MANAGEMENT
  // ---------------------------------------------------------------------------
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [role, setRole] = useState<UserRole>('inspector');
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // VALIDATION HELPERS
  // ---------------------------------------------------------------------------
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const isFormValid = (): boolean => {
    return (
      email.trim().length > 0 &&
      password.trim().length >= 6 &&
      termsAccepted
    );
  };

  // ---------------------------------------------------------------------------
  // HANDLE SIGN UP LOGIC
  // ---------------------------------------------------------------------------
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
    // ✅ فراخوانی متد اصلی از AuthProvider
    const result = await signUp(email, password, role);
    setLoading(false);

    if (result.success) {
      Alert.alert('Success', 'Account created! Check your email for verification.', [
        { text: 'OK', onPress: () => router.replace('/auth/sign-in') }
      ]);
    } else {
      Alert.alert('Sign Up Failed', result.error || 'Something went wrong');
    }
  };

  // ---------------------------------------------------------------------------
  // RENDER COMPONENT
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea}>
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

          {/* ROLE SELECTOR */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Select your role</Text>
            <View style={styles.roleContainer}>
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
            </View>
          </View>

          {/* INPUTS */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>✉️</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#9CA3AF"
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
                placeholder="Create a password (min. 6 characters)"
                placeholderTextColor="#9CA3AF"
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

          {/* SUBMIT */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!isFormValid() || loading) && styles.submitButtonDisabled,
            ]}
            onPress={handleSignUp}
            disabled={loading || !isFormValid()}
            activeOpacity={0.8}
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

          {/* REDIRECT */}
          <View style={styles.signInContainer}>
            <Text style={styles.signInText}>Already have an account? </Text>
            <TouchableOpacity
              onPress={() => router.push('/auth/sign-in')}
              disabled={loading}
            >
              <Text style={styles.signInLink}>Sign In</Text>
            </TouchableOpacity>
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

// Using theme constants from src/constants/theme.ts
const THEME_COLORS = {
  primary: COLORS.primary,
  primaryLight: 'rgba(0, 240, 255, 0.15)',
  primaryDark: COLORS.secondary,
  background: COLORS.background,
  surface: COLORS.surface,
  text: COLORS.textPrimary,
  textSecondary: COLORS.textSecondary,
  textMuted: COLORS.textSecondary,
  border: COLORS.border,
  error: COLORS.danger,
  success: COLORS.success,
  warning: COLORS.warning,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: THEME_COLORS.background },
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24 },
  bottomSpacer: { height: 40 },
  header: { alignItems: 'center', marginBottom: 32 },
  logo: { 
    width: 120, 
    height: 120, 
    marginBottom: 24,
  },
  title: { fontSize: 32, fontWeight: '800', color: THEME_COLORS.text, marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: THEME_COLORS.textSecondary, lineHeight: 24, textAlign: 'center' },
  section: { marginBottom: 28 },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: THEME_COLORS.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  roleContainer: { flexDirection: 'row', gap: 12 },
  roleButton: { flex: 1, backgroundColor: THEME_COLORS.surface, borderRadius: 16, padding: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: THEME_COLORS.border, position: 'relative', minHeight: 140, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  roleButtonSelected: { borderColor: THEME_COLORS.primary, backgroundColor: THEME_COLORS.primaryLight, shadowColor: THEME_COLORS.primary, shadowOpacity: 0.3 },
  roleEmoji: { fontSize: 40, marginBottom: 12 },
  roleTitle: { fontSize: 18, fontWeight: '700', color: THEME_COLORS.textSecondary, marginBottom: 4 },
  roleTitleSelected: { color: THEME_COLORS.primary },
  roleDescription: { fontSize: 12, color: THEME_COLORS.textMuted, textAlign: 'center' },
  selectedBadge: { position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: THEME_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  selectedBadgeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  inputContainer: { marginBottom: 20 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: THEME_COLORS.text, marginBottom: 8 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME_COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: THEME_COLORS.border, paddingHorizontal: 16 },
  inputIcon: { fontSize: 18, marginRight: 12 },
  input: { flex: 1, paddingVertical: 16, fontSize: 16, color: THEME_COLORS.text, paddingHorizontal: 0 },
  inputHint: { fontSize: 12, color: THEME_COLORS.warning, marginTop: 6, marginLeft: 4 },
  passwordToggle: { padding: 8 },
  passwordToggleText: { fontSize: 18 },
  termsContainer: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 28, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: THEME_COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: THEME_COLORS.border },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.surface, alignItems: 'center', justifyContent: 'center', marginRight: 14, marginTop: 2 },
  checkboxChecked: { backgroundColor: THEME_COLORS.primary, borderColor: THEME_COLORS.primary },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  termsTextContainer: { flex: 1 },
  termsText: { fontSize: 14, color: THEME_COLORS.textSecondary, lineHeight: 22 },
  termsLink: { color: THEME_COLORS.primary, fontWeight: '600' },
  termsHighlight: { color: THEME_COLORS.text, fontWeight: '600' },
  submitButton: { backgroundColor: THEME_COLORS.primary, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 24, shadowColor: THEME_COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  submitButtonDisabled: { backgroundColor: 'rgba(0, 240, 255, 0.3)', shadowOpacity: 0, elevation: 0 },
  submitButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  signInContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signInText: { fontSize: 15, color: THEME_COLORS.textSecondary },
  signInLink: { fontSize: 15, color: THEME_COLORS.primary, fontWeight: '700' },
});

