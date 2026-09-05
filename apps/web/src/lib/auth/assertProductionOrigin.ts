// ════════════════════════════════════════════════════════════════════════════
//  Never send a production user to a development host.
//
//  The 2026-09-05 P0: Supabase Production Site URL was still the stock
//  http://127.0.0.1:3000 and no nexpecapp.com entry was on the redirect
//  allowlist, so Supabase discarded the correct `redirectTo` and bounced a
//  real user to 127.0.0.1:3000/?code=... . Config is now correct, but config
//  can drift again, so the application refuses to participate.
// ════════════════════════════════════════════════════════════════════════════
const DEV_HOST =
  /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)|^exp:\/\//i;

export function isDevAuthOrigin(origin: string): boolean {
  return DEV_HOST.test((origin ?? '').trim());
}

/**
 * Throws in production when an auth redirect would resolve to a dev host.
 * Outside production the dev origin is legitimate and passes through.
 */
export function assertProductionAuthOrigin(
  origin: string,
  env: { VERCEL_ENV?: string; NODE_ENV?: string } = process.env,
): string {
  const isProd = env.VERCEL_ENV === 'production' ||
    (!env.VERCEL_ENV && env.NODE_ENV === 'production');
  if (isProd && isDevAuthOrigin(origin)) {
    // No secrets: only the offending origin, which is not sensitive.
    throw new Error(
      `Refusing to start OAuth: production auth origin resolved to a development host (${origin}). ` +
        'Check NEXT_PUBLIC_SITE_URL and the Supabase Site URL / redirect allowlist.',
    );
  }
  return origin;
}
