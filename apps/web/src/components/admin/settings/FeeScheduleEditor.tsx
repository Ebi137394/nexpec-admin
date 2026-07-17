'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import { bpsToPercentString } from '@nexpec/shared-core';
import {
  setFeeSchedule,
  setFeeScheduleInitialState,
  type SetFeeScheduleActionState,
} from '@/lib/actions/settings';
import type { FeeSchedule } from '@/lib/data/settings.types';
import { cn } from '@/lib/cn';

interface Props {
  initial: FeeSchedule;
}

export function FeeScheduleEditor({ initial }: Props) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<SetFeeScheduleActionState, FormData>(
    setFeeSchedule,
    setFeeScheduleInitialState,
  );

  // After a successful save, fall back to read-mode and use the returned
  // values rather than the stale `initial` prop.
  const live = state.saved?.after
    ? {
        client_commission_bps: state.saved.after.client_commission_bps,
        stripe_application_fee_bps: state.saved.after.stripe_application_fee_bps,
        dispute_fee_cents: state.saved.after.dispute_fee_cents,
        payout_fee_bps: state.saved.after.payout_fee_bps,
        updated_at: new Date().toISOString(),
      }
    : initial;

  if (!editing) {
    return (
      <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-6 sm:p-8">
        <Header
          title="Fee schedule"
          subtitle="Affects every new transaction the moment it saves. Past transactions retain the fee they were created under."
          right={
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:text-white"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          }
        />

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FeeCell label="Client commission" value={bpsToPercentString(live.client_commission_bps)} tone="violet" />
          <FeeCell label="Stripe app fee" value={bpsToPercentString(live.stripe_application_fee_bps)} />
          <FeeCell label="Payout fee" value={bpsToPercentString(live.payout_fee_bps)} />
          <FeeCell
            label="Dispute fee"
            value={
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }).format(live.dispute_fee_cents / 100)
            }
            tone="amber"
          />
        </dl>

        {state.saved && (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-accent-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Saved.{' '}
            {state.saved.correlation_id && (
              <Link
                href={`/admin/audit?correlationId=${state.saved.correlation_id}`}
                className="inline-flex items-center gap-1 text-violet-glow hover:text-white"
              >
                <Link2 className="h-3 w-3" />
                Audit Trail
              </Link>
            )}
          </div>
        )}

        {live.updated_at && (
          <p className="mt-4 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
            updated, {new Date(live.updated_at).toUTCString()}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8">
      <Header
        title="Edit fee schedule"
        subtitle="Audit-critical. Every change is correlation-stamped with the operator's id and the reason."
        right={
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={state.ok}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        }
      />

      <form action={formAction} className="mt-6 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PercentField
            label="Client commission"
            name="clientCommissionPct"
            defaultValue={(live.client_commission_bps / 100).toFixed(2)}
            hint="Platform's cut of the client's bill. 15.00 = 15%."
          />
          <PercentField
            label="Stripe application fee"
            name="stripeApplicationFeePct"
            defaultValue={(live.stripe_application_fee_bps / 100).toFixed(2)}
            hint="Charged on top of Stripe's own processing fee."
          />
          <PercentField
            label="Payout fee"
            name="payoutFeePct"
            defaultValue={(live.payout_fee_bps / 100).toFixed(2)}
            hint="Charged to inspector at payout. 0 = no fee."
          />
          <DollarField
            label="Dispute fee"
            name="disputeFeeDollars"
            defaultValue={(live.dispute_fee_cents / 100).toFixed(2)}
            hint="Flat fee deducted from the payment hold when a dispute is opened."
          />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            Reason (audit-captured)
          </span>
          <textarea
            name="reason"
            required
            rows={3}
            maxLength={1000}
            placeholder="e.g. Q3 board approval, lowering platform take by 1pt to match competitor."
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
        </label>

        {state.error && (
          <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed">{state.error}</p>
          </div>
        )}

        <SaveButton onDone={() => setEditing(false)} ok={state.ok} />
      </form>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function FeeCell({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'violet' | 'amber';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'amber'
        ? 'text-accent-amber'
        : 'text-white';
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={cn('mt-1 font-mono text-xl font-semibold tracking-tight', valueColor)}>
        {value}
      </p>
    </div>
  );
}

function PercentField({
  label,
  name,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
        {label}
      </span>
      <span className="relative block">
        <input
          name={name}
          type="text"
          inputMode="decimal"
          defaultValue={defaultValue}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-10 font-mono text-base text-white focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-sm text-zinc-500">
          %
        </span>
      </span>
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

function DollarField({
  label,
  name,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
        {label}
      </span>
      <span className="relative block">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-zinc-500">
          $
        </span>
        <input
          name={name}
          type="text"
          inputMode="decimal"
          defaultValue={defaultValue}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-7 pr-4 font-mono text-base text-white focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
        />
      </span>
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

function SaveButton({ onDone, ok }: { onDone: () => void; ok: boolean }) {
  const { pending } = useFormStatus();

  // Auto-exit edit mode after a successful save.
  if (ok) {
    setTimeout(onDone, 1500);
  }

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary group justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
    >
      <Save className="h-4 w-4" />
      {pending ? 'Recording change…' : 'Save fee schedule'}
    </button>
  );
}
