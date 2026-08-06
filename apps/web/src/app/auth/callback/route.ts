// ════════════════════════════════════════════════════════════════════════════
//  app/auth/callback/route.ts — OAuth + email-confirm landing
//
//  Supabase redirects back here after Google / Apple / email-link auth.
//  We exchange the `code` for a session, apply the onboarding cookie
//  (if any), then bounce the user to a role-aware destination.
//
//  Critical: this route is the *only* place the OAuth-signup role is
//  applied to profiles.role. If applyOnboardingCookieToProfile returns
//  an error, we surface it in the redirect (visible at the destination
//  page) instead of silently landing the user in the wrong portal.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyOnboardingCookieToProfile } from '@/lib/auth/onboardingActions';

/**
 * Map a profile.role to its portal landing path. Mirrors
 * destinationForUser() in lib/auth/actions.ts.
 */
function pathForRole(role: string | null | undefined): string {
  const r = (role ?? '').toString().trim().toLowerCase();
  if (r === 'super_admin' || r === 'admin') return '/admin/dashboard';
  if (r === 'inspector') return '/inspector/dashboard';
  if (r === 'client' || r === 'agency' || r === 'enterprise') {
    return '/client/dashboard';
  }
  // #QA(2026-08-06) — 'supplier' was missing here even though the onboarding
  // wizard offers the Vendor pathway and apply_onboarding_role accepts it
  // (migration 20260801256000). destinationForUser() in lib/auth/actions.ts and
  // the middleware post-sign-in bounce both route suppliers to
  // /suppliers/dashboard; this function had drifted, so a vendor who signed up
  // or signed in through Google/Apple/magic-link landed on the marketing root
  // with no route into their portal.
  if (r === 'supplier') return '/suppliers/dashboard';
  return '/';
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (!code) {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('error', 'Missing OAuth code.');
    return NextResponse.redirect(url);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('error', error.message);
    return NextResponse.redirect(url);
  }

  // If the user just came through the multi-step onboarding wizard, the
  // role + profile metadata is in the nx_onboard cookie. Apply it via
  // the SECURITY DEFINER apply_onboarding_role RPC — a plain UPDATE
  // gets silently filtered out by the column-level RLS lockdown on
  // profiles.role, which is why the legacy implementation lost the role
  // on every OAuth signup.
  const { appliedRole, error: applyError } =
    await applyOnboardingCookieToProfile();

  // ── Destination resolution ──────────────────────────────────────────
  // Precedence:
  //   1. explicit ?next= (whitelisted to /...)
  //   2. role returned by apply_onboarding_role (most authoritative —
  //      it's the value just written, no replica race)
  //   3. fresh profiles.role read (covers users who didn't come through
  //      the wizard — pure sign-in OAuth)
  //   4. marketing root as last resort
  let dest = '/';
  if (next && next.startsWith('/')) {
    dest = next;
  } else if (appliedRole) {
    dest = pathForRole(appliedRole);
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      const role = ((profile as { role?: string } | null)?.role ?? '').toLowerCase();
      dest = pathForRole(role);
    }
  }

  // If applyOnboardingCookieToProfile errored, surface it in the
  // destination URL so the landing page can show a banner. We still
  // navigate so the user isn't stuck — the role they have now (even if
  // wrong) is recoverable via an operator action.
  const url = new URL(dest, origin);
  if (applyError) {
    url.searchParams.set('error', `Onboarding role apply failed: ${applyError}`);
  }
  return NextResponse.redirect(url);
}
