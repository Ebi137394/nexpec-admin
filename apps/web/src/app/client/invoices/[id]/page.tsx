// ════════════════════════════════════════════════════════════════════════════
//  app/client/invoices/[id]/page.tsx — Single invoice detail + approval flow
//
//  Server Component shell + client-side <InvoiceActionsPanel> for the
//  approve / dispute actions. RLS gates SELECT to client_id and admin.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Receipt,
  Calendar,
  Hourglass,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Briefcase,
  CircleDollarSign,
} from 'lucide-react';
import {
  fetchInvoiceById,
  formatInvoiceCents,
  formatInvoiceDate,
} from '@/lib/data/invoices';
import { type InvoiceStatus, INVOICE_STATUS_LABEL } from '@/lib/data/invoices.types';
import { InvoiceActionsPanel } from '@/components/invoices/InvoiceActionsPanel';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const inv = await fetchInvoiceById(id);
  return { title: inv ? `Invoice · ${inv.invoiceNumber}` : 'Invoice' };
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientInvoiceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const inv = await fetchInvoiceById(id);
  if (!inv) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/client/invoices"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Invoices
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Client Portal · Invoice
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
              Total due
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold text-white">
              {formatInvoiceCents(inv.totalCents, inv.currency)}
            </p>
          </div>
        </div>
      </header>

      {/* Status banners */}
      {inv.status === 'disputed' && inv.disputeReason && (
        <Banner tone="red" icon={<AlertTriangle className="h-5 w-5" />}>
          <strong className="block font-semibold">In dispute</strong>
          <span className="mt-1 block text-red-200/80">{inv.disputeReason}</span>
        </Banner>
      )}
      {inv.status === 'approved' && inv.approvedAt && (
        <Banner tone="violet" icon={<CheckCircle2 className="h-5 w-5" />}>
          Approved on {formatInvoiceDate(inv.approvedAt)} · awaiting payment processing.
        </Banner>
      )}
      {inv.status === 'paid' && inv.paidAt && (
        <Banner tone="green" icon={<CheckCircle2 className="h-5 w-5" />}>
          Paid on {formatInvoiceDate(inv.paidAt)}. Thank you.
        </Banner>
      )}
      {inv.status === 'voided' && (
        <Banner tone="zinc" icon={<XCircle className="h-5 w-5" />}>
          This invoice has been voided. No payment due.
        </Banner>
      )}

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

        {/* Totals */}
        <div className="mt-6 space-y-2 border-t border-white/[0.06] pt-5 text-sm">
          <Row label="Subtotal" value={formatInvoiceCents(inv.clientAmountCents, inv.currency)} />
          {inv.platformFeeCents > 0 && (
            <Row
              label="Platform fee"
              value={formatInvoiceCents(inv.platformFeeCents, inv.currency)}
            />
          )}
          <Row
            label="Total"
            value={formatInvoiceCents(inv.totalCents, inv.currency)}
            bold
          />
        </div>
      </section>

      {/* Actions */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
          <CircleDollarSign className="h-4 w-4 text-cyan-glow" strokeWidth={1.75} />
          Your action
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Approve to release the invoice into the payment queue. Dispute if
          anything looks wrong — admin will adjudicate.
        </p>
        <div className="mt-5">
          <InvoiceActionsPanel invoiceId={inv.id} status={inv.status} />
        </div>
      </section>

      {/* Job reference */}
      <Link
        href={`/client/jobs/${inv.jobId}`}
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
          OPEN →
        </span>
      </Link>

      <p className="text-[10px] font-mono uppercase tracking-industrial text-zinc-600">
        Source · public.invoices · auto-issued by tg_auto_issue_invoice_on_contract_executed
      </p>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'text-white font-semibold' : 'text-zinc-400'}>{label}</span>
      <span
        className={`font-mono ${bold ? 'text-white text-base font-bold' : 'text-zinc-200'}`}
      >
        {value}
      </span>
    </div>
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

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'green' | 'red' | 'violet' | 'zinc';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls = {
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    red: 'border-red-500/30 bg-red-500/10 text-red-100',
    violet: 'border-violet/30 bg-violet/10 text-violet-glow',
    zinc: 'border-white/10 bg-white/[0.03] text-zinc-300',
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
