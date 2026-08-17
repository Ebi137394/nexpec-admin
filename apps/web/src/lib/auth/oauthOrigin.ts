// ════════════════════════════════════════════════════════════════════════════
//  lib/auth/oauthOrigin.ts — where an OAuth provider should send the user back.
//
//  D27: the old precedence put NEXT_PUBLIC_SITE_URL first unconditionally. That
//  variable holds the PRODUCTION domain (www.nexpecapp.com) and is set for all
//  Vercel environments, so a PREVIEW deployment built its `redirectTo` as
//  https://www.nexpecapp.com/auth/callback — an OAuth sign-in started on a
//  Preview would land the user on production. Verified live: the Staging
//  authorize URL carried redirect_to=https://www.nexpecapp.com/auth/callback.
//
//  Correct precedence:
//    • preview deployments  → their own VERCEL_URL (each Preview's real host)
//    • production           → NEXT_PUBLIC_SITE_URL (the canonical domain —
//                             production must NOT use VERCEL_URL, which is the
//                             raw deployment host, not the branded domain)
//    • local dev            → localhost
//
//  Plain module (not 'use server') so it stays unit-testable.
// ════════════════════════════════════════════════════════════════════════════

export interface OAuthOriginEnv {
  VERCEL_ENV?: string; // 'production' | 'preview' | 'development' | undefined
  VERCEL_URL?: string; // host only, no protocol
  NEXT_PUBLIC_SITE_URL?: string;
}

export function resolveOAuthOrigin(env: OAuthOriginEnv): string {
  const vercelUrl = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null;
  if (env.VERCEL_ENV === 'preview' && vercelUrl) return vercelUrl;
  return env.NEXT_PUBLIC_SITE_URL ?? vercelUrl ?? 'http://localhost:3000';
}
