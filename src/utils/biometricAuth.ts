import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ─── Constants ──────────────────────────────────────────────
const SECURE_KEYS = {
  EMAIL: 'nexpec_auth_email',
  PASSWORD: 'nexpec_auth_password',
  BIOMETRIC_ENABLED: 'nexpec_biometric_enabled',
} as const;

// ─── Types ──────────────────────────────────────────────────
export enum BiometricType {
  FACE_ID = 'FACE_ID',
  FINGERPRINT = 'FINGERPRINT',
  IRIS = 'IRIS',
  NONE = 'NONE',
}

export interface StoredCredentials {
  email: string;
  password: string;
}

export interface BiometricCheckResult {
  isAvailable: boolean;
  biometricType: BiometricType;
  hasStoredCredentials: boolean;
}

export interface BiometricAuthResult {
  success: boolean;
  credentials?: StoredCredentials;
  error?: string;
  cancelled?: boolean;
}

// ─── Credential Storage ─────────────────────────────────────

/**
 * Securely saves user credentials after a successful manual login.
 * Uses Expo SecureStore which leverages:
 *   - iOS: Keychain Services
 *   - Android: EncryptedSharedPreferences (API 23+) / Keystore
 */
export async function saveCredentials(
  email: string,
  password: string
): Promise<boolean> {
  try {
    if (!email?.trim() || !password) {
      console.warn('[BiometricAuth] Cannot save empty credentials.');
      return false;
    }

    await SecureStore.setItemAsync(SECURE_KEYS.EMAIL, email.trim().toLowerCase());
    await SecureStore.setItemAsync(SECURE_KEYS.PASSWORD, password);
    await SecureStore.setItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED, 'true');

    console.log('[BiometricAuth] Credentials saved securely.');
    return true;
  } catch (error) {
    console.error('[BiometricAuth] Failed to save credentials:', error);
    // If saving partially failed, clean up to avoid inconsistent state
    await removeCredentials();
    return false;
  }
}

/**
 * Retrieves stored credentials from SecureStore.
 * Returns null if either value is missing or corrupted.
 */
export async function getCredentials(): Promise<StoredCredentials | null> {
  try {
    const [email, password, enabled] = await Promise.all([
      SecureStore.getItemAsync(SECURE_KEYS.EMAIL),
      SecureStore.getItemAsync(SECURE_KEYS.PASSWORD),
      SecureStore.getItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED),
    ]);

    if (!email || !password || enabled !== 'true') {
      return null;
    }

    return { email, password };
  } catch (error) {
    console.error('[BiometricAuth] Failed to retrieve credentials:', error);
    return null;
  }
}

/**
 * Removes all stored credentials. Call this on explicit logout
 * or when the user disables biometric login.
 */
export async function removeCredentials(): Promise<boolean> {
  try {
    // deleteItemAsync does NOT throw if the key doesn't exist — safe to call always
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_KEYS.EMAIL),
      SecureStore.deleteItemAsync(SECURE_KEYS.PASSWORD),
      SecureStore.deleteItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED),
    ]);

    console.log('[BiometricAuth] Credentials removed.');
    return true;
  } catch (error) {
    console.error('[BiometricAuth] Failed to remove credentials:', error);
    return false;
  }
}

/**
 * Checks if credentials exist without exposing them.
 */
export async function hasStoredCredentials(): Promise<boolean> {
  try {
    const enabled = await SecureStore.getItemAsync(SECURE_KEYS.BIOMETRIC_ENABLED);
    return enabled === 'true';
  } catch {
    return false;
  }
}

// ─── Biometric Hardware Detection ───────────────────────────

/**
 * Maps the expo-local-authentication enum to our BiometricType.
 */
function mapAuthenticationType(
  types: LocalAuthentication.AuthenticationType[]
): BiometricType {
  // Prioritize Face ID on iOS (users usually have one or the other)
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return BiometricType.FACE_ID;
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return BiometricType.FINGERPRINT;
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return BiometricType.IRIS;
  }
  return BiometricType.NONE;
}

/**
 * Full availability check: hardware present, biometrics enrolled,
 * and credentials stored.
 */
export async function checkBiometricAvailability(): Promise<BiometricCheckResult> {
  const unavailable: BiometricCheckResult = {
    isAvailable: false,
    biometricType: BiometricType.NONE,
    hasStoredCredentials: false,
  };

  try {
    // 1. Check hardware capability
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      console.log('[BiometricAuth] No biometric hardware detected.');
      return unavailable;
    }

    // 2. Check if at least one biometric is enrolled
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      console.log('[BiometricAuth] Biometrics not enrolled on device.');
      return unavailable;
    }

    // 3. Determine which type
    const supportedTypes =
      await LocalAuthentication.supportedAuthenticationTypesAsync();
    const biometricType = mapAuthenticationType(supportedTypes);

    if (biometricType === BiometricType.NONE) {
      return unavailable;
    }

    // 4. Check if we have stored credentials
    const credentialsExist = await hasStoredCredentials();

    return {
      isAvailable: credentialsExist, // Only truly "available" if both hardware & creds
      biometricType,
      hasStoredCredentials: credentialsExist,
    };
  } catch (error) {
    console.error('[BiometricAuth] Availability check failed:', error);
    return unavailable;
  }
}

// ─── Biometric Authentication ───────────────────────────────

/**
 * Returns a user-friendly prompt string based on detected biometric type.
 */
export function getBiometricLabel(type: BiometricType): string {
  switch (type) {
    case BiometricType.FACE_ID:
      return 'Face ID';
    case BiometricType.FINGERPRINT:
      return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
    case BiometricType.IRIS:
      return 'Iris Scan';
    default:
      return 'Biometrics';
  }
}

/**
 * Returns the appropriate Ionicons icon name for the biometric type.
 */
export function getBiometricIcon(type: BiometricType): string {
  switch (type) {
    case BiometricType.FACE_ID:
      return 'scan-outline';        // Ionicons
    case BiometricType.FINGERPRINT:
      return 'finger-print-outline'; // Ionicons
    case BiometricType.IRIS:
      return 'eye-outline';          // Ionicons
    default:
      return 'lock-closed-outline';
  }
}

/**
 * Triggers the OS biometric prompt and, if successful,
 * returns the stored credentials for Supabase sign-in.
 */
export async function authenticateWithBiometrics(
  biometricType: BiometricType
): Promise<BiometricAuthResult> {
  try {
    const label = getBiometricLabel(biometricType);

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Log in to NEXPEC with ${label}`,
      cancelLabel: 'Use Password',
      disableDeviceFallback: false,       // Allow device PIN as fallback
      fallbackLabel: 'Enter Passcode',    // iOS only
    });

    // User cancelled or failed
    if (!result.success) {
      return {
        success: false,
        cancelled: result.error === 'user_cancel' || result.error === 'system_cancel',
        error:
          result.error === 'user_cancel'
            ? 'Authentication cancelled.'
            : result.error === 'lockout'
              ? 'Too many attempts. Please try again later.'
              : `Biometric verification failed: ${result.error}`,
      };
    }

    // Biometric success — retrieve credentials
    const credentials = await getCredentials();

    if (!credentials) {
      return {
        success: false,
        error: 'Stored credentials not found. Please log in with your password.',
      };
    }

    return {
      success: true,
      credentials,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    console.error('[BiometricAuth] Authentication error:', message);
    return {
      success: false,
      error: message,
    };
  }
}