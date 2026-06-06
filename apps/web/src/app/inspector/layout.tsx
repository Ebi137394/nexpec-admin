// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/layout.tsx — Inspector portal shell
//
//  Sibling of app/client/layout.tsx and app/admin/layout.tsx. Same
//  defence-in-depth role check; allowed roles are inspector + admin +
//  super_admin. Reuses the role-agnostic Header from components/admin/.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runWithRetry } from '@/lib/supabase/resilient';
import { Sidebar } from '@/components/inspector/Sidebar';
import { Header } from '@/components/admin/Header';
import { NotificationToasterGate } from '@/components/notifications/NotificationToasterGate';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['inspector', 'admin', 'super_admin']);

const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function InspectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  // Auth + profile reads retried on transient rejection. A throw in a layout
  // escapes every child error.tsx and lands on the global 500 page, so degrade
  // gracefully instead: persistent auth failure -> sign-in; persistent profile
  // failure -> owner-by-email allow-list.
  let user: Awaited<
    ReturnType<typeof supabase.auth.getUser>
  >['data']['user'] = null;
  try {
    const res = await runWithRetry(() => supabase.auth.getUser(), {
      label: 'inspector-layout getUser',
    });
    user = res.data.user;
  } catch {
    /* persistent auth read failure — fall through to the sign-in redirect */
  }

  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/inspector/dashboard'));
  }

  const userEmail = (user.email ?? '').toLowerCase();
  const isOwnerByEmail =
    userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

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
      { label: 'inspector-layout profile' },
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
    'Inspector';

  return (
    <div className="relative isolate flex min-h-screen bg-ink-950">
      {/* Atmospheric layers — toned down vs. marketing. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-50 topo-grid"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 right-0 -z-10 h-[400px] w-[600px] rounded-full bg-cyan-glow/10 blur-[100px]"
      />

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header userLabel={userLabel} organizations={[]} />
        <main className="flex-1 px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Live notification toaster (fixed bottom-right) */}
      <NotificationToasterGate />
    </div>
  );
}
