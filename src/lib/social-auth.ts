// ════════════════════════════════════════════════════════════════════════════
//  src/lib/social-auth.ts
//
//  Apple + Google sign-in for NEXPEC's Threshold auth.
//
//  Both providers are routed through Supabase OAuth (browser-based) for
//  v1 — no native modules required, works on iOS / Android / web.
//
//  Both flows end with:
//    1. A live Supabase session
//    2. A `needs_role` boolean — true when profile.role is null/empty,
//       signalling the caller to route the user to /(auth)/choose-role
//
//  CONFIG (Supabase Dashboard → Auth → Providers):
//    Google: enable, set OAuth client id + secret, add the redirect URL
//            Supabase shows you to the Google Cloud OAuth consent screen
//    Apple:  enable, configure the Services ID + Team ID + Key ID + .p8
//
//  FUTURE: when ready for App Store submission, install
//  `expo-apple-authentication` and swap `signInWithApple()` to use
//  `AppleAuthentication.signInAsync` + `supabase.auth.signInWithIdToken`.
//  Per Apple HIG that's required when other social providers are offered.
// ════════════════════════════════════════════════════════════════════════════

import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';

export interface SocialSignInResult {
  ok: boolean;
  needs_role: boolean;
  user_id?: string;
  error?: string;
}

async function checkNeedsRole(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  const role = (data?.role ?? '').toString().trim();
  return role.length === 0 ||
         ['none', 'pending', 'unknown'].includes(role.toLowerCase());
}

/**
 * Generic OAuth flow for any provider Supabase supports.
 *
 * supabase-js v2 defaults to the PKCE flow: the provider redirects back
 * with an authorization `code` in the URL *query string* (`?code=...`),
 * which we exchange for a session via `exchangeCodeForSession`. The old
 * implementation parsed `access_token`/`refresh_token` from the URL `#`
 * fragment — that's the implicit flow and never fires under PKCE, so it
 * always failed with "Missing tokens in OAuth callback."
 *
 * The browser opens, the user authenticates, control returns to the
 * `oauth-callback` deep link, we pull the `code` and exchange it.
 */
async function oauthFlow(
  provider: 'apple' | 'google' | 'linkedin_oidc',
): Promise<SocialSignInResult> {
  try {
    // NOTE: route-group parens are NOT part of the URL. expo-router resolves
    // `/oauth-callback` to app/(auth)/oauth-callback.tsx, so the redirect
    // target — and the URL we register with each provider / Supabase — must
    // be the bare `oauth-callback` path.
    const redirectTo = Linking.createURL('oauth-callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return { ok: false, needs_role: false, error: error?.message ?? 'OAuth init failed.' };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      // dismiss / cancel / locked — user backed out. Not an error to surface.
      return { ok: false, needs_role: false, error: 'cancelled' };
    }

    // PKCE: the authorization code comes back in the query string.
    const returnUrl = new URL(result.url);
    const code = returnUrl.searchParams.get('code');
    if (!code) {
      // No code → the provider/Supabase sent back ?error=...&error_description=...
      // Provider-side consent cancels (Google: access_denied, Apple:
      // user_cancelled_authorize) arrive this way rather than as a browser
      // dismiss — treat them like a cancel; surface everything else verbatim.
      const errCode = returnUrl.searchParams.get('error');
      const errDesc = returnUrl.searchParams.get('error_description');
      if (errCode === 'access_denied' || errCode === 'user_cancelled_authorize') {
        return { ok: false, needs_role: false, error: 'cancelled' };
      }
      return {
        ok: false,
        needs_role: false,
        error: errDesc || errCode || 'Missing authorization code in OAuth callback.',
      };
    }

    const { data: sessionData, error: exchangeErr } =
      await supabase.auth.exchangeCodeForSession(code);
    let user = sessionData?.user ?? null;
    if (exchangeErr || !user) {
      // The code is single-use, and on Android the redirect BOTH resolves
      // openAuthSessionAsync AND deep-links expo-router into
      // app/(auth)/oauth-callback.tsx — whichever exchanges second fails.
      // If a session already exists, sign-in actually succeeded; don't
      // surface a spurious error over a live session.
      const { data: existing } = await supabase.auth.getSession();
      user = existing?.session?.user ?? null;
      if (!user) {
        return {
          ok: false,
          needs_role: false,
          error: exchangeErr?.message ?? 'Could not complete sign-in.',
        };
      }
    }

    // Funnel professional claims into our schema (fills profile blanks only;
    // never blocks sign-in). Same sink will serve CV-import enrichment later.
    if (provider === 'linkedin_oidc') {
      try {
        await supabase.rpc('hydrate_identity', {
          p_provider: 'linkedin_oidc',
          p_claims: (user.user_metadata ?? {}) as any,
        });
      } catch { /* enrichment is best-effort */ }
    }

    const needs_role = await checkNeedsRole(user.id);
    return { ok: true, needs_role, user_id: user.id };
  } catch (e: any) {
    return { ok: false, needs_role: false, error: e?.message ?? `${provider} sign-in failed.` };
  }
}

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

/**
 * Apple is available wherever Supabase OAuth works (iOS / Android / web).
 * Switch to a native check when you install expo-apple-authentication.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  return true;
}

export async function signInWithApple(): Promise<SocialSignInResult> {
  return oauthFlow('apple');
}

export async function signInWithGoogle(): Promise<SocialSignInResult> {
  return oauthFlow('google');
}

/**
 * LinkedIn (OIDC) — captures professional identity. After the session is set we
 * call hydrate_identity() to funnel name/avatar (and any granted claims) into
 * the profile. Enable the provider in Supabase Dashboard → Auth → Providers.
 */
export async function signInWithLinkedIn(): Promise<SocialSignInResult> {
  return oauthFlow('linkedin_oidc');
}

/**
 * Returns the next route the caller should push to after a social
 * sign-in result, or null if the AuthGate should handle routing.
 */
export function postAuthRoute(result: SocialSignInResult): string | null {
  if (!result.ok) return null;
  if (result.needs_role) return '/(auth)/choose-role';
  return null;
}
