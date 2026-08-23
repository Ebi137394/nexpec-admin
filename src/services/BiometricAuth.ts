// src/services/BiometricAuth.ts

// Native module loaded defensively so Expo Go (no ExpoLocalAuthentication)
// degrades gracefully instead of crashing at import.
import LocalAuthentication from './_localAuthSafe';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

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

//  The refresh token lives in the OS keystore (Keychain / Android Keystore),
//  never in AsyncStorage. SecureStore keys must be alphanumeric + ._- only.
const SECURE_REFRESH_KEY = 'nexpec_biometric_refresh_token';

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
    // Capture the CURRENT refresh token so a later biometric unlock has
    // something to restore. Without this the unlock succeeds and then has no
    // session to hand back — the defect this fixes.
    const { data } = await supabase.auth.getSession();
    if (data.session?.refresh_token) {
      await SecureStore.setItemAsync(SECURE_REFRESH_KEY, data.session.refresh_token);
    }
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
    await SecureStore.deleteItemAsync(SECURE_REFRESH_KEY).catch(() => {});
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

// ─── Session restoration (the piece the unlock was missing) ──────────────────

/**
 * Keep the stored refresh token in step with Supabase's rotation.
 *
 * WHY THIS IS REQUIRED: the project has refresh_token_rotation enabled, so
 * every auto-refresh issues a new token and retires the previous one. A token
 * captured once at enrolment would go stale within the hour and the unlock
 * would fail. Called from the single existing onAuthStateChange handler in
 * AuthContext, so it tracks SIGNED_IN and TOKEN_REFRESHED alike.
 *
 * No-op unless the user has actually enabled biometric login.
 */
/**
 * Biometric lock (owner-approved 2026-08-23).
 *
 * Signing out must NOT call the server logout endpoint when biometric login is
 * enabled: EVERY scope — 'local' included — revokes the current session's
 * refresh token server-side. Verified against the live API, both scopes return
 * "Invalid Refresh Token: Refresh Token Not Found". That revocation is exactly
 * why biometric restore kept failing with "Session expired".
 *
 * Instead we drop the persisted session so a cold start is signed out, while
 * the keystore token stays valid for the next fingerprint unlock — the model
 * banking apps use. Trade-off accepted by the owner: the session remains valid
 * server-side until it expires, so anyone holding the unlocked device AND an
 * enrolled fingerprint can re-enter.
 */
export async function lockSessionForBiometric(): Promise<void> {
  // Persist the CURRENT token first — rotation may have moved past the one
  // captured at enrolment.
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.refresh_token) {
      await SecureStore.setItemAsync(SECURE_REFRESH_KEY, data.session.refresh_token);
    }
  } catch { /* fall through: an older stored token may still be valid */ }

  // Drop supabase-js's persisted session (key is `sb-<ref>-auth-token`); no
  // network call, so nothing is revoked.
  try {
    const keys = await AsyncStorage.getAllKeys();
    const sessionKeys = keys.filter((k) => /^sb-.*-auth-token$/.test(k));
    if (sessionKeys.length) await AsyncStorage.multiRemove(sessionKeys);
  } catch { /* best effort */ }
}

export async function syncBiometricSession(session: Session | null): Promise<void> {
  try {
    const { enabled } = await isBiometricLoginEnabled();
    if (!enabled) return;
    if (session?.refresh_token) {
      await SecureStore.setItemAsync(SECURE_REFRESH_KEY, session.refresh_token);
    }
  } catch {
    // Never let token bookkeeping break the auth state listener.
  }
}

/**
 * Exchange the keystore-held refresh token for a live Supabase session.
 * Call ONLY after authenticateWithBiometrics() has succeeded.
 *
 * On success the normal onAuthStateChange path fires and AuthGate routes the
 * user exactly as it does after a password sign-in — no separate navigation
 * path, no bypass of role or MFA checks.
 */
export async function restoreSessionFromBiometric(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const token = await SecureStore.getItemAsync(SECURE_REFRESH_KEY);
    if (!token) return { ok: false, error: 'no_stored_session' };

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });
    if (error || !data.session) {
      // Rotated, revoked or expired (e.g. signed out on another device).
      await SecureStore.deleteItemAsync(SECURE_REFRESH_KEY).catch(() => {});
      return { ok: false, error: error?.message ?? 'session_expired' };
    }

    // Rotation issued a fresh token — persist it or the next unlock fails.
    await SecureStore.setItemAsync(SECURE_REFRESH_KEY, data.session.refresh_token);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'restore_failed' };
  }
}
