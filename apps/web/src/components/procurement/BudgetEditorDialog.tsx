'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/BudgetEditorDialog.tsx
//
//  Create or update one department budget envelope. Calls
//  setDepartmentBudgetAction.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, AlertTriangle, Coins, Loader2 } from 'lucide-react';

import {
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from '@nexpec/shared-core';
import type { DepartmentBudgetRow } from '@/lib/data/procurement.types';
import type { DepartmentPickerOption } from '@/lib/data/orgStructure.types';
import { setDepartmentBudgetAction } from '@/lib/actions/procurement';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, editing this budget; otherwise creating a new one. */
  budget?: DepartmentBudgetRow | null;
  departments: DepartmentPickerOption[];
  /** Default currency to seed the form with (the org's base_currency). */
  defaultCurrency: CurrencyCode;
}

export function BudgetEditorDialog({
  open,
  onClose,
  budget,
  departments,
  defaultCurrency,
}: Props) {
  const router = useRouter();
  const editing = !!budget;

  const [departmentId, setDepartmentId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [allocatedDollars, setAllocatedDollars] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deptRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    if (budget) {
      setDepartmentId(budget.department_id ?? '');
      setPeriodStart(budget.fiscal_period_start);
      setPeriodEnd(budget.fiscal_period_end);
      setCurrency(budget.currency as CurrencyCode);
      setAllocatedDollars((budget.allocated_cents / 100).toString());
      setNotes(budget.notes ?? '');
    } else {
      // Seed sensible defaults — current fiscal year.
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const yearEnd = `${new Date().getFullYear() + 1}-01-01`;
      setDepartmentId('');
      setPeriodStart(yearStart);
      setPeriodEnd(yearEnd);
      setCurrency(defaultCurrency);
      setAllocatedDollars('');
      setNotes('');
    }
    setError(null);
    setTimeout(() => deptRef.current?.focus(), 50);
  }, [open, budget, defaultCurrency]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!departmentId) {
      setError('Pick a department.');
      return;
    }
    const allocatedCents = Math.round(
      parseFloat(allocatedDollars || '0') * 100,
    );
    if (Number.isNaN(allocatedCents) || allocatedCents < 0) {
      setError('Allocated amount must be a non-negative number.');
      return;
    }
    if (!periodStart || !periodEnd || periodEnd <= periodStart) {
      setError('Fiscal period end must be after the start date.');
      return;
    }

    startTransition(async () => {
      const res = await setDepartmentBudgetAction({
        departmentId,
        fiscalPeriodStart: periodStart,
        fiscalPeriodEnd: periodEnd,
        currency,
        allocatedCents,
        notes: notes.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save budget.');
        return;
      }
      router.refresh();
      setTimeout(onClose, 200);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit budget' : 'Create budget'}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
              Department budget envelope
            </p>
            <h3 className="mt-1 font-display text-base font-semibold text-white">
              {editing
                ? `Edit ${budget?.department_name ?? 'budget'}`
                : 'New budget envelope'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <Field label="Department">
            <select
              ref={deptRef}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={editing}
              className={`${inputCls} appearance-none ${editing ? 'opacity-60' : ''}`}
            >
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {'  '.repeat(Math.max(0, d.depth)) +
                    (d.depth > 0 ? '↳ ' : '') +
                    d.name}
                </option>
              ))}
            </select>
            {editing && (
              <p className="mt-1 text-[10px] text-zinc-500">
                Department locked on edit. Create a new envelope to move a
                budget to a different department.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Fiscal period start">
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </Field>
            <Field label="Fiscal period end (exclusive)">
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Currency">
              <div className="relative">
                <Coins className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className={`${inputCls} appearance-none pl-8 font-mono`}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field
              label="Allocated"
              hint="Whole units (cents calculated on save)."
            >
              <input
                type="number"
                min={0}
                step="0.01"
                value={allocatedDollars}
                onChange={(e) => setAllocatedDollars(e.target.value)}
                placeholder="500000"
                className={`${inputCls} font-mono`}
              />
            </Field>
            <div className="rounded-xl border border-violet/30 bg-violet/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
                Period
              </p>
              <p className="mt-1 font-mono text-[11px] text-zinc-300">
                {periodStart || '—'} <br />→ {periodEnd || '—'}
              </p>
            </div>
          </div>

          <Field label="Notes (optional)" hint="Internal, visible in audit.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="e.g. FY26 inspection envelope; reviewed Q1 by procurement."
              className={`${inputCls} resize-y`}
            />
          </Field>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-industrial transition-colors',
                'bg-violet/25 text-violet-glow ring-1 ring-inset ring-violet/40 hover:bg-violet/35',
                'disabled:opacity-50',
              )}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
              {editing ? 'Save budget' : 'Create budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── primitives ──────────────────────────────────────────────────── */

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
