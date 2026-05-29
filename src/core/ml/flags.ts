// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/flags.ts — Phase A.5 runtime feature flags
//
//  LAW 1 (ZERO BREAKAGE): the runtime is OFF by default. With ML_RUNTIME_ENABLED
//  false, every entry point short-circuits and performs no network, no file I/O,
//  no inference. The app behaves exactly as it does today until you flip the
//  flag on a screen you've opted in.
// ════════════════════════════════════════════════════════════════════════════

/** Master switch. Set EXPO_PUBLIC_ML_RUNTIME=1 to enable on-device ML. */
export const ML_RUNTIME_ENABLED = process.env.EXPO_PUBLIC_ML_RUNTIME === '1';

/** DEV ONLY: when '1', accept models whose signature can't be verified
 *  (hash-still-checked). Never set this in production builds. */
export const ML_ALLOW_UNSIGNED = process.env.EXPO_PUBLIC_ML_ALLOW_UNSIGNED === '1';

/** NEXPEC model-signing public key (PEM). Supply via EAS secret / env. When
 *  absent AND a model carries a signature, verification fails closed unless
 *  ML_ALLOW_UNSIGNED is set. */
export const ML_SIGNING_PUBLIC_KEY_PEM =
  (process.env.EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM &&
    process.env.EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM.replace(/\\n/g, '\n')) ||
  undefined;
