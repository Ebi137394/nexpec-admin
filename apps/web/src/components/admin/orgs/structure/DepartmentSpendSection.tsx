'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/DepartmentSpendSection.tsx
//
//  The "Spend" block inside DepartmentDetailPanel. Reads a
//  DepartmentSpendSummary (fetched by the parent via
//  getDepartmentSpendSummaryAction). Renders:
//
//    · Direct vs Roll-up tiles (committed + paid totals, predominant currency)
//    · MTD / QTD / YTD strip computed off the rollup slice
//    · Last 5 invoices, each row clickable through to the invoice page
//
//  Graceful empty + loading states for:
//    · summary === undefined          → "Loading…" skeleton
//    · summary === null               → "Spend unavailable" (RPC missing or
//                                        no permission)
//    · summary.rollup.invoice_count==0 → "No spend attributed yet" empty state
//
//  No JS computation beyond formatting — totals come straight off the RPC.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  Banknote,
  ArrowUpRight,
  CalendarRange,
  Receipt,
  Hash,
  CircleSlash,
} from 'lucide-react';

import type {
  DepartmentSpendSummary,
  RecentInvoiceRow,
} from '@/lib/data/orgStructure.budget.types';
import { cn } from '@/lib/cn';

interface Props {
  /**
   * undefined → still loading (parent kicked off useTransition).
   * null      → fetch attempted but unavailable (no perm / no invoices yet).
   * object    → render the real summary.
   */
  summary: DepartmentSpendSummary | null | undefined;
  /**
   * Which surface this is mounted on. Affects the invoice link path —
   * client viewers go to /client/invoices/[id]; admin viewers to
   * /admin/invoices/[id]. Default 'admin'.
   */
  surface?: 'admin' | 'client';
}

export function DepartmentSpendSection({ summary, surface = 'admin' }: Props) {
  return (
    <section className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-industrial text-zinc-300">
          <Banknote
            className="h-3.5 w-3.5 text-violet-glow"
            strokeWidth={1.75}
          />
          Spend
        </h3>
        {summary && summary.mixed_currencies && (
          <span
            className="rounded border border-amber-400/30 bg-amber-400/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-amber-200"
            title="This department spans multiple currencies; figures show the predominant one."
          >
            mixed currencies
          </span>
        )}
      </header>

      {summary === undefined && <LoadingState />}
      {summary === null && <UnavailableState />}
      {summary && summary.rollup.invoice_count === 0 && <NoSpendState />}

      {summary && summary.rollup.invoice_count > 0 && (
        <SpendBody summary={summary} surface={surface} />
      )}
    </section>
  );
}

/* ─── body ───────────────────────────────────────────────────────────── */

function SpendBody({
  summary,
  surface,
}: {
  summary: DepartmentSpendSummary;
  surface: 'admin' | 'client';
}) {
  // Sprint 7 — prefer the display projection. Native values come from
  // `summary.direct/rollup`; converted values are in `display_direct/rollup`.
  // When the conversion is unavailable we transparently fall back.
  const useDisplay =
    summary.display_currency &&
    summary.display_currency !== summary.currency &&
    !summary.display_rollup.rate_unavailable;

  const displayCcy = useDisplay ? summary.display_currency : summary.currency;
  const directSlice = useDisplay ? summary.display_direct : summary.direct;
  const rollupSlice = useDisplay ? summary.display_rollup : summary.rollup;
  const fmt = (cents: number) => formatMoney(cents, displayCcy);

  return (
    <>
      {/* Direct + Roll-up tiles */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tile
          label="Direct (this dept)"
          primaryValue={fmt(directSlice.all_time_committed_cents)}
          primaryLabel="committed"
          secondaryValue={fmt(directSlice.all_time_paid_cents)}
          secondaryLabel="paid"
          tone="neutral"
          meta={`${summary.direct.invoice_count} invoice${summary.direct.invoice_count === 1 ? '' : 's'}`}
        />
        <Tile
          label="Roll-up (incl. descendants)"
          primaryValue={fmt(rollupSlice.all_time_committed_cents)}
          primaryLabel="committed"
          secondaryValue={fmt(rollupSlice.all_time_paid_cents)}
          secondaryLabel="paid"
          tone="violet"
          meta={`${summary.rollup.invoice_count} invoice${summary.rollup.invoice_count === 1 ? '' : 's'}`}
        />
      </div>

      {/* Currency context line */}
      {useDisplay && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          Displayed in {displayCcy}, invoices natively in {summary.currency}
          {summary.mixed_currencies && ' + others'}
        </p>
      )}
      {summary.display_rollup.rate_unavailable && (
        <p className="mt-2 rounded-md border border-amber-400/25 bg-amber-400/[0.05] px-2 py-1 text-[10px] text-amber-200">
          FX rate path missing for {summary.currency} → {summary.display_currency},
          showing native amounts.
        </p>
      )}

      {/* MTD / QTD / YTD strip */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.04] pt-3">
        <WindowTile
          label="MTD"
          value={fmt(rollupSlice.mtd_committed_cents)}
        />
        <WindowTile
          label="QTD"
          value={fmt(rollupSlice.qtd_committed_cents)}
        />
        <WindowTile
          label="YTD"
          value={fmt(rollupSlice.ytd_committed_cents)}
        />
      </div>

      {/* Recent invoices */}
      {summary.recent_invoices.length > 0 && (
        <div className="mt-4 border-t border-white/[0.04] pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <Receipt className="h-3 w-3" strokeWidth={1.75} />
            Recent invoices
          </p>
          <ul className="space-y-1.5">
            {summary.recent_invoices.map((inv) => (
              <RecentInvoiceRowItem
                key={inv.invoice_id}
                invoice={inv}
                surface={surface}
              />
            ))}
          </ul>
          <Link
            href={surface === 'client' ? '/client/budget' : '/admin/budget'}
            className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80 hover:text-violet-glow"
          >
            See by-department breakdown
            <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>
      )}

      {summary.rollup.last_invoice_at && (
        <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
          <CalendarRange className="h-3 w-3" strokeWidth={1.75} />
          Last activity {formatRelative(summary.rollup.last_invoice_at)}
        </p>
      )}
    </>
  );
}

/* ─── tiles ──────────────────────────────────────────────────────────── */

function Tile({
  label,
  primaryValue,
  primaryLabel,
  secondaryValue,
  secondaryLabel,
  tone,
  meta,
}: {
  label: string;
  primaryValue: string;
  primaryLabel: string;
  secondaryValue: string;
  secondaryLabel: string;
  tone: 'neutral' | 'violet';
  meta?: string;
}) {
  const ring =
    tone === 'violet'
      ? 'ring-violet/30 bg-violet/[0.04]'
      : 'ring-white/[0.06] bg-white/[0.02]';
  return (
    <div className={cn('rounded-lg border border-white/[0.06] p-3 ring-1 ring-inset', ring)}>
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-medium text-white">
        {primaryValue}
      </p>
      <p className="text-[10px] text-zinc-500">{primaryLabel}</p>
      <p className="mt-1.5 font-mono text-xs text-zinc-300">{secondaryValue}</p>
      <p className="text-[10px] text-zinc-600">
        {secondaryLabel}
        {meta ? `, ${meta}` : ''}
      </p>
    </div>
  );
}

function WindowTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-xs text-white">{value}</p>
    </div>
  );
}

/* ─── recent-invoice row ─────────────────────────────────────────────── */

function RecentInvoiceRowItem({
  invoice,
  surface,
}: {
  invoice: RecentInvoiceRow;
  surface: 'admin' | 'client';
}) {
  const href =
    surface === 'client'
      ? `/client/invoices/${invoice.invoice_id}`
      : `/admin/invoices/${invoice.invoice_id}`;

  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition-colors hover:border-violet/30 hover:bg-violet/[0.04]"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs">
            <Hash className="h-3 w-3 shrink-0 text-zinc-500" strokeWidth={2} />
            <span className="truncate font-mono text-[11px] text-zinc-200">
              {invoice.invoice_number}
            </span>
            <StatusPill status={invoice.status} />
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {invoice.issued_at ? formatRelative(invoice.issued_at) : 'No date'}
            {invoice.cost_center_snapshot && (
              <>
                <span className="mx-1.5">·</span>
                <span>{invoice.cost_center_snapshot}</span>
              </>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {invoice.display_currency &&
          invoice.display_currency !== invoice.currency &&
          invoice.display_total_cents !== null ? (
            <>
              <p className="font-mono text-xs font-medium text-white">
                {formatMoney(invoice.display_total_cents, invoice.display_currency)}
              </p>
              <p className="font-mono text-[9px] text-zinc-500">
                native {formatMoney(invoice.total_cents, invoice.currency)}
              </p>
            </>
          ) : (
            <p className="font-mono text-xs font-medium text-white">
              {formatMoney(invoice.total_cents, invoice.currency)}
            </p>
          )}
          <ArrowUpRight
            className="ml-auto mt-0.5 h-3 w-3 text-zinc-600 transition-colors group-hover:text-violet-glow"
            strokeWidth={1.75}
          />
        </div>
      </Link>
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    approved: 'border-cyan-glow/20 bg-cyan-glow/[0.06] text-cyan-glow',
    pending_review: 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200',
    disputed: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
    voided: 'border-white/[0.08] bg-white/[0.04] text-zinc-400',
  };
  const cls = map[status] ?? 'border-white/[0.08] bg-white/[0.04] text-zinc-400';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-industrial',
        cls,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

/* ─── empty / loading states ─────────────────────────────────────────── */

function LoadingState() {
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="h-[88px] animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.02]" />
        <div className="h-[88px] animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.02]" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-12 animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.01]" />
        <div className="h-12 animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.01]" />
        <div className="h-12 animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.01]" />
      </div>
    </div>
  );
}

function UnavailableState() {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.01] px-3 py-3 text-[11px] text-zinc-500">
      <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span>
        Spend data isn&apos;t available for this department. The financial
        suite may not be installed in this environment, or you may not
        have access.
      </span>
    </p>
  );
}

function NoSpendState() {
  return (
    <p className="mt-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.01] px-3 py-3 text-center text-[11px] text-zinc-500">
      No spend attributed yet, invoices tagged to this department will
      appear here.
    </p>
  );
}

/* ─── formatters (zero-dep) ─────────────────────────────────────────── */

function formatMoney(cents: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    });
    return formatter.format(cents / 100);
  } catch {
    // Unknown currency code → fall back to a plain numeric format.
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.round(diffSec / 86400)}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
