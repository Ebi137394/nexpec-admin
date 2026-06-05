// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/contracts/page.tsx — the supplier's Agreements hub.
//
//  Lists every NEXPEC Supplier Agreement addressed to this supplier (RLS scopes
//  to supplier_id = auth.uid()). Agreements awaiting THEIR signature float to
//  the top; executed ones drop into the sealed archive below.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  FileSignature,
  ShieldCheck,
  Clock,
  ArrowRight,
  PenLine,
} from 'lucide-react';
import {
  fetchMySupplierContracts,
  type SupplierContractRow,
  type SupplierContractStatus,
} from '@/lib/data/supplierContracts';

export const metadata: Metadata = { title: 'Supplier · Agreements' };
export const dynamic = 'force-dynamic';

function fmtCents(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}

const STATUS_META: Record<
  SupplierContractStatus,
  { label: string; cls: string }
> = {
  draft: { label: 'Draft', cls: 'bg-white/10 text-zinc-300' },
  pending_supplier_signature: {
    label: 'Action needed · Sign',
    cls: 'bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40',
  },
  pending_admin_countersignature: {
    label: 'Awaiting NEXPEC',
    cls: 'bg-accent-amber/15 text-accent-amber',
  },
  executed: { label: 'Executed', cls: 'bg-accent-green/15 text-accent-green' },
  voided: { label: 'Voided', cls: 'bg-accent-red/15 text-accent-red' },
};

export default async function SupplierContractsPage() {
  const contracts = await fetchMySupplierContracts();
  const actionNeeded = contracts.filter(
    (c) => c.status === 'pending_supplier_signature',
  );
  const inFlight = contracts.filter(
    (c) =>
      c.status === 'pending_admin_countersignature' || c.status === 'draft',
  );
  const executed = contracts.filter((c) => c.status === 'executed');

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-industrial text-violet-glow/80">
          Supplier Portal · Legal
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Agreements
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Your NEXPEC supplier agreements. When you win a bid, NEXPEC issues a
          formal agreement here — e-sign it and we counter-sign to execute. A
          signed, executed agreement is required before any funds are released.
        </p>
      </header>

      {contracts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">
            <FileSignature size={22} className="text-violet-glow" />
          </div>
          <p className="mt-3 text-sm font-semibold text-white">
            No agreements yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            When your quote is awarded on an RFQ, NEXPEC issues a supplier
            agreement and it appears here ready to sign.
          </p>
          <Link
            href="/suppliers/bids"
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
          >
            View my bids <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <>
          {actionNeeded.length > 0 && (
            <section>
              <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
                <PenLine className="h-4 w-4" /> Awaiting your signature
              </h2>
              <ul className="space-y-3">
                {actionNeeded.map((c) => (
                  <ContractCard key={c.id} c={c} />
                ))}
              </ul>
            </section>
          )}
          {inFlight.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-industrial text-zinc-400">
                In progress
              </h2>
              <ul className="space-y-3">
                {inFlight.map((c) => (
                  <ContractCard key={c.id} c={c} />
                ))}
              </ul>
            </section>
          )}
          {executed.length > 0 && (
            <section>
              <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-zinc-400">
                <ShieldCheck className="h-4 w-4 text-accent-green" /> Executed
              </h2>
              <ul className="space-y-3">
                {executed.map((c) => (
                  <ContractCard key={c.id} c={c} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ContractCard({ c }: { c: SupplierContractRow }) {
  const meta = STATUS_META[c.status];
  return (
    <li>
      <Link
        href={`/suppliers/contracts/${c.id}`}
        className="group flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/30 hover:bg-white/[0.04] sm:p-5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/12 text-violet-glow">
          <FileSignature size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">
              {c.rfqTitle ?? 'Awarded agreement'}
            </p>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            Issued {new Date(c.createdAt).toLocaleDateString()}
            {c.executedAt
              ? ` · executed ${new Date(c.executedAt).toLocaleDateString()}`
              : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-base font-semibold text-white">
            {fmtCents(c.amountCents)}
          </p>
          <p className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
            <Clock className="h-3 w-3" /> awarded value
          </p>
        </div>
        <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-glow" />
      </Link>
    </li>
  );
}
