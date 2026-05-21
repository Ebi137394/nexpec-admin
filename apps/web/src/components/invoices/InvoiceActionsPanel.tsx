// ════════════════════════════════════════════════════════════════════════════
//  components/invoices/InvoiceActionsPanel.tsx — client-side approval flow
//
//  Client Component because it uses useActionState to drive the approve /
//  dispute server actions and renders inline form state. Pure UI; all
//  validation and authorisation happens in the action layer.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import {
  approveInvoiceAction,
  disputeInvoiceAction,
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

export function InvoiceActionsPanel({ invoiceId, status }: Props) {
  const [showDispute, setShowDispute] = useState(false);

  // Only render the panel when the buyer can actually act on this invoice.
  if (status !== 'pending_review' && status !== 'approved') {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 text-xs text-zinc-500">
        This invoice is{' '}
        <span className="font-mono text-zinc-300">{status.replace('_', ' ')}</span>.
        No buyer-side actions available at this state.
      </div>
    );
  }

  if (showDispute) {
    return (
      <DisputeForm invoiceId={invoiceId} onCancel={() => setShowDispute(false)} />
    );
  }

  return (
    <div className="space-y-3">
      {status === 'pending_review' && (
        <ApproveForm invoiceId={invoiceId} />
      )}
      <button
        type="button"
        onClick={() => setShowDispute(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10"
      >
        <ThumbsDown className="h-4 w-4" strokeWidth={2} />
        Dispute this invoice
      </button>
    </div>
  );
}

// ─── Subforms ─────────────────────────────────────────────────────────

function ApproveForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(
    approveInvoiceAction,
    invoiceActionInitialState,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {state.error ? <ActionAlert tone="red" msg={state.error} /> : null}
      {state.ok && state.message ? <ActionAlert tone="green" msg={state.message} /> : null}
      <ApproveButton />
    </form>
  );
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-green px-4 py-3 text-sm font-bold uppercase tracking-industrial text-ink-900 transition hover:bg-accent-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : (
        <ThumbsUp className="h-4 w-4" strokeWidth={2} />
      )}
      {pending ? 'Approving…' : 'Approve invoice'}
    </button>
  );
}

function DisputeForm({
  invoiceId,
  onCancel,
}: {
  invoiceId: string;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState<InvoiceActionState, FormData>(
    disputeInvoiceAction,
    invoiceActionInitialState,
  );
  const [reason, setReason] = useState('');
  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-4"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" strokeWidth={2} />
        <div>
          <p className="text-sm font-semibold text-red-100">
            File a dispute on this invoice
          </p>
          <p className="mt-0.5 text-[11px] text-red-200/80">
            Admin will mediate. Once filed, the invoice is frozen until
            admin adjudicates. Be specific — what's wrong, what should
            it be?
          </p>
        </div>
      </div>

      <textarea
        name="reason"
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={10}
        maxLength={1000}
        placeholder="e.g. The line-item amount doesn't match the scope of work delivered. Expected $X, charged $Y."
        className="w-full resize-y rounded-xl border border-red-500/30 bg-white/[0.02] px-3.5 py-2.5 text-sm text-white placeholder:text-red-300/40 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/30"
      />
      <p className="text-right text-[10px] font-mono text-zinc-500">
        {reason.length} / 1000
      </p>

      {state.error ? <ActionAlert tone="red" msg={state.error} /> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <DisputeButton />
      </div>
    </form>
  );
}

function DisputeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold uppercase tracking-industrial text-white transition hover:bg-red-500/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
      {pending ? 'Filing…' : 'File dispute'}
    </button>
  );
}

function ActionAlert({ tone, msg }: { tone: 'red' | 'green'; msg: string }) {
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
