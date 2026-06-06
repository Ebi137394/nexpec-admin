// ════════════════════════════════════════════════════════════════════════════
//  app/client/layout.tsx — Client portal shell
//
//  Mirrors app/admin/layout.tsx. Middleware enforces role on the way in;
//  we re-check here as defence-in-depth (cache anomalies / middleware
//  bypass). Allowed roles: client + admin + super_admin.
//
//  Visual treatment identical to the admin shell: dark canvas, atmospheric
//  topo-grid + violet bloom, sticky Header (reused from components/admin/
//  since it's role-agnostic), and the Client-specific Sidebar on the left.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runWithRetry } from '@/lib/supabase/resilient';
import { Sidebar } from '@/components/client/Sidebar';
import { Header } from '@/components/admin/Header';
import { NotificationToasterGate } from '@/components/notifications/NotificationToasterGate';
import { fetchActiveOrgInfo } from '@/lib/data/orgStructure';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set([
  'client',
  'agency',
  'enterprise',
  'admin',
  'super_admin',
]);

const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  // Auth read, retried on transient rejection. A persistent failure degrades
  // to "unauthenticated" (the sign-in redirect below) rather than a 500 — a
  // throw here escapes to the global error page because no child error.tsx can
  // catch a parent layout's render.
  let user: Awaited<
    ReturnType<typeof supabase.auth.getUser>
  >['data']['user'] = null;
  try {
    const res = await runWithRetry(() => supabase.auth.getUser(), {
      label: 'client-layout getUser',
    });
    user = res.data.user;
  } catch {
    /* persistent auth read failure — fall through to the sign-in redirect */
  }

  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/client/dashboard'));
  }

  const userEmail = (user.email ?? '').toLowerCase();
  const isOwnerByEmail =
    userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

  // Profile read, retried on transient rejection. A persistent failure leaves
  // `profile` null; access then falls back to the owner-by-email allow-list
  // below instead of 500-ing the shell.
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
      { label: 'client-layout profile' },
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

  const normalisedRole = (profile?.role ?? '').toString().trim().toLowerCase();

  if (!ALLOWED_ROLES.has(normalisedRole) && !isOwnerByEmail) {
    redirect('/?error=forbidden');
  }

  const userLabel =
    profile?.full_name?.trim() ||
    profile?.email?.split('@')[0] ||
    user.email?.split('@')[0] ||
    'Client';

  // Sprint 6 — workspace switcher data. Resolves the user's pinned org
  // (or elected fallback) plus the full memberships list in one round-trip.
  const { active: activeMembership, memberships } = await fetchActiveOrgInfo();

  return (
    <div className="relative isolate flex min-h-screen bg-ink-950">
      {/* Atmospheric layers — toned down vs. marketing. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-50 topo-grid"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-violet/10 blur-[100px]"
      />

      <Sidebar role={normalisedRole} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          userLabel={userLabel}
          memberships={memberships}
          activeMembership={activeMembership}
        />
        <main className="flex-1 px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Live notification toaster (fixed bottom-right) */}
      <NotificationToasterGate />
    </div>
  );
}
