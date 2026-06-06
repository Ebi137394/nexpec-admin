// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/layout.tsx — secure admin shell
//
//  Server Component. Trusts the middleware to have already gated this
//  layout (super_admin only), but re-checks the session here as defense in
//  depth — middleware bypass via cached static asset is a known vector.
//
//  Layout shape: persistent left sidebar + sticky header + scrollable main.
//  Designed for 1280px+ — mobile / tablet shows a single-column flow with
//  the sidebar hidden (drawer pattern lands in a later sprint).
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runWithRetry } from '@/lib/supabase/resilient';
import { Sidebar } from '@/components/admin/Sidebar';
import { Header } from '@/components/admin/Header';
import { NotificationToasterGate } from '@/components/notifications/NotificationToasterGate';

export const dynamic = 'force-dynamic';

const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  // Defence-in-depth. Middleware should already have redirected, but if a
  // request slips through (e.g. cache anomaly), bounce here too. The auth read
  // is retried on transient rejection; a persistent failure degrades to the
  // sign-in redirect rather than a 500 (a throw in a layout escapes to the
  // global error page — no child error.tsx can catch it).
  let user: Awaited<
    ReturnType<typeof supabase.auth.getUser>
  >['data']['user'] = null;
  try {
    const res = await runWithRetry(() => supabase.auth.getUser(), {
      label: 'admin-layout getUser',
    });
    user = res.data.user;
  } catch {
    /* persistent auth read failure — fall through to the sign-in redirect */
  }

  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/admin/dashboard'));
  }

  const userEmail = (user.email ?? '').toLowerCase();
  const isOwnerByEmail =
    userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

  // Profile read, retried on transient rejection. A persistent failure leaves
  // `profile` null; access then falls back to the owner-by-email allow-list.
  let profile: {
    role: string | null;
    full_name: string | null;
    email: string | null;
  } | null = null;
  try {
    const res = await runWithRetry(
      () =>
        supabase
          .from('profiles')
          .select('role, full_name, email')
          .eq('id', user!.id)
          .maybeSingle(),
      { label: 'admin-layout profile' },
    );
    profile =
      (res.data as {
        role: string | null;
        full_name: string | null;
        email: string | null;
      } | null) ?? null;
  } catch {
    /* persistent profile read failure — rely on isOwnerByEmail */
  }

  // Same defensive normalisation as the middleware — trim + lowercase so
  // whitespace or case drift in the DB doesn't lock the owner out.
  const normalisedRole = (profile?.role ?? '').toString().trim().toLowerCase();
  const isSuperAdmin = normalisedRole === 'super_admin' || normalisedRole === 'admin';

  if (!isSuperAdmin && !isOwnerByEmail) {
    redirect('/?error=forbidden');
  }

  const userLabel =
    profile?.full_name?.trim() ||
    profile?.email?.split('@')[0] ||
    user.email?.split('@')[0] ||
    'Operator';

  return (
    <div className="relative isolate flex min-h-screen bg-ink-950">
      {/* atmospheric layers — toned down vs. marketing */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-50 topo-grid"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-violet/10 blur-[100px]"
      />

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Doctrine fix: the Command Console is platform-wide. The Platform
          Owner operates here as the singular system authority, not as a
          tenant member. We INTENTIONALLY do NOT pass `memberships` —
          Header falls through to the inert "NEXPEC · Platform" chip,
          making the architectural boundary visually obvious.

          For tenant-scoped work (managing a specific org's structure,
          budget, approvals) the Platform Owner crosses into /client/* or
          /admin/orgs/[id]/* where org context is appropriate.
        */}
        <Header userLabel={userLabel} />
        <main className="flex-1 px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Live notification toaster (fixed bottom-right) */}
      <NotificationToasterGate />
    </div>
  );
}
