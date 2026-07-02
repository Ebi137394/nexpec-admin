// src/lib/supabase.ts
//
// ⚠️ SINGLE-CLIENT RULE: this module must NOT create its own Supabase client.
// It previously ran a second createClient() against the same AsyncStorage key
// as src/core/supabase/supabase.ts — two GoTrue instances then raced the same
// refresh-token family ("Invalid Refresh Token: Already Used" → sporadic forced
// logouts) and auth events never crossed instances. It now re-exports the one
// canonical client from src/core/supabase/supabase.ts.

import { supabase } from "../core/supabase/supabase";

export { supabase };

// ✅ Readiness guard (kept for existing callers)
export async function supabaseReady(): Promise<void> {
  // Wait for the URL polyfill to be ready
  await new Promise(resolve => {
    if (typeof URL !== 'undefined' && URL.prototype.origin) {
      resolve(undefined);
    } else {
      // Fallback: wait a bit more for polyfill to load
      setTimeout(resolve, 100);
    }
  });
}

/**
 * Subscribe to real-time table changes, scoped by organization_id.
 * Returns an unsubscribe function for useEffect cleanup.
 */
export function subscribeToTable(
  table: string,
  organizationId: string,
  callback: (payload: any) => void
) {
  const channel = supabase
    .channel(`${table}_${organizationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `organization_id=eq.${organizationId}`,
      },
      callback
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
