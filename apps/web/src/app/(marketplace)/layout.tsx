// ════════════════════════════════════════════════════════════════════════════
//  app/(marketplace)/layout.tsx — Marketplace shell (RFQ engine + Vendor Custody)
//
//  Mirrors the mobile allow-list: buyers (client/agency/enterprise), suppliers,
//  and admins (god-mode) may enter; inspectors are sent home. Server-side gate
//  = defence-in-depth (RLS is the real enforcement). URLs stay /rfqs, /suppliers.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Store, FileText, LayoutDashboard } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['client', 'agency', 'enterprise', 'supplier', 'admin', 'super_admin']);

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/rfqs'));

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = (profile?.role ?? '').toString().trim().toLowerCase();
  if (!ALLOWED.has(role)) redirect('/');

  return (
    <div className="min-h-screen bg-ink-950 bg-radial-violet text-white">
      <header className="sticky top-0 z-20 border-b border-ink-600/70 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/rfqs" className="text-sm font-extrabold tracking-tight">
            NE<span className="text-cyan">X</span>PEC <span className="text-white/50 font-semibold">· Marketplace</span>
          </Link>
          <nav className="flex items-center gap-1">
            {role === 'supplier' && (
              <Link href="/suppliers/dashboard" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white">
                <LayoutDashboard size={15} /> Dashboard
              </Link>
            )}
            <Link href="/rfqs" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white">
              <FileText size={15} /> RFQs
            </Link>
            <Link href="/suppliers" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/5 hover:text-white">
              <Store size={15} /> Suppliers
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
