// ════════════════════════════════════════════════════════════════════════════
//  app/admin/invoices/[id]/page.tsx — Admin invoice detail (full GR2 view)
//
//  Admin sees both client_amount_cents AND inspector_amount_cents.
//  Renders the admin actions panel (markPaid / void / adjudicate dispute).
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Building2,
  User,
  Briefcase,
  ShieldCheck,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Hourglass,
} from 'lucide-react';
import {
  fetchAdminInvoices,
  formatInvoiceCents,
  formatInvoiceDate,
} from '@/lib/data/invoices';
import {
  type InvoiceAdminView,
  type InvoiceStatus,
  INVOICE_STATUS_LABEL,
} from '@/lib/data/invoices.types';
import { AdminInvoiceActions } from '@/components/invoices/AdminInvoiceActions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const inv = await fetchSingleAdminInvoice(id);
  return { title: inv ? `Invoice · ${inv.invoiceNumber}` : 'Invoice' };
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchSingleAdminInvoice(id: string): Promise<InvoiceAdminView | null> {
  // Re-use the list fetcher with a synthetic limit-1 narrowing. Simpler than
  // a dedicated fetcher; keeps the projection rules in one place.
  const { invoices } = await fetchAdminInvoices({ limit: 200 });
  return invoices.find((i) => i.id === id) ?? null;
}

export default async function AdminInvoiceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const inv = await fetchSingleAdminInvoice(id);
  if (!inv) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/admin/invoices"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Invoices
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Command Console · Invoice
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {inv.invoiceNumber}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              {inv.jobTitle ?? '(untitled job)'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusPill status={inv.status} />
              <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                Issued {formatInvoiceDate(inv.issuedAt)}
              </span>
              {inv.dueDate && (
                <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                  · Due {formatInvoiceDate(inv.dueDate)}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-violet/30 bg-violet/[0.08] px-5 py-4 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
              Client total
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold text-white">
              {formatInvoiceCents(inv.totalCents, inv.currency)}
            </p>
            {inv.inspectorAmountCents > 0 && (
              <p className="mt-2 font-mono text-[11px] text-zinc-400">
                Inspector payout {formatInvoiceCents(inv.inspectorAmountCents, inv.currency)}
              </p>
            )}
            {inv.platformFeeCents > 0 && (
              <p className="font-mono text-[11px] text-cyan-glow">
                Platform fee {formatInvoiceCents(inv.platformFeeCents, inv.currency)}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Disputed banner */}
      {inv.status === 'disputed' && inv.disputeReason && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2} />
          <div>
            <p className="font-semibold">Client filed a dispute</p>
            <p className="mt-1 text-red-200/80">{inv.disputeReason}</p>
            {inv.disputedAt && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-industrial text-red-200/60">
                Filed {formatInvoiceDate(inv.disputedAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Parties */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PartyCard
          icon={<Building2 className="h-4 w-4" strokeWidth={1.75} />}
          label="Client (billed party)"
          name={inv.clientName}
          href={`/admin/users/${inv.clientId}`}
        />
        {inv.inspectorId && (
          <PartyCard
            icon={<User className="h-4 w-4" strokeWidth={1.75} />}
            label="Inspector (paid party)"
            name={inv.inspectorName ?? 'Unknown'}
            href={`/admin/users/${inv.inspectorId}`}
          />
        )}
      </section>

      {/* Line items */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
          <FileText className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
          Line items
        </h2>
        <div className="mt-5 divide-y divide-white/[0.04]">
          {inv.lineItems.length === 0 ? (
            <p className="text-sm text-zinc-500">No line items.</p>
          ) : (
            inv.lineItems.map((item, i) => (
              <div
                key={i}
                className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/70">
                    {item.kind.replace(/_/g, ' ')}
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">{item.description}</p>
                  {item.contract_id && (
                    <p className="mt-1 font-mono text-[10px] text-zinc-600">
                      Contract · {item.contract_id.slice(0, 8)}…
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-base font-semibold text-white">
                  {formatInvoiceCents(item.amount_cents, inv.currency)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Admin Actions */}
      <section className="rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
          <ShieldCheck className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
          Admin actions
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Mark paid, void, or adjudicate the dispute. Every action is
          audit-stamped and surfaces in <span className="font-mono text-cyan-glow">/admin/audit</span>.
        </p>
        <div className="mt-5">
          <AdminInvoiceActions invoiceId={inv.id} status={inv.status} />
        </div>

        {/* Audit footnote */}
        {(inv.approvedAt || inv.paidAt || inv.voidedAt) && (
          <div className="mt-6 space-y-1.5 border-t border-white/[0.06] pt-4 text-[11px] font-mono text-zinc-500">
            {inv.approvedAt && (
              <p>Approved · {formatInvoiceDate(inv.approvedAt)}</p>
            )}
            {inv.paidAt && (
              <p>
                Paid · {formatInvoiceDate(inv.paidAt)}
                {inv.paidReference ? ` · ref ${inv.paidReference}` : ''}
              </p>
            )}
            {inv.voidedAt && (
              <p>
                Voided · {formatInvoiceDate(inv.voidedAt)}
                {inv.voidedReason ? ` · "${inv.voidedReason}"` : ''}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Related job */}
      <Link
        href={`/admin/jobs?inspect=${encodeURIComponent(inv.jobId)}`}
        className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 transition-colors hover:border-violet/30 hover:bg-violet/[0.04]"
      >
        <Briefcase className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Related job
          </p>
          <p className="mt-0.5 truncate text-sm text-white">
            {inv.jobTitle ?? '(untitled job)'}
          </p>
        </div>
        <span className="font-mono text-[10px] text-zinc-500 group-hover:text-violet-glow">
          INSPECT →
        </span>
      </Link>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function PartyCard({
  icon,
  label,
  name,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 transition-colors hover:border-violet/30 hover:bg-violet/[0.04]"
    >
      <span className="text-violet-glow">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-white">{name}</p>
      </div>
      <span className="font-mono text-[10px] text-zinc-500 group-hover:text-violet-glow">
        OPEN →
      </span>
    </Link>
  );
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  const palette: Record<InvoiceStatus, string> = {
    pending_review: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    approved: 'border-violet/30 bg-violet/10 text-violet-glow',
    disputed: 'border-red-500/30 bg-red-500/10 text-red-300',
    paid: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    voided: 'border-white/10 bg-white/[0.04] text-zinc-400',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial ${palette[status]}`}
    >
      {INVOICE_STATUS_LABEL[status]}
    </span>
  );
}
