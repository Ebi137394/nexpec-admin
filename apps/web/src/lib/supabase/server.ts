// ════════════════════════════════════════════════════════════════════════════
//  lib/supabase/server.ts — server-side Supabase client (Next.js App Router)
//
//  Uses @supabase/ssr for cookie-bound sessions. This is the client used by
//  Server Components, Server Actions, Route Handlers, and middleware.
//
//  Pair with `createCore({ supabase })` from @nexpec/shared-core when you
//  want to use the shared RPC wrappers in server code.
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing. Check apps/web/.env.local.',
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `set` is unavailable in Server Components — silently ignore.
          // Middleware will handle cookie persistence.
        }
      },
    },
  });
}
