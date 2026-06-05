// ════════════════════════════════════════════════════════════════════════════
//  app/admin/supplier-payouts/page.tsx — Supplier Releases (brokered payout
//  control center). Lists every awarded supplier contract with its
//  contracted / released / outstanding state. Releasing funds fires the
//  SECURITY DEFINER release_supplier_contract RPC, which credits the supplier's
//  wallet so they can withdraw via Stripe Connect.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { Banknote, AlertCircle, CheckCircle2, Store } from 'lucide-react';
import { fetchAwardedSupplierContracts } from '@/lib/data/supplierReleases';
import { SupplierReleaseRow } from '@/components/admin/SupplierReleaseRow';

export const metadata: Metadata = { title: 'Admin · Supplier Releases' };
export const dynamic = 'force-dynamic';

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface PageProps { searchParams?: Promise<{ error?: string; released?: string }>; }

export default async function SupplierReleasesPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const { contracts, totalOutstandingCents } = await fetchAwardedSupplierContracts();
  const outstanding = contracts.filter((c) => c.outstandingCents > 0);
  const settled = contracts.filter((c) => c.contractCents > 0 && c.outstandingCents <= 0);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-cyan-glow/90">Operations · Brokerage</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">Supplier Releases</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Release brokered funds to suppliers for awarded contracts. Each release credits the supplier&rsquo;s wallet and is
          recorded in an audit ledger — over-release is impossible. Suppliers withdraw released funds via Stripe Connect.
        </p>
      </header>

      {sp.error && (
        <div className="flex items-start gap-2 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{sp.error}</span>
        </div>
      )}
      {sp.released && (
        <div className="flex items-center gap-2 rounded-xl border border-accent-green/30 bg-accent-green/10 px-4 py-3 text-sm text-accent-green">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> Funds released — the supplier&rsquo;s wallet has been credited.
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<Banknote size={18} />} tone="text-accent-amber" value={usd(totalOutstandingCents)} label="Outstanding to release" />
        <Stat icon={<Store size={18} />} tone="text-cyan-glow" value={String(outstanding.length)} label="Contracts awaiting release" />
        <Stat icon={<CheckCircle2 size={18} />} tone="text-accent-green" value={String(settled.length)} label="Fully released" />
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><Store size={22} className="text-cyan-glow" /></div>
          <p className="mt-3 text-sm font-semibold text-white">No awarded supplier contracts yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">When you award a supplier&rsquo;s quote on an RFQ, the contract appears here ready for milestone releases.</p>
        </div>
      ) : (
        <>
          {outstanding.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-industrial text-zinc-400">Awaiting release</h2>
              <ul className="space-y-3">{outstanding.map((c) => <SupplierReleaseRow key={c.quoteId} c={c} />)}</ul>
            </section>
          )}
          {settled.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-industrial text-zinc-400">Fully released</h2>
              <ul className="space-y-3">{settled.map((c) => <SupplierReleaseRow key={c.quoteId} c={c} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ icon, tone, value, label }: { icon: React.ReactNode; tone: string; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] ${tone}`}>{icon}</span>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="text-sm text-zinc-400">{label}</p>
    </div>
  );
}
