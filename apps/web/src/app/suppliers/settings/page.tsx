// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/settings/page.tsx — account overview (read-only)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Store, FileCheck2, Wallet, MessageCircle, ShieldCheck, Mail, BadgeCheck, CircleDot, ArrowRight,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Supplier, Settings' };
export const dynamic = 'force-dynamic';

export default async function SupplierSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/suppliers/settings'));

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, role')
    .eq('id', user.id)
    .maybeSingle();

  const { data: vendor } = await supabase
    .from('supplier_profiles')
    .select('legal_name, is_active, verification')
    .eq('id', user.id)
    .maybeSingle();

  const verified = !!(vendor?.verification as { verified_at?: string } | null)?.verified_at;
  const listed = !!vendor;
  const active = vendor?.is_active ?? false;
  const email = profile?.email || user.email || '—';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">System</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Your account at a glance.</p>
      </header>

      {/* Account */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <h2 className="font-semibold text-white">Account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Row icon={<Store size={15} />} label="Company" value={vendor?.legal_name || profile?.full_name || 'Not listed yet'} />
          <Row icon={<Mail size={15} />} label="Email" value={email} />
          <Row icon={<BadgeCheck size={15} />} label="Account type" value="Supplier" />
          <Row
            icon={<ShieldCheck size={15} />}
            label="Verification"
            value={verified ? 'Verified vendor' : listed ? 'Pending review' : 'Not listed'}
            tone={verified ? 'text-accent-green' : 'text-accent-amber'}
          />
        </dl>
      </section>

      {/* Listing status */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white">Directory listing</h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {listed
                ? active
                  ? 'Your profile is live in the supplier directory and eligible for RFQ matching.'
                  : 'Your profile exists but is paused. Contact the team to reactivate.'
                : 'You haven’t created a vendor profile yet.'}
            </p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
            listed && active ? 'border-accent-green/30 bg-accent-green/10 text-accent-green' : 'border-white/10 bg-white/[0.03] text-zinc-400'
          }`}>
            <CircleDot size={13} /> {listed ? (active ? 'Active' : 'Paused') : 'Not listed'}
          </span>
        </div>
        <Link href="/suppliers/profile" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-glow hover:text-white">
          {listed ? 'Manage profile & capabilities' : 'Create your vendor profile'} <ArrowRight size={14} />
        </Link>
      </section>

      {/* Quick links */}
      <section className="grid gap-3 sm:grid-cols-2">
        <LinkCard href="/suppliers/documents" icon={<FileCheck2 size={18} />} title="Document Vault" body="Manage sealed certificates" />
        <LinkCard href="/suppliers/finance" icon={<Wallet size={18} />} title="Finance" body="Brokered payouts & ledger" />
        <LinkCard href="/suppliers/messages" icon={<MessageCircle size={18} />} title="Messages" body="Coordination Bridge with admin" />
        <LinkCard href="/suppliers/support" icon={<ShieldCheck size={18} />} title="Help & Support" body="Guides + contact the team" />
      </section>
    </div>
  );
}

function Row({ icon, label, value, tone = 'text-white' }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{icon} {label}</dt>
      <dd className={`mt-1 truncate text-sm font-medium ${tone}`}>{value}</dd>
    </div>
  );
}

function LinkCard({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/50 hover:bg-white/[0.04]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="truncate text-xs text-zinc-500">{body}</p>
      </div>
      <ArrowRight size={15} className="shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-glow" />
    </Link>
  );
}
