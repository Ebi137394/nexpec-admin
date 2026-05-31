// ─────────────────────────────────────────────────────────────────
//  src/core/offline/auth.ts
//  #56 — The session-refresh seam for the drain loop.
//
//  When the drain loop classifies a failure as 'auth' (expired JWT), it asks
//  for a fresh session before retrying. This module is the default
//  implementation: it forces a Supabase token refresh and reports whether a
//  valid session now exists.
//
//  It is kept separate from sync.ts on purpose — sync.ts stays free of any
//  Supabase import so its retry/backoff/conflict logic can be unit-tested with
//  a fake refresher, while production wiring injects this real one.
// ─────────────────────────────────────────────────────────────────

import { supabase } from '@/src/core/supabase/supabase';

/**
 * Returns true iff, after the attempt, a usable session exists.
 *
 * supabase-js has `autoRefreshToken: true`, but that timer can be suspended
 * while the app is backgrounded or offline — exactly the window in which the
 * outbox accumulates work. Calling refreshSession() forces the exchange the
 * moment connectivity returns. Never throws: any failure (dead refresh token,
 * network still down) resolves to `false`, which the loop reads as "stay
 * paused, surface auth-expired" rather than "abandon the data".
 */
export async function refreshSupabaseSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) return false;
    return Boolean(data?.session?.access_token);
  } catch {
    return false;
  }
}
