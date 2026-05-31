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

/** The PINNED NEXPEC model-signing public key (Ed25519, key-id
 *  `nexpec-model-2026-v1`). Pinning the trust anchor IN THE APP BINARY — rather
 *  than relying solely on an EAS secret being present at build time — means a
 *  misconfigured/empty env can never silently downgrade us to "no anchor → can't
 *  verify". The corresponding PRIVATE key lives only on the signing box
 *  (gitignored; see docs/KEY_CUSTODY.md) — never in the repo, the app, or a
 *  device. A public key is safe to embed: it can only VERIFY, never sign. */
export const NEXPEC_ML_SIGNING_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEAaiAOBcAtb7dFZDVDJiOc9HPA8zu6i9/vz1MJGASCU54=\n' +
  '-----END PUBLIC KEY-----';

/** Stable id for the pinned key, matched against an artifact's signing_key_id.
 *  Lets us roll to a new key by shipping it in a future build's key map without
 *  a flag-day — old artifacts keep verifying against the old id. */
export const NEXPEC_ML_SIGNING_KEY_ID = 'nexpec-model-2026-v1';

/** Active trust anchor. An env override (EAS secret) wins — for emergency key
 *  rotation between releases — otherwise the pinned key above is used. This is
 *  intentionally NEVER undefined in a normal build, so a signed artifact always
 *  has a key to check against; fail-closed then triggers only on a genuinely
 *  bad/absent signature, never on a missing anchor. */
export const ML_SIGNING_PUBLIC_KEY_PEM =
  (process.env.EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM &&
    process.env.EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM.replace(/\\n/g, '\n')) ||
  NEXPEC_ML_SIGNING_PUBLIC_KEY_PEM;
