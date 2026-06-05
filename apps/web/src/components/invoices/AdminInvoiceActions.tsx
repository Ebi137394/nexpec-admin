// ════════════════════════════════════════════════════════════════════════════
//  components/invoices/AdminInvoiceActions.tsx — Admin override panel
//
//  Three buyer-side states unlock different admin actions:
//    pending_review / approved → markPaid, void
//    disputed                  → adjudicate (approve | void)
//    paid / voided             → no actions (terminal)
//
//  All actions enforce admin role at the action layer; this UI is purely
//  presentational.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Gavel,
  Loader2,
  XCircle,
} from 'lucide-react';
import {
  adjudicateDisputeAction,
  markInvoicePaidAction,
  voidInvoiceAction,
} from '@/lib/actions/invoices';
import {
  invoiceActionInitialState,
  type InvoiceActionState,
} from '@/lib/actions/invoices.types';
import type { InvoiceStatus } from '@/lib/data/invoices.types';

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
}

type Mode = 'idle' | 'pay' | 'void' | 'adjudicate';

export function AdminInvoiceActions({ invoiceId, status }: Props) {
  const [mode, setMode] = useState<Mode>('idle');

  if (status === 'paid' || status === 'voided') {
    return (
      <p className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3 text-xs text-zinc-500">
        Terminal state, no admin actions available.
      </p>
    );
  }

  if (mode === 'pay') {
    return <PayForm invoiceId={invoiceId} onDone={() => setMode('idle')} />;
  }
  if (mode === 'void') {
    return <VoidForm invoiceId={invoiceId} onDone={() => setMode('idle')} />;
  }
  if (mode === 'adjudicate') {
    return <AdjudicateForm invoiceId={invoiceId} onDone={() => setMode('idle')} />;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {status === 'disputed' ? (
        <button
          type="button"
          onClick={() => setMode('adjudicate')}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
        >
          <Gavel className="h-4 w-4" strokeWidth={2} />
          Adjudicate dispute
        </button>
      ) : null}
      {status === 'approved' ? (
        <button
          type="button"
          onClick={() => setMode('pay')}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          Mark paid
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setMode('void')}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-500/40 bg-zinc-500/10 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-500/15"
      >
        <Ban className="h-4 w-4" strokeWidth={2} />
        Void
      </button>
    </div>
  );
}

function PayForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(
    markInvoicePaidAction,
    invoiceActionInitialState,
  );
  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <p className="text-sm font-semibold text-emerald-100">Mark invoice paid</p>
      <p className="text-[11px] text-emerald-200/70">
        Optional: enter the payment reference (Stripe charge id, wire ref, etc.) for the audit trail.
      </p>
      <input
        name="reference"
        type="text"
        placeholder="e.g. ch_3Nx2a8…"
        maxLength={120}
        className="w-full rounded-xl border border-emerald-500/30 bg-white/[0.02] px-3.5 py-2.5 text-sm text-white placeholder:text-emerald-300/30 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
      />
      {state.error ? <Alert tone="red" msg={state.error} /> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <ActionButton label="Mark paid" />
      </div>
    </form>
  );
}

function VoidForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(
    voidInvoiceAction,
    invoiceActionInitialState,
  );
  const [reason, setReason] = useState('');
  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-zinc-500/30 bg-white/[0.02] p-4"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="flex items-start gap-3">
        <Ban className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" strokeWidth={2} />
        <div>
          <p className="text-sm font-semibold text-white">Void this invoice</p>
          <p className="text-[11px] text-zinc-500">
            Voiding cannot be undone. The audit trail keeps the original record.
          </p>
        </div>
      </div>
      <textarea
        name="reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={5}
        maxLength={500}
        placeholder="Reason for voiding (will appear in audit log)"
        className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10"
      />
      {state.error ? <Alert tone="red" msg={state.error} /> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <ActionButton label="Void invoice" tone="zinc" />
      </div>
    </form>
  );
}

function AdjudicateForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(
    adjudicateDisputeAction,
    invoiceActionInitialState,
  );
  const [decision, setDecision] = useState<'approve' | 'void'>('approve');
  const [notes, setNotes] = useState('');
  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-4"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="flex items-start gap-3">
        <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-red-200" strokeWidth={2} />
        <div>
          <p className="text-sm font-semibold text-red-100">Adjudicate dispute</p>
          <p className="text-[11px] text-red-200/70">
            Approve to release for payment, OR void if the dispute holds.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 ${
            decision === 'approve'
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-white/10 bg-white/[0.02]'
          }`}
        >
          <input
            type="radio"
            name="decision"
            value="approve"
            checked={decision === 'approve'}
            onChange={() => setDecision('approve')}
            className="accent-emerald-400"
          />
          <span className="text-sm text-white">Approve invoice</span>
        </label>
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 ${
            decision === 'void'
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-white/10 bg-white/[0.02]'
          }`}
        >
          <input
            type="radio"
            name="decision"
            value="void"
            checked={decision === 'void'}
            onChange={() => setDecision('void')}
            className="accent-red-400"
          />
          <span className="text-sm text-white">Void invoice</span>
        </label>
      </div>

      <textarea
        name="notes"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={1000}
        placeholder="Adjudication notes (audit trail)"
        className="w-full resize-y rounded-xl border border-red-500/30 bg-white/[0.02] px-3.5 py-2.5 text-sm text-white placeholder:text-red-300/40 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/30"
      />

      {state.error ? <Alert tone="red" msg={state.error} /> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <ActionButton label="Submit decision" tone={decision === 'approve' ? 'green' : 'red'} />
      </div>
    </form>
  );
}

function ActionButton({
  label,
  tone = 'green',
}: {
  label: string;
  tone?: 'green' | 'red' | 'zinc';
}) {
  const { pending } = useFormStatus();
  const cls = {
    green: 'bg-emerald-500 text-ink-900 hover:bg-emerald-500/90',
    red: 'bg-red-500 text-white hover:bg-red-500/90',
    zinc: 'bg-zinc-200 text-ink-900 hover:bg-white',
  }[tone];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-industrial transition disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {pending ? 'Working…' : label}
    </button>
  );
}

function Alert({ tone, msg }: { tone: 'red' | 'green'; msg: string }) {
  const cls =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : 'border-red-500/30 bg-red-500/10 text-red-200';
  const icon = tone === 'green' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />;
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${cls}`}>
      <span className="mt-0.5">{icon}</span>
      <span>{msg}</span>
    </div>
  );
}
