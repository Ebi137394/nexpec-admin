// ════════════════════════════════════════════════════════════════════════════
//  lib/supabase/middleware.ts — Supabase client factory for Next middleware
//
//  Middleware runs on the Edge runtime and needs a special cookie adapter
//  that writes to the OUTGOING response cookies (not the request). This
//  factory returns both the client and the response object so the caller
//  can short-circuit with redirects while still preserving cookie refresh.
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Shape of one cookie entry passed to setAll(). Mirrors @supabase/ssr's
 * internal type so we don't depend on a deep import. `options` is the
 * standard `cookie` package options used by Next.
 */
interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export function createSupabaseMiddlewareClient(request: NextRequest) {
  // The response is reassigned every time Supabase sets cookies. We return
  // the latest reference from the caller after auth checks.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      '[middleware] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing.',
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        // Mirror cookies onto the request so subsequent reads see them.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        // Rebuild the response with the updated request and re-apply the
        // cookies to the outgoing response.
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  return { supabase, getResponse: () => response };
}
