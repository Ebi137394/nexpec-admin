// src/lib/supabase.ts

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Database } from "../types/database.types";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase environment variables. Check your .env file."
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// ✅ Add the readiness guard function
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
