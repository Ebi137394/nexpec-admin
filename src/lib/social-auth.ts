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
 * Generic OAuth flow for any provider Supabase supports. The browser
 * opens, the user authenticates with the provider, we receive the
 * tokens in the redirect URL fragment, and we hand them to Supabase
 * to materialize a session.
 */
async function oauthFlow(
  provider: 'apple' | 'google',
): Promise<SocialSignInResult> {
  try {
    const redirectTo = Linking.createURL('/(auth)/oauth-callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return { ok: false, needs_role: false, error: error?.message ?? 'OAuth init failed.' };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return { ok: false, needs_role: false, error: 'cancelled' };
    }

    // Tokens come back in the URL fragment.
    const url     = new URL(result.url);
    const params  = new URLSearchParams(url.hash.replace(/^#/, ''));
    const access  = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) {
      return { ok: false, needs_role: false, error: 'Missing tokens in OAuth callback.' };
    }

    const { data: sessionData, error: setErr } = await supabase.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    });
    if (setErr || !sessionData.user) {
      return { ok: false, needs_role: false, error: setErr?.message ?? 'Could not set session.' };
    }

    const needs_role = await checkNeedsRole(sessionData.user.id);
    return { ok: true, needs_role, user_id: sessionData.user.id };
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
 * Returns the next route the caller should push to after a social
 * sign-in result, or null if the AuthGate should handle routing.
 */
export function postAuthRoute(result: SocialSignInResult): string | null {
  if (!result.ok) return null;
  if (result.needs_role) return '/(auth)/choose-role';
  return null;
}
