// src/services/BiometricAuth.ts

// Native module loaded defensively so Expo Go (no ExpoLocalAuthentication)
// degrades gracefully instead of crashing at import.
import LocalAuthentication from './_localAuthSafe';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BiometricCapability {
  isSupported: boolean;
  isEnrolled: boolean;
  biometricType: BiometricType;
  displayName: string;        // "Face ID", "Fingerprint", "Biometrics"
  iconName: string;           // Ionicons icon name
}

export type BiometricType = 'faceId' | 'fingerprint' | 'iris' | 'none';

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  warning?: string;
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  BIOMETRIC_ENABLED: '@nexpec/biometric_enabled',
  BIOMETRIC_USER_ID: '@nexpec/biometric_user_id',
} as const;

// ─── Core Service ────────────────────────────────────────────────────────────

/**
 * Check what biometric capabilities the device has.
 *
 * @example
 * ```ts
 * const capability = await checkBiometricCapability();
 * if (capability.isSupported && capability.isEnrolled) {
 *   // Show "Login with Face ID" button
 * }
 * ```
 */
export async function checkBiometricCapability(): Promise<BiometricCapability> {
  const defaultResult: BiometricCapability = {
    isSupported: false,
    isEnrolled: false,
    biometricType: 'none',
    displayName: 'Biometrics',
    iconName: 'finger-print',
  };

  try {
    // ── 1. Hardware check ────────────────────────────────────────────────
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return defaultResult;

    // ── 2. Enrollment check ──────────────────────────────────────────────
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    // ── 3. Determine type ────────────────────────────────────────────────
    const supportedTypes =
      await LocalAuthentication.supportedAuthenticationTypesAsync();

    let biometricType: BiometricType = 'none';
    let displayName = 'Biometrics';
    let iconName = 'finger-print';

    if (
      supportedTypes.includes(
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
      )
    ) {
      biometricType = 'faceId';
      displayName = Platform.OS === 'ios' ? 'Face ID' : 'Face Unlock';
      iconName = 'scan-outline';
    } else if (
      supportedTypes.includes(
        LocalAuthentication.AuthenticationType.FINGERPRINT
      )
    ) {
      biometricType = 'fingerprint';
      displayName = Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
      iconName = 'finger-print';
    } else if (
      supportedTypes.includes(
        LocalAuthentication.AuthenticationType.IRIS
      )
    ) {
      biometricType = 'iris';
      displayName = 'Iris Scan';
      iconName = 'eye-outline';
    }

    return {
      isSupported: true,
      isEnrolled,
      biometricType,
      displayName,
      iconName,
    };
  } catch (error) {
    console.error('[BiometricAuth] Capability check failed:', error);
    return defaultResult;
  }
}

/**
 * Prompt the user for biometric authentication.
 *
 * @example
 * ```ts
 * const result = await authenticateWithBiometrics();
 * if (result.success) {
 *   // Proceed to app
 * }
 * ```
 */
export async function authenticateWithBiometrics(
  promptMessage?: string
): Promise<BiometricAuthResult> {
  try {
    const capability = await checkBiometricCapability();

    if (!capability.isSupported) {
      return {
        success: false,
        error: 'Biometric hardware not available on this device.',
      };
    }

    if (!capability.isEnrolled) {
      return {
        success: false,
        error: `No ${capability.displayName} enrolled. Please set up biometrics in device Settings.`,
        warning: 'not_enrolled',
      };
    }

    const message =
      promptMessage || `Sign in to NEXPEC with ${capability.displayName}`;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: message,
      cancelLabel: 'Use Password',
      disableDeviceFallback: false,   // Allow PIN/pattern as fallback
      fallbackLabel: 'Enter Password',
    });

    if (result.success) {
      return { success: true };
    }

    // Handle specific failure reasons
    if (result.error === 'user_cancel') {
      return {
        success: false,
        error: 'Authentication cancelled.',
        warning: 'user_cancelled',
      };
    }

    if (result.error === 'user_fallback') {
      return {
        success: false,
        error: 'User chose password fallback.',
        warning: 'use_password',
      };
    }

    if (result.error === 'lockout') {
      return {
        success: false,
        error: 'Too many failed attempts. Biometrics locked. Please use your password.',
        warning: 'lockout',
      };
    }

    return {
      success: false,
      error: result.error || 'Authentication failed.',
    };
  } catch (error: any) {
    console.error('[BiometricAuth] Auth error:', error);
    return {
      success: false,
      error: error.message || 'Unexpected biometric error.',
    };
  }
}

// ─── User Preference Persistence ─────────────────────────────────────────────

/**
 * Save the user's preference to use biometric login.
 */
export async function enableBiometricLogin(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.BIOMETRIC_ENABLED, 'true');
    await AsyncStorage.setItem(STORAGE_KEYS.BIOMETRIC_USER_ID, userId);
  } catch (error) {
    console.error('[BiometricAuth] Failed to save preference:', error);
  }
}

/**
 * Disable biometric login.
 */
export async function disableBiometricLogin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.BIOMETRIC_ENABLED);
    await AsyncStorage.removeItem(STORAGE_KEYS.BIOMETRIC_USER_ID);
  } catch (error) {
    console.error('[BiometricAuth] Failed to remove preference:', error);
  }
}

/**
 * Check if biometric login is enabled by the user.
 */
export async function isBiometricLoginEnabled(): Promise<{
  enabled: boolean;
  userId: string | null;
}> {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_ENABLED);
    const userId = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_USER_ID);
    return {
      enabled: enabled === 'true',
      userId,
    };
  } catch {
    return { enabled: false, userId: null };
  }
}

/**
 * Full biometric login flow:
 * 1. Check if user has enabled biometric login
 * 2. Check device capability
 * 3. Prompt for authentication
 * 4. Return result with stored userId
 *
 * @example
 * ```ts
 * const result = await attemptBiometricLogin();
 * if (result.success && result.userId) {
 *   await loginWithStoredCredentials(result.userId);
 * }
 * ```
 */
export async function attemptBiometricLogin(): Promise<{
  success: boolean;
  userId: string | null;
  shouldFallback: boolean;
  error?: string;
}> {
  // 1. Check preference
  const { enabled, userId } = await isBiometricLoginEnabled();

  if (!enabled || !userId) {
    return {
      success: false,
      userId: null,
      shouldFallback: true,
      error: 'Biometric login not configured.',
    };
  }

  // 2. Check capability
  const capability = await checkBiometricCapability();

  if (!capability.isSupported || !capability.isEnrolled) {
    return {
      success: false,
      userId,
      shouldFallback: true,
      error: `${capability.displayName} not available.`,
    };
  }

  // 3. Authenticate
  const authResult = await authenticateWithBiometrics();

  if (authResult.success) {
    return {
      success: true,
      userId,
      shouldFallback: false,
    };
  }

  // User explicitly chose password fallback
  const shouldFallback =
    authResult.warning === 'use_password' ||
    authResult.warning === 'user_cancelled' ||
    authResult.warning === 'lockout';

  return {
    success: false,
    userId,
    shouldFallback,
    error: authResult.error,
  };
}