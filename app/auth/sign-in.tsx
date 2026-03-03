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
  Dimensions,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Link } from 'expo-router';
import { Mail, Lock, Eye, EyeOff, ChevronRight, Fingerprint, Scan } from 'lucide-react-native';
import { useAuth } from '@/src/contexts/AuthContext';
import { COLORS, SIZES } from '../../src/constants/theme';
import { attemptBiometricLogin, checkBiometricCapability, enableBiometricLogin } from '../../src/services/BiometricAuth';

// Get screen dimensions
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================
// TYPES
// ============================================
interface InputFieldProps {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
}

interface BiometricCapability {
  isSupported: boolean;
  isEnrolled: boolean;
  biometricType: 'faceId' | 'touchId' | 'fingerprint';
  displayName: string;
}

// ============================================
// CUSTOM INPUT COMPONENT
// ============================================
const InputField: React.FC<InputFieldProps> = ({
  icon,
  placeholder,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = 'default' as const,
  autoCapitalize = 'none' as const,
  rightIcon,
  onRightIconPress,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const animatedBorderColor = useRef(new Animated.Value(0)).current;

  const handleFocus = () => {
    setIsFocused(true);
    Animated.timing(animatedBorderColor, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.timing(animatedBorderColor, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const borderColor = animatedBorderColor.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255, 255, 255, 0.1)', COLORS.primary], // ✅ Light border to primary on focus
  });

  return (
    <Animated.View
      style={[
        styles.inputContainer,
        {
          borderColor: borderColor,
          borderWidth: 2,
        },
      ]}
    >
      <View style={styles.inputIconContainer}>{icon}</View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF" // ✅ Light Gray placeholder
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        onFocus={handleFocus}
        onBlur={handleBlur}
        selectionColor={COLORS.primary}
      />
      {rightIcon && (
        <TouchableOpacity
          style={styles.rightIconContainer}
          onPress={onRightIconPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {rightIcon}
        </TouchableOpacity>
      )}
    </Animated.View>
  );
};

// ============================================
// BIOMETRIC BUTTON COMPONENT
// ============================================
interface BiometricButtonProps {
  capability: any;
  onPress: () => void;
  loading?: boolean;
}

const BiometricButton: React.FC<BiometricButtonProps> = ({ capability, onPress, loading = false }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={loading}
      style={styles.biometricButton}
    >
      <Animated.View
        style={[
          styles.biometricButtonContent,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <View style={styles.biometricIconContainer}>
          {capability.biometricType === 'faceId' ? (
            <Scan size={36} color={COLORS.primary} />
          ) : (
            <Fingerprint size={36} color={COLORS.primary} />
          )}
        </View>
        <View style={styles.biometricTextContainer}>
          <Text style={styles.biometricText}>
            Sign in with {capability.displayName}
          </Text>
          <Text style={styles.biometricSubtext}>
            Tap to authenticate
          </Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

// ============================================
// GLOW BUTTON COMPONENT
// ============================================
interface GlowButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
}

const GlowButton: React.FC<GlowButtonProps> = ({ title, onPress, loading = false }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={loading}
    >
      <Animated.View
        style={[
          styles.glowButtonContainer,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {/* Glow Effect Layer */}
        <View style={styles.glowEffect} />
        
        {/* Button Content */}
        <View style={styles.buttonContent}>
          {loading ? (
            <ActivityIndicator color={COLORS.background} size="small" />
          ) : (
            <>
              <Text style={styles.buttonText}>{title}</Text>
              <ChevronRight
                size={22}
                color={COLORS.background}
                strokeWidth={3}
              />
            </>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
};

// ============================================
// MAIN LOGIN SCREEN COMPONENT
// ============================================
export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  // App loading state
  const [isAppReady, setIsAppReady] = useState(false);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Biometric state
  const [biometric, setBiometric] = useState<any>(null);
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const textFadeAnim = useRef(new Animated.Value(0)).current;

  // Initialize app loading with professional animated splash
  React.useEffect(() => {
    // 1. Fixed Easing Pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.quad), // FIXED: Using Quad for better support
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 2. Content Fade-in
    Animated.timing(textFadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();

    // 3. Ready state timer
    const timer = setTimeout(() => {
      setIsAppReady(true);
      // Smooth entrance animation to the main login form
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start();
    }, 3500);

    return () => clearTimeout(timer);
  }, []);

  // Initialize biometrics on mount
  useEffect(() => {
    initBiometrics();
  }, []);

  const initBiometrics = async () => {
    try {
      const capability = await checkBiometricCapability();
      setBiometric(capability);
      setBiometricChecked(true);

      // Auto-prompt if biometric login is configured
      if (capability.isSupported && capability.isEnrolled) {
        handleBiometricLogin();
      }
    } catch (error) {
      console.error('[Login] Biometric init error:', error);
      setBiometricChecked(true);
    }
  };

  // Handle biometric login
  const handleBiometricLogin = useCallback(async () => {
    setBiometricLoading(true);

    try {
      const result = await attemptBiometricLogin();

      if (result.success && result.userId) {
        // ✅ Biometric auth succeeded — proceed with login
        console.log(`[Login] Biometric login success for user: ${result.userId}`);
        // You would typically call your auth context here:
        // await authContext.loginWithUserId(result.userId);
        // router.replace('/(tabs)');
      }

      if (result.shouldFallback) {
        // User cancelled or chose password — do nothing, show normal form
        console.log('[Login] Falling back to password login');
      }
    } catch (error) {
      console.error('[Login] Biometric login error:', error);
    } finally {
      setBiometricLoading(false);
    }
  }, []);

  // --- Stage 1: Professional Animated Splash Screen ---
  if (!isAppReady) {
    return (
      <View style={styles.splashContainer}>
        {/* Top Half: Logo */}
        <View style={styles.logoSection}>
          <Animated.Image 
            source={require('../../assets/images/logo.png')} 
            style={[styles.bigLogo, { transform: [{ scale: logoScale }] }]}
            resizeMode="contain"
          />
        </View>

        {/* Bottom Half: Branding (Separated to prevent overlap) */}
        <Animated.View style={[styles.textSection, { opacity: textFadeAnim }]}>
          <Text style={styles.brandText}>NEXPEC</Text>
          <View style={styles.accentBar} />
          <Text style={styles.tagline}>INDUSTRIAL INSPECTION PLATFORM</Text>
        </Animated.View>
      </View>
    );
  }

  // Handle sign in
  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both email and password.');
      return;
    }

    setIsLoading(true);
    
    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      Alert.alert(
        'Sign In Failed',
        error?.message || 'Invalid credentials. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Handle forgot password
  const handleForgotPassword = async () => {
    // This will be handled by the ForgotPasswordScreen
    router.push('/ForgotPassword');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <Animated.View
            style={[
              styles.content,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            {/* ========== LOGO SECTION ========== */}
            <View style={styles.logoSection}>
              <View style={styles.logoContainer}>
                <Image
                  source={require('../../assets/images/logo.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              
              <Text style={styles.appTitle}>
                NE
                <Text style={styles.highlightedX}>X</Text>
                PEC
              </Text>
              <Text style={styles.appSubtitle}>The Future of Inspection</Text>
            </View>

            {/* ========== FORM SECTION ========== */}
            <View style={styles.formSection}>
              <Text style={styles.welcomeText}>Welcome Back</Text>
              <Text style={styles.instructionText}>
                Sign in to continue your inspections
              </Text>

              {/* Email Input */}
              <InputField
                icon={
                  <Mail
                    size={20}
                    color={COLORS.textSecondary}
                    strokeWidth={2}
                  />
                }
                placeholder="Email Address"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {/* Password Input */}
              <InputField
                icon={
                  <Lock
                    size={20}
                    color={COLORS.textSecondary}
                    strokeWidth={2}
                  />
                }
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                rightIcon={
                  showPassword ? (
                    <EyeOff size={20} color={COLORS.textSecondary} />
                  ) : (
                    <Eye size={20} color={COLORS.textSecondary} />
                  )
                }
                onRightIconPress={() => setShowPassword(!showPassword)}
              />

              {/* Forgot Password Link */}
              <TouchableOpacity
                style={styles.forgotPasswordContainer}
                onPress={handleForgotPassword}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>

              {/* Sign In Button */}
              <GlowButton
                title="Sign In"
                onPress={handleSignIn}
                loading={isLoading}
              />

              {/* Divider */}
              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Social Login Options (Optional) */}
              <View style={styles.socialContainer}>
                <TouchableOpacity style={styles.socialButton}>
                  <Text style={styles.socialButtonText}>🔐 SSO</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.socialButton}>
                  <Text style={styles.socialButtonText}>🏢 Enterprise</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ========== FOOTER SECTION ========== */}
            <View style={styles.footerSection}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <Link href="/auth/sign-up" asChild>
                <TouchableOpacity>
                  <Text style={styles.signUpText}>Sign Up</Text>
                </TouchableOpacity>
              </Link>
            </View>

            {/* Version Info */}
            <Text style={styles.versionText}>Version 1.0.0</Text>
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
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0a23', // ✅ Dark Navy/Black background
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SIZES.padding || 24,
    paddingVertical: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },

  // Logo Section
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    width: 180, // ✅ Bigger size
    height: 180, // ✅ Bigger size
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20, // ✅ Spacing
  },
  logoImage: {
    width: 180, // ✅ Full size to match container
    height: 180, // ✅ Full size to match container
  },
  appTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF', // ✅ White text for "NE" and "PEC"
    letterSpacing: 4,
    marginBottom: 8,
  },
  highlightedX: {
    color: '#D76DF6', // ✅ Purple/pink color for the "X" to match brand logo
    fontWeight: 'bold',
  },
  appSubtitle: {
    fontSize: 14,
    color: '#9CA3AF', // ✅ Light Gray
    letterSpacing: 1,
  },

  // Form Section
  formSection: {
    marginBottom: 32,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF', // ✅ White text, left aligned
    marginBottom: 8,
    textAlign: 'left',
  },
  instructionText: {
    fontSize: 16,
    color: '#9CA3AF', // ✅ Light Gray
    marginBottom: 32,
  },

  // Input Styles
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // ✅ Semi-transparent dark container
    borderRadius: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 60,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)', // ✅ Light border
  },
  inputIconContainer: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF', // ✅ WHITE text color (Critical!)
    height: '100%',
  },
  rightIconContainer: {
    padding: 4,
  },

  // Forgot Password
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: 4,
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#9CA3AF', // ✅ Light Gray
    fontWeight: '500',
  },

  // Glow Button
  glowButtonContainer: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'visible',
  },
  glowEffect: {
    position: 'absolute',
    top: 4,
    left: 10,
    right: 10,
    bottom: -4,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    opacity: 0.4,
    // Shadow for glow effect
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary, // ✅ Primary Cyan/Blue gradient or solid color
    borderRadius: 16, // ✅ Rounded corners
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '800', // ✅ Thicker font weight for better readability
    color: '#FFFFFF', // ✅ White text
    letterSpacing: 1, // ✅ Breathing room between letters
    marginRight: 8,
    // ✅ Text shadow for better readability on bright neon background
    textShadowColor: 'rgba(0, 0, 0, 0.75)', // Strong dark shadow
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },

  // Divider
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 28,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)', // ✅ Light border
  },
  dividerText: {
    fontSize: 13,
    color: '#9CA3AF', // ✅ Light Gray
    marginHorizontal: 16,
  },

  // Social Buttons
  socialContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // ✅ Semi-transparent dark container
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)', // ✅ Light border
  },
  socialButtonText: {
    fontSize: 14,
    color: '#FFFFFF', // ✅ White text
    fontWeight: '600',
  },

  // Footer Section
  footerSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  footerText: {
    fontSize: 15,
    color: '#9CA3AF', // ✅ Light Gray
  },
  signUpText: {
    fontSize: 15,
    color: COLORS.primary, // ✅ Primary Cyan/Blue
    fontWeight: '700',
  },

  // Version
  versionText: {
    fontSize: 12,
    color: '#9CA3AF', // ✅ Light Gray
    textAlign: 'center',
    marginTop: 24,
    opacity: 0.6,
  },

  // Biometric Button Styles
  biometricButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // ✅ Semi-transparent dark container
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)', // ✅ Light border
    marginBottom: 16,
  },
  biometricButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricIconContainer: {
    marginRight: 16,
  },
  biometricTextContainer: {
    alignItems: 'flex-start',
    flex: 1,
  },
  biometricText: {
    fontSize: 16,
    color: '#FFFFFF', // ✅ White text
    fontWeight: '700',
    marginBottom: 2,
  },
  biometricSubtext: {
    fontSize: 12,
    color: '#9CA3AF', // ✅ Light Gray
    fontWeight: '500',
  },

  // Splash Screen Styles
  splashContainer: {
    flex: 1,
    backgroundColor: '#0a0a23', // ✅ Dark Navy/Black background
  },
  // Flex-based logo section for splash screen
  splashLogoSection: {
    flex: 1.5, // Takes up the top portion
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  textSection: {
    flex: 1, // Takes up the bottom portion
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  bigLogo: {
    width: 280,
    height: 280,
  },
  brandText: {
    color: '#FFF',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 12,
    textAlign: 'center',
    // Removed negative margins to prevent hiding
  },
  accentBar: {
    width: 60,
    height: 3,
    backgroundColor: '#00CFD5',
    marginVertical: 20,
  },
  tagline: {
    color: '#94A3B8',
    fontSize: 11,
    letterSpacing: 4,
    fontWeight: '600',
  },
  // لایه‌های درخشش نرم به جای دایره توپر
  glowLayer: {
    position: 'absolute',
    width: 250,
    height: 250,
    backgroundColor: '#00CFD5',
    borderRadius: 125,
    opacity: 0.1, // بسیار کم‌رنگ برای ایجاد افکت هاله
  },
  accentLine: {
    width: 50,
    height: 3,
    backgroundColor: '#00CFD5',
    marginVertical: 15,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 11,
    letterSpacing: 4,
  },
  // This creates the "Glow" behind the logo
  glowCircle: {
    position: 'absolute',
    width: 200,
    height: 200,
    backgroundColor: '#00CFD5',
    borderRadius: 100,
    // Use blur if available, otherwise the opacity pulse creates the effect
    opacity: 0.5,
    shadowColor: '#00CFD5',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 50,
  },
  loadingSubtext: {
    color: '#94A3B8',
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '600',
  },
  splashLogo: {
    width: 160,
    height: 160,
  },
});