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
  // request slips through (e.g. cache anomaly), bounce here too.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/admin/dashboard'));
  }

  const userEmail = (user.email ?? '').toLowerCase();
  const isOwnerByEmail =
    userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  // Same defensive normalisation as the middleware — trim + lowercase so
  // whitespace or case drift in the DB doesn't lock the owner out.
  const normalisedRole = (profile?.role ?? '').toString().trim().toLowerCase();
  const isSuperAdmin = normalisedRole === 'super_admin';

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
