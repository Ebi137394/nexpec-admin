// ════════════════════════════════════════════════════════════════════════════
//  src/services/_localAuthSafe.ts — defensive loader for expo-local-authentication
//
//  WHY: importing `expo-local-authentication` directly throws
//  "Cannot find native module 'ExpoLocalAuthentication'" in runtimes that don't
//  bundle the native module (e.g. Expo Go). That crash takes down the whole
//  screen (it was crashing sign-in). This loader catches it and falls back to a
//  no-op stub that reports "no biometric hardware", so callers degrade
//  gracefully instead of crashing.
//
//  When the native module IS present (dev build / production), this re-exports
//  the real module unchanged — behavior is byte-for-byte identical.
// ════════════════════════════════════════════════════════════════════════════

type LAModule = typeof import('expo-local-authentication');

let _mod: LAModule | null = null;
try {
  // Direct require (string literal) so Metro bundles the package; the try/catch
  // swallows the native-module-missing throw at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _mod = require('expo-local-authentication') as LAModule;
} catch {
  _mod = null;
}

/** True only when the real native module is available on this runtime. */
export const isLocalAuthAvailable: boolean = _mod !== null;

// Minimal stub implementing the surface our callers use. All "capability"
// probes return false → callers fall back to password auth.
const stub = {
  hasHardwareAsync: async () => false,
  isEnrolledAsync: async () => false,
  supportedAuthenticationTypesAsync: async () => [] as number[],
  authenticateAsync: async () => ({ success: false, error: 'unavailable' }),
  cancelAuthenticate: async () => {},
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
} as unknown as LAModule;

const LocalAuthentication: LAModule = _mod ?? stub;

export default LocalAuthentication;
