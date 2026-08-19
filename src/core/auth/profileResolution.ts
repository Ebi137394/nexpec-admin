// ─────────────────────────────────────────────────────────────────
//  src/core/auth/profileResolution.ts — D38 fix: authoritative-vs-
//  unavailable profile resolution for the auth gate.
//
//  THE DEFECT (observed live on Android emulator AND iOS Simulator):
//  an OFFLINE cold start made the profile fetch fail, AuthContext
//  defaulted to { role: null, termsAccepted: false }, and the gate —
//  unable to tell "network failed" from "user genuinely has no
//  stance" — parked a fully-onboarded inspector on the stance chooser
//  (where an offline save then failed with a network error).
//
//  THE CONTRACT (owner order, 2026-08-18):
//   • The stance chooser may be shown ONLY on an authoritative online
//     answer that the user genuinely has no stance.
//   • Timeout / offline / network / Supabase failure is NEVER treated
//     as missing stance.
//   • During an offline cold start the last VALIDATED role/stance is
//     preserved and used; nothing here ever writes to profiles.
//   • With no validated cache, the caller shows an explicit
//     offline/unavailable screen with Retry — not the chooser.
//
//  Pure TS, no React/RN imports — regression-tested directly under
//  node (auth/__tests__/profileResolution.test.mjs).
// ─────────────────────────────────────────────────────────────────

export interface ProfileSnapshot {
  organizationId: string | null;
  role: string | null;
  termsAccepted: boolean;
}

export type ProfileFetchOutcome =
  /** An authoritative online answer — including "this user has no role". */
  | { status: 'ok'; profile: ProfileSnapshot }
  /** Transport/service failure — NOT an answer about the user's stance. */
  | { status: 'unavailable'; reason: string };

export type ResolvedProfile =
  | { source: 'network'; profile: ProfileSnapshot }
  | { source: 'cache'; profile: ProfileSnapshot }
  | { source: 'none' };

/**
 * Classify a PostgREST/Supabase `.single()` error. Only "the row does not
 * exist" is an authoritative statement about the user; everything else
 * (aborted fetch, timeout, DNS, 5xx, connection-refused, auth-refresh
 * network blips…) is 'unavailable'.
 */
export function classifyProfileFetchError(err: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
} | null | undefined): 'authoritative-missing' | 'unavailable' {
  if (!err) return 'unavailable';
  // PGRST116: JSON object requested, multiple (or no) rows returned — for a
  // PK-filtered single() this means the profile row does not exist.
  if (err.code === 'PGRST116') return 'authoritative-missing';
  return 'unavailable';
}

/**
 * Resolve what the gate should act on. Never mutates its inputs and never
 * writes anywhere — pure decision logic.
 */
export function resolveProfile(
  outcome: ProfileFetchOutcome,
  cached: ProfileSnapshot | null,
): ResolvedProfile {
  if (outcome.status === 'ok') {
    return { source: 'network', profile: outcome.profile };
  }
  // Unavailable: serve the last VALIDATED snapshot if one exists. A cached
  // snapshot without a role is useless for routing (the chooser would need
  // an authoritative basis anyway) — treat it as no cache.
  if (cached && cached.role != null) {
    return { source: 'cache', profile: cached };
  }
  return { source: 'none' };
}

/** Only authoritative, role-bearing snapshots are worth caching: the cache
 *  exists to keep an ONBOARDED user out of the chooser while offline. */
export function isCacheableProfile(outcome: ProfileFetchOutcome): outcome is {
  status: 'ok';
  profile: ProfileSnapshot;
} {
  return outcome.status === 'ok' && outcome.profile.role != null;
}
