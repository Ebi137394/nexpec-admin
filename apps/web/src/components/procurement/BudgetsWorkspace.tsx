'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/BudgetsWorkspace.tsx
//
//  Client workspace for /client/budget/envelopes. Renders each budget
//  row with a consumption progress bar; opens the editor dialog for
//  create + edit.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import {
  Plus,
  Pencil,
  Building2,
  Calendar,
  AlertTriangle,
  Wallet,
} from 'lucide-react';

import type { DepartmentBudgetRow } from '@/lib/data/procurement.types';
import type { DepartmentPickerOption } from '@/lib/data/orgStructure.types';
import type { CurrencyCode } from '@nexpec/shared-core';
import { BudgetEditorDialog } from './BudgetEditorDialog';
import { cn } from '@/lib/cn';

interface Props {
  orgId: string;
  orgName: string;
  budgets: DepartmentBudgetRow[];
  departments: DepartmentPickerOption[];
  defaultCurrency: CurrencyCode;
}

export function BudgetsWorkspace({
  orgName,
  budgets,
  departments,
  defaultCurrency,
}: Props) {
  const [editing, setEditing] = useState<DepartmentBudgetRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Fiscal-period allocation envelopes for{' '}
          <span className="text-white">{orgName}</span>. Consumption (committed
          + paid) is computed against the current period on the fly.
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-violet/20 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-inset ring-violet/40 transition-colors hover:bg-violet/30"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New envelope
        </button>
      </div>

      {budgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <Wallet
            className="mx-auto h-7 w-7 text-violet-glow/70"
            strokeWidth={1.5}
          />
          <p className="mt-4 font-display text-base text-white">
            No budget envelopes yet
          </p>
          <p className="mt-1 mx-auto max-w-md text-pretty text-xs text-zinc-500">
            Budgets are optional but provide live consumption context to
            approvers when they review a request. Add one to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => (
            <li key={b.id}>
              <BudgetCard budget={b} onEdit={() => setEditing(b)} />
            </li>
          ))}
        </ul>
      )}

      <BudgetEditorDialog
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        budget={editing}
        departments={departments}
        defaultCurrency={defaultCurrency}
      />
    </>
  );
}

/* ─── row card with progress bar ──────────────────────────────────── */

function BudgetCard({
  budget,
  onEdit,
}: {
  budget: DepartmentBudgetRow;
  onEdit: () => void;
}) {
  const allocated = budget.allocated_cents;
  const committed = budget.committed_cents ?? 0;
  const paid = budget.paid_cents ?? 0;
  const remaining = Math.max(allocated - committed, 0);
  const committedPct = allocated > 0 ? (committed / allocated) * 100 : 0;
  const paidPct = allocated > 0 ? (paid / allocated) * 100 : 0;
  const overspent = committed > allocated;
  const hasConsumption = budget.committed_cents !== null;

  return (
    <article className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <Building2 className="h-3 w-3 text-violet-glow" strokeWidth={1.75} />
            Department
          </p>
          <p className="mt-1 truncate font-display text-base font-semibold text-white">
            {budget.department_name ?? '— unnamed —'}
          </p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            <Calendar className="h-3 w-3" strokeWidth={1.75} />
            {budget.fiscal_period_start} → {budget.fiscal_period_end}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold text-white">
            {formatMoney(allocated, budget.currency)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            allocated
          </p>
        </div>
      </header>

      {hasConsumption ? (
        <>
          {/* Progress bar */}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.04]">
            <div className="flex h-full">
              {/* Paid portion (cyan) */}
              <div
                className="h-full bg-cyan-glow/70"
                style={{ width: `${Math.min(paidPct, 100)}%` }}
                title={`Paid: ${formatMoney(paid, budget.currency)}`}
              />
              {/* Committed-not-paid portion (violet) */}
              <div
                className="h-full bg-violet/60"
                style={{
                  width: `${Math.min(Math.max(committedPct - paidPct, 0), 100)}%`,
                }}
                title={`Committed: ${formatMoney(committed, budget.currency)}`}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <Cell
              label="Committed"
              value={formatMoney(committed, budget.currency)}
              meta={`${committedPct.toFixed(0)}%`}
              tone={overspent ? 'rose' : 'violet'}
            />
            <Cell
              label="Paid"
              value={formatMoney(paid, budget.currency)}
              meta={`${paidPct.toFixed(0)}%`}
              tone="cyan"
            />
            <Cell
              label="Remaining"
              value={formatMoney(remaining, budget.currency)}
              meta={overspent ? 'over budget' : 'available'}
              tone={overspent ? 'rose' : 'neutral'}
            />
          </div>

          {overspent && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span>
                Committed spend exceeds the allocated envelope. Approvers
                see this warning when they review new requests against this
                department.
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-[11px] text-zinc-500">
          Period is outside the current date range — consumption isn&apos;t
          shown for non-active periods.
        </p>
      )}

      {budget.notes && (
        <p className="mt-3 text-[11px] text-zinc-400">
          <span className="text-zinc-500">Note:</span> {budget.notes}
        </p>
      )}

      <footer className="mt-4 flex items-center justify-end border-t border-white/[0.04] pt-3">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:border-violet/30 hover:text-violet-glow"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Edit envelope
        </button>
      </footer>
    </article>
  );
}

function Cell({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  tone: 'violet' | 'cyan' | 'rose' | 'neutral';
}) {
  const accent = {
    violet: 'text-violet-glow',
    cyan: 'text-cyan-glow',
    rose: 'text-rose-200',
    neutral: 'text-white',
  }[tone];
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={cn('mt-1 font-mono text-sm font-medium', accent)}>{value}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        {meta}
      </p>
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}
