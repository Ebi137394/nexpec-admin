// ════════════════════════════════════════════════════════════════════════════
//  RecordManualPaymentForm — the admin control that closes the manual
//  settlement loop.
//
//  Buyer wires money → admin records it here (direction=client_payment) →
//  my_job_settlement_view flips the buyer's job to part_paid/paid.
//  Admin pays a provider (bank/Wise) → records it here
//  (direction=inspector_payout) → my_earnings_view flips the provider's due →
//  paid. Authorization and the audit row live in the RPC
//  (admin_record_manual_payment, nx_is_admin-gated) — this form is never the
//  boundary.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState } from 'react';
import { Banknote, CheckCircle2, AlertCircle } from 'lucide-react';
import { recordManualPayment, type ManualPaymentResult } from '@/lib/actions/manualPayments';

const initial: ManualPaymentResult = { ok: false };

export function RecordManualPaymentForm({ jobId, defaultDirection = 'client_payment' }: {
  jobId?: string;
  defaultDirection?: 'client_payment' | 'inspector_payout';
}) {
  const [state, action, pending] = useActionState(recordManualPayment, initial);

  return (
    <form action={action} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Banknote className="h-4 w-4 text-accent-green" /> Record a manual payment
      </h3>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        Every entry is admin-gated and audited. Buyer payments update the
        client&apos;s settlement status; provider payouts update earned/due/paid.
        Partial amounts are supported — record what actually moved.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs text-zinc-400">
          Job ID
          <input name="jobId" defaultValue={jobId} required placeholder="UUID of the job"
                 className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 font-mono text-xs text-white placeholder-white/30 outline-none focus:border-violet/60" />
        </label>
        <label className="block text-xs text-zinc-400">
          Direction
          <select name="direction" defaultValue={defaultDirection}
                  className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-white outline-none focus:border-violet/60">
            <option value="client_payment">Buyer payment received</option>
            <option value="inspector_payout">Provider payout sent</option>
          </select>
        </label>
        <label className="block text-xs text-zinc-400">
          Amount (USD)
          <input name="amountDollars" type="number" step="0.01" min="0.01" required placeholder="0.00"
                 className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-violet/60" />
        </label>
        <label className="block text-xs text-zinc-400">
          Method
          <select name="method" defaultValue="bank_transfer"
                  className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-white outline-none focus:border-violet/60">
            <option value="bank_transfer">Bank transfer</option>
            <option value="wire">Wire</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block text-xs text-zinc-400">
          Payment date
          <input name="paidOn" type="date"
                 className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-white outline-none focus:border-violet/60" />
        </label>
        <label className="block text-xs text-zinc-400">
          Reference
          <input name="reference" placeholder="Wire / transaction reference"
                 className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-white placeholder-white/30 outline-none focus:border-violet/60" />
        </label>
        <label className="block text-xs text-zinc-400 sm:col-span-2">
          Internal note
          <input name="notes" placeholder="Visible to admins only"
                 className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-white placeholder-white/30 outline-none focus:border-violet/60" />
        </label>
        <label className="block text-xs text-zinc-400">
          Status
          <select name="status" defaultValue="paid_manually"
                  className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-white outline-none focus:border-violet/60">
            <option value="paid_manually">Settled (funds confirmed)</option>
            <option value="pending">Pending confirmation</option>
            <option value="recorded">Recorded</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={pending}
                className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-deep disabled:opacity-60">
          {pending ? 'Recording…' : 'Record payment'}
        </button>
        {state.ok && (
          <span className="inline-flex items-center gap-1.5 text-sm text-accent-green">
            <CheckCircle2 className="h-4 w-4" /> Recorded — all views updated.
          </span>
        )}
        {!state.ok && state.error && (
          <span className="inline-flex items-center gap-1.5 text-sm text-accent-red">
            <AlertCircle className="h-4 w-4" /> {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
