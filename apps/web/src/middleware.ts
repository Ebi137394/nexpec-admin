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
const CLIENT_PREFIX = '/client';
const INSPECTOR_PREFIX = '/inspector';
const SUPPLIERS_PREFIX = '/suppliers';
// /forgot-password and /reset-password are auth surfaces too. The recovery
// link's first load carries no session cookie (the browser client exchanges
// the code after hydration), so the signed-in bounce below doesn't break
// the reset flow.
const AUTH_ROUTES = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password'];

/**
 * Roles allowed to enter each portal shell. super_admin + admin can drop
 * into any portal for support; otherwise only the matching role passes.
 */
const PORTAL_ROLES: Record<string, ReadonlyArray<string>> = {
  [ADMIN_PREFIX]: ['super_admin', 'admin'],
  // Client Portal is shared by three roles. UI is identical — the only
  // separation that matters is data ownership, already enforced by
  // client_id = auth.uid() and RLS on jobs.
  [CLIENT_PREFIX]: ['client', 'agency', 'enterprise', 'admin', 'super_admin'],
  [INSPECTOR_PREFIX]: ['inspector', 'admin', 'super_admin'],
  [SUPPLIERS_PREFIX]: ['supplier', 'admin', 'super_admin'],
};

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

const IS_PROD = process.env.NODE_ENV === 'production';
// Keys stripped from production logs — Vercel runtime logs must carry no PII.
const PII_LOG_KEYS = ['userEmail', 'userId'];

function logMiddleware(
  level: 'info' | 'warn' | 'error',
  msg: string,
  data: Record<string, unknown>,
) {
  // Visible in Vercel's runtime logs. Prefix lets us grep [middleware] in
  // the dashboard.
  //
  // Production policy (2026-07-18): verbose info-level gate traces are
  // dev-only, and warn/error lines are PII-redacted (no email, no user id).
  // Pathname, portal, role, and error codes remain — enough to diagnose a
  // gate denial without identifying the user.
  if (IS_PROD && level === 'info') return;
  const safe: Record<string, unknown> = { ...data };
  if (IS_PROD) for (const k of PII_LOG_KEYS) delete safe[k];
  const line = `[middleware] ${msg} ${JSON.stringify(safe)}`;
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
    error: authError,
  } = await supabase.auth.getUser();

  // ── Stale-session hygiene (2026-07-18) ────────────────────────────────
  //  A browser can keep auth cookies for a login the server has since
  //  revoked — the account-deletion flow BANS the auth user, so a lingering
  //  cookie makes every request retry a refresh that fails with an
  //  AuthApiError (visible as noise in Vercel logs). When the failure is a
  //  definitive API rejection (400/401/403 — invalid/revoked/banned), drop
  //  the sb-* auth cookies from the outgoing response so the browser stops
  //  resubmitting them. A plain "no session" (AuthSessionMissingError) has
  //  no status and is left alone.
  const authStatus = (authError as { status?: number } | null)?.status;
  const staleAuthCookies =
    !user &&
    typeof authStatus === 'number' &&
    [400, 401, 403].includes(authStatus)
      ? request.cookies
          .getAll()
          .filter((c) => c.name.startsWith('sb-'))
          .map((c) => c.name)
      : [];
  const withCookieHygiene = (res: NextResponse): NextResponse => {
    for (const name of staleAuthCookies) res.cookies.delete(name);
    return res;
  };

  const isAdminRoute =
    pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
  const isClientRoute =
    pathname === CLIENT_PREFIX || pathname.startsWith(`${CLIENT_PREFIX}/`);
  const isInspectorRoute =
    pathname === INSPECTOR_PREFIX ||
    pathname.startsWith(`${INSPECTOR_PREFIX}/`);
  const isSuppliersRoute =
    pathname === SUPPLIERS_PREFIX ||
    pathname.startsWith(`${SUPPLIERS_PREFIX}/`);
  const isPortalRoute =
    isAdminRoute || isClientRoute || isInspectorRoute || isSuppliersRoute;
  const portalPrefix = isAdminRoute
    ? ADMIN_PREFIX
    : isClientRoute
      ? CLIENT_PREFIX
      : isInspectorRoute
        ? INSPECTOR_PREFIX
        : isSuppliersRoute
          ? SUPPLIERS_PREFIX
          : null;
  const isAuthRoute = AUTH_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // 2. Portal gate (admin / client / inspector).
  if (isPortalRoute && portalPrefix) {
    if (!user) {
      logMiddleware('info', 'admin gate: no session, redirecting to /sign-in', {
        pathname,
      });
      const url = request.nextUrl.clone();
      url.pathname = '/sign-in';
      url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
      return withCookieHygiene(NextResponse.redirect(url));
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
    const allowedRoles = PORTAL_ROLES[portalPrefix] ?? [];
    const hasPortalAccess = allowedRoles.includes(normalisedRole);

    if (!hasPortalAccess) {
      logMiddleware('warn', 'portal gate: role check failed, redirecting', {
        pathname,
        portalPrefix,
        allowedRoles,
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

    logMiddleware('info', 'portal gate: passed', {
      pathname,
      portalPrefix,
      userId: user.id,
      userEmail,
      normalisedRole,
    });
  }

  // 3. Signed-in user hitting /sign-in or /sign-up → bounce home.
  //    Recovery routes (/forgot-password, /reset-password) are intentionally
  //    NOT bounced: they must stay reachable in ANY session state so the
  //    "Can't sign in?" recovery link (and stale-session recovery) lands on
  //    the public forgot-password page instead of redirecting inside the
  //    platform. The authenticated change-password flow lives on portal routes
  //    and is unaffected.
  const isRecoveryRoute =
    pathname === '/forgot-password' ||
    pathname.startsWith('/forgot-password/') ||
    pathname === '/reset-password' ||
    pathname.startsWith('/reset-password/');
  if (user && isAuthRoute && !isRecoveryRoute) {
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
      // Role-aware post-sign-in destination. Inspector / client land in
      // their respective portals; super_admin in /admin; everyone else
      // falls back to marketing root.
      if (normalisedRole === 'super_admin' || normalisedRole === 'admin') {
        dest = '/admin/dashboard';
      } else if (normalisedRole === 'inspector') {
        dest = '/inspector/dashboard';
      } else if (
        normalisedRole === 'client' ||
        normalisedRole === 'agency' ||
        normalisedRole === 'enterprise'
      ) {
        dest = '/client/dashboard';
      } else if (normalisedRole === 'supplier') {
        dest = '/suppliers/dashboard';
      }
    }

    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return withCookieHygiene(getResponse());
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
