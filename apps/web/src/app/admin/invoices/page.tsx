// ════════════════════════════════════════════════════════════════════════════
//  app/admin/invoices/page.tsx — Admin-side invoice queue
//
//  Platform-wide view via fetchAdminInvoices. Same component pattern as
//  the client list but with extra columns (client name, inspector name,
//  inspector payout) and admin-only actions on the detail page.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ChevronRight,
  Receipt,
  Hourglass,
  AlertTriangle,
  FileText,
  Calendar,
  Building2,
  User,
  ShieldCheck,
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

export const metadata: Metadata = {
  title: 'Invoices, Platform-wide',
  description:
    'Admin invoice queue, review disputes, mark paid, void erroneous issues. Platform-wide visibility.',
};

export const dynamic = 'force-dynamic';

type FilterKey = 'all' | InvoiceStatus;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'pending_review', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'paid', label: 'Paid' },
  { key: 'voided', label: 'Voided' },
];

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

function isFilterKey(v: string | undefined): v is FilterKey {
  return v === 'all' || v === 'pending_review' || v === 'approved' || v === 'disputed' || v === 'paid' || v === 'voided';
}

export default async function AdminInvoicesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter: FilterKey = isFilterKey(sp.status) ? sp.status : 'all';

  const { invoices, counts } = await fetchAdminInvoices({
    status: filter === 'all' ? undefined : filter,
    limit: 200,
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console, Finance
        </p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Invoices
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              Platform-wide invoice queue. Disputes mediated here. Approved
              invoices move to <span className="font-mono text-cyan-glow">paid</span>{' '}
              once payment clears. Auto-issued by{' '}
              <span className="font-mono text-cyan-glow">tg_auto_issue_invoice_on_contract_executed</span>.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold uppercase tracking-industrial text-amber-300 sm:self-end">
            <Hourglass className="h-3.5 w-3.5" strokeWidth={2} />
            Outstanding, {formatInvoiceCents(counts.outstandingCents)}
          </span>
        </div>
      </header>

      {/* Aggregate strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total" value={counts.total.toLocaleString()} />
        <Stat
          label="Disputed"
          value={counts.disputed.toLocaleString()}
          tone={counts.disputed > 0 ? 'red' : 'default'}
        />
        <Stat
          label="Pending"
          value={counts.pendingReview.toLocaleString()}
          tone={counts.pendingReview > 0 ? 'amber' : 'default'}
        />
        <Stat label="Approved" value={counts.approved.toLocaleString()} tone="violet" />
        <Stat label="Paid" value={counts.paid.toLocaleString()} tone="green" />
      </section>

      {/* Filter tabs */}
      <nav className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-1.5">
        {FILTERS.map((tab) => {
          const active = filter === tab.key;
          return (
            <Link
              key={tab.key}
              href={tab.key === 'all' ? '/admin/invoices' : `/admin/invoices?status=${tab.key}`}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* List */}
      <section className="space-y-3">
        {invoices.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-400">
              No {filter === 'all' ? '' : `${INVOICE_STATUS_LABEL[filter as InvoiceStatus].toLowerCase()} `}invoices.
            </p>
          </div>
        ) : (
          invoices.map((inv) => <AdminInvoiceRow key={inv.id} inv={inv} />)
        )}
      </section>

      <p className="text-[10px] font-mono uppercase tracking-industrial text-zinc-600">
        Source, public.invoices, admin RLS, ADMIN_INVOICE_FIELDS projection
      </p>
    </div>
  );
}

function AdminInvoiceRow({ inv }: { inv: InvoiceAdminView }) {
  return (
    <Link
      href={`/admin/invoices/${inv.id}`}
      className="group block rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 transition-colors hover:border-violet/30 hover:bg-violet/[0.04]"
    >
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <Receipt className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] text-zinc-500">{inv.invoiceNumber}</p>
            <StatusPill status={inv.status} />
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {inv.jobTitle ?? '(untitled job)'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" strokeWidth={1.75} />
              {inv.clientName}
            </span>
            {inv.inspectorName && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" strokeWidth={1.75} />
                {inv.inspectorName}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" strokeWidth={1.75} />
              Issued {formatInvoiceDate(inv.issuedAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-lg font-bold text-white">
            {formatInvoiceCents(inv.totalCents, inv.currency)}
          </span>
          {inv.inspectorAmountCents > 0 && (
            <span className="font-mono text-[10px] text-zinc-500">
              Inspector {formatInvoiceCents(inv.inspectorAmountCents, inv.currency)}
            </span>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 self-center text-zinc-600 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
      </div>
      {inv.status === 'disputed' && inv.disputeReason && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="line-clamp-2">{inv.disputeReason}</span>
        </div>
      )}
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${palette[status]}`}
    >
      {INVOICE_STATUS_LABEL[status]}
    </span>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'violet' | 'green' | 'amber' | 'red';
}) {
  const cls =
    tone === 'violet' ? 'text-violet-glow'
      : tone === 'green' ? 'text-accent-green'
      : tone === 'amber' ? 'text-accent-amber'
      : tone === 'red' ? 'text-accent-red'
      : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
