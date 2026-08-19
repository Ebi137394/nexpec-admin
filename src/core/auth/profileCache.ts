// ─────────────────────────────────────────────────────────────────
//  src/core/auth/profileCache.ts — last-validated profile snapshot,
//  keyed per user (D38). Storage is injected so the logic is
//  node-testable; the default adapter is AsyncStorage.
//
//  Contents are the minimal routing surface only (organization id,
//  role, terms flag) — no PII beyond what every screen already holds.
//  The cache is written ONLY from an authoritative online fetch of a
//  role-bearing profile (see isCacheableProfile) and read ONLY when
//  the network cannot answer. Nothing here writes to the database.
// ─────────────────────────────────────────────────────────────────

import type { ProfileSnapshot } from './profileResolution';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY_PREFIX = 'nexpec.profile.v1.';

export function profileCacheKey(userId: string): string {
  return KEY_PREFIX + userId;
}

export async function readProfileCache(
  storage: KeyValueStorage,
  userId: string,
): Promise<ProfileSnapshot | null> {
  try {
    const raw = await storage.getItem(profileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProfileSnapshot>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      organizationId: parsed.organizationId ?? null,
      role: typeof parsed.role === 'string' ? parsed.role : null,
      termsAccepted: parsed.termsAccepted === true,
    };
  } catch {
    return null; // malformed cache is the same as no cache
  }
}

export async function writeProfileCache(
  storage: KeyValueStorage,
  userId: string,
  profile: ProfileSnapshot,
): Promise<void> {
  try {
    await storage.setItem(profileCacheKey(userId), JSON.stringify(profile));
  } catch {
    /* best-effort: a failed cache write only costs offline resilience */
  }
}
