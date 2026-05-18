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
import { Sidebar } from '@/components/client/Sidebar';
import { Header } from '@/components/admin/Header';
import { NotificationToasterGate } from '@/components/notifications/NotificationToasterGate';

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/client/dashboard'));
  }

  const userEmail = (user.email ?? '').toLowerCase();
  const isOwnerByEmail =
    userEmail.length > 0 && OWNER_EMAILS.includes(userEmail);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  const normalisedRole = (profile?.role ?? '').toString().trim().toLowerCase();

  if (!ALLOWED_ROLES.has(normalisedRole) && !isOwnerByEmail) {
    redirect('/?error=forbidden');
  }

  const userLabel =
    profile?.full_name?.trim() ||
    profile?.email?.split('@')[0] ||
    user.email?.split('@')[0] ||
    'Client';

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
