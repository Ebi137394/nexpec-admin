// ════════════════════════════════════════════════════════════════════════════
//  lib/supabase/browser.ts — browser-side Supabase client
//
//  Used by Client Components that need realtime, file uploads, or any
//  direct supabase call. Cookies are shared with the server client via
//  @supabase/ssr's cookie adapter, so a sign-in in a Server Action is
//  immediately reflected in a Client Component on the same page.
// ════════════════════════════════════════════════════════════════════════════

import { createBrowserClient } from '@supabase/ssr';

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing in the client bundle.',
    );
  }

  _client = createBrowserClient(url, anonKey);
  return _client;
}
