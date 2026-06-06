// ════════════════════════════════════════════════════════════════════════════
//  app/(marketplace)/layout.tsx — Marketplace shell (RFQ engine + Vendor Custody)
//
//  Mirrors the mobile allow-list: buyers (client/agency/enterprise), suppliers,
//  and admins (god-mode) may enter; inspectors are sent home. Server-side gate
//  = defence-in-depth (RLS is the real enforcement). Hosts /rfqs + /directory;
//  the Supplier portal owns /suppliers/* under its own sidebar layout.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Store, FileText, LayoutDashboard, ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runWithRetry } from '@/lib/supabase/resilient';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['client', 'agency', 'enterprise', 'supplier', 'admin', 'super_admin']);

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();

  // Auth + role reads retried on transient rejection — a throw in a layout
  // bypasses every child error.tsx and 500s the whole shell. Persistent
  // failures degrade to a redirect rather than a crash.
  let user: Awaited<
    ReturnType<typeof supabase.auth.getUser>
  >['data']['user'] = null;
  try {
    const res = await runWithRetry(() => supabase.auth.getUser(), {
      label: 'marketplace-layout getUser',
    });
    user = res.data.user;
  } catch {
    /* persistent auth read failure — fall through to the sign-in redirect */
  }
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/rfqs'));

  let role = '';
  try {
    const res = await runWithRetry(
      () =>
        supabase
          .from('profiles')
          .select('role')
          .eq('id', user!.id)
          .maybeSingle(),
      { label: 'marketplace-layout profile' },
    );
    role = ((res.data?.role as string | null) ?? '')
      .toString()
      .trim()
      .toLowerCase();
  } catch {
    /* persistent profile read failure — treated as no-role below */
  }
  if (!ALLOWED.has(role)) redirect('/');

  // Role-aware route back into the user's own portal — so the marketplace shell
  // is never a dead-end.
  const dashboardHref =
    role === 'supplier'
      ? '/suppliers/dashboard'
      : role === 'admin' || role === 'super_admin'
        ? '/admin/dashboard'
        : '/client/dashboard';

  return (
    <div className="min-h-screen bg-ink-950 bg-radial-violet text-white">
      <header className="sticky top-0 z-20 border-b border-ink-600/70 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/rfqs" className="text-sm font-extrabold tracking-tight">
            NE<span className="text-cyan">X</span>PEC <span className="text-white/50 font-semibold">Marketplace</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href={dashboardHref} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white">
              <LayoutDashboard size={15} /> Dashboard
            </Link>
            <Link href="/rfqs" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white">
              <FileText size={15} /> RFQs
            </Link>
            <Link href="/directory" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white">
              <Store size={15} /> Suppliers
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Persistent return path into the user's own portal, the marketplace
            shell is a separate layout, so without this the section is a dead-end. */}
        <Link
          href={dashboardHref}
          className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-semibold text-white/80 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={15} /> Back to dashboard
        </Link>
        {children}
      </main>
    </div>
  );
}
