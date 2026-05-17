// ════════════════════════════════════════════════════════════════════════════
//  src/middleware.ts — perimeter defence for the admin console
//
//  Runs on every request matching the `config.matcher` below. Three jobs:
//
//    1. Refresh the Supabase session cookie so it stays warm. This is the
//       Supabase-recommended pattern from @supabase/ssr docs.
//    2. Gate any request under /admin/* — must have a session AND
//       (`profile.role = 'super_admin'` OR email in OWNER_EMAILS env var).
//       Otherwise redirect to /sign-in (carrying the original URL as
//       ?next=...) or / (forbidden).
//    3. Bounce already-authenticated users away from /sign-in and /sign-up
//       to their role-aware home (admin or marketing root).
//
//  Defensive role check: the role string is trimmed + lower-cased before
//  comparison, profile-fetch errors are logged (not swallowed silently),
//  and a comma-separated OWNER_EMAILS allowlist provides a failsafe for
//  bootstrap / disaster-recovery scenarios where the profile row could be
//  unreadable but we still need to let the owner into the console.
//
//  We deliberately query the `profiles` table on every protected request.
//  That's one round trip per page. Future optimisation: move `role` into
//  the JWT app_metadata so middleware can read it without a DB hit.
//  Leaving the optimisation for later — correctness now, perf when needed.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseMiddlewareClient } from '@/lib/supabase/middleware';

const ADMIN_PREFIX = '/admin';
const AUTH_ROUTES = ['/sign-in', '/sign-up'];

/**
 * Comma-separated list of emails that always have super_admin access,
 * regardless of what the `profiles` table says. Configured in Vercel env
 * vars as `OWNER_EMAILS`. Intended as a failsafe — if a future migration
 * or RLS misconfig wipes/hides the owner's profile.role, this keeps the
 * console reachable so the operator can fix the data.
 */
const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function logMiddleware(
  level: 'info' | 'warn' | 'error',
  msg: string,
  data: Record<string, unknown>,
) {
  // Visible in Vercel's runtime logs. Prefix lets us grep [middleware] in
  // the dashboard.
  const line = `[middleware] ${msg} ${JSON.stringify(data)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const { supabase, getResponse } = createSupabaseMiddlewareClient(request);

  // 1. Refresh session cookie. This is what keeps users signed in across
  //    server-rendered navigations.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminRoute =
    pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
  const isAuthRoute = AUTH_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // 2. Admin gate.
  if (isAdminRoute) {
    if (!user) {
      logMiddleware('info', 'admin gate: no session, redirecting to /sign-in', {
        pathname,
      });
      const url = request.nextUrl.clone();
      url.pathname = '/sign-in';
      url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }

    const userEmail = (user.email ?? '').toLowerCase();
    const isOwnerByEmail =
      userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

    // Owner-email failsafe: skip the profile fetch entirely. If the DB
    // says the owner isn't super_admin, the env var still wins.
    if (isOwnerByEmail) {
      logMiddleware('info', 'admin gate: owner-email failsafe, allowing', {
        pathname,
        userId: user.id,
        userEmail,
      });
      return getResponse();
    }

    // Robust profile fetch — error captured, not swallowed.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      logMiddleware('error', 'admin gate: profile fetch failed', {
        pathname,
        userId: user.id,
        userEmail,
        error: profileError.message,
        code: profileError.code,
      });
      // Treat a fetch error as "deny" rather than "allow" — fail closed.
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '?error=forbidden&reason=profile_lookup_failed';
      return NextResponse.redirect(url);
    }

    // Normalise the role string so accidental whitespace or case drift
    // (e.g. `Super_Admin`, ` super_admin `) doesn't lock out the owner.
    const normalisedRole = (profile?.role ?? '').toString().trim().toLowerCase();
    const isSuperAdmin = normalisedRole === 'super_admin';

    if (!isSuperAdmin) {
      logMiddleware('warn', 'admin gate: role check failed, redirecting', {
        pathname,
        userId: user.id,
        userEmail,
        roleFromDb: profile?.role ?? null,
        normalisedRole,
        ownerEmailsConfigured: OWNER_EMAILS.length,
      });
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '?error=forbidden';
      return NextResponse.redirect(url);
    }

    logMiddleware('info', 'admin gate: passed', {
      pathname,
      userId: user.id,
      userEmail,
    });
  }

  // 3. Signed-in user hitting /sign-in or /sign-up → bounce home.
  if (user && isAuthRoute) {
    const userEmail = (user.email ?? '').toLowerCase();
    const isOwnerByEmail =
      userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

    let dest = '/';
    if (isOwnerByEmail) {
      dest = '/admin/dashboard';
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      const normalisedRole = (profile?.role ?? '')
        .toString()
        .trim()
        .toLowerCase();
      dest = normalisedRole === 'super_admin' ? '/admin/dashboard' : '/';
    }

    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return getResponse();
}

/**
 * Matcher excludes Next.js internals, static files, and most image
 * extensions so the middleware doesn't run unnecessarily.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif)$).*)',
  ],
};
