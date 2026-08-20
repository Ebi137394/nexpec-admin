// ════════════════════════════════════════════════════════════════════════════
//  components/payments/PaymentOptions.tsx — the release payment posture.
//
//  MANUAL PAYMENT ONLY in this release. Two options are shown so the roadmap
//  is honest rather than hidden:
//    • Manual payment — Available now
//    • Online card payment — Coming soon  (subtle, DISABLED, never clickable)
//
//  The "coming soon" card is rendered as a non-interactive <div> with
//  aria-disabled: it is deliberately NOT a <button>, so there is no click
//  target, no focus stop and no broken placeholder to activate. The server
//  enforces the same posture independently (platform_settings
//  .online_payments_enabled + the edge-function guard), so this component is
//  presentation only and cannot be the thing that keeps money from moving.
// ════════════════════════════════════════════════════════════════════════════

import { CheckCircle2, CreditCard, Clock } from 'lucide-react';

export function PaymentOptions({ className = '' }: { className?: string }) {
  return (
    <section
      aria-label="Payment options"
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}
    >
      {/* AVAILABLE — manual */}
      <div className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-accent-green" strokeWidth={2} />
          <p className="text-sm font-semibold text-white">Manual payment</p>
          <span className="ml-auto rounded-full border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-industrial text-accent-green">
            Available now
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Handled manually by NEXPEC after the required approvals.
        </p>
      </div>

      {/* COMING SOON — non-interactive by construction */}
      <div
        aria-disabled="true"
        data-testid="payment-option-online-coming-soon"
        className="cursor-not-allowed select-none rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 opacity-60"
      >
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-zinc-500" strokeWidth={2} />
          <p className="text-sm font-semibold text-zinc-400">Online card payment</p>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-industrial text-zinc-500">
            <Clock className="h-2.5 w-2.5" strokeWidth={2} />
            Coming soon
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Secure online payments will be added in a future update.
        </p>
      </div>
    </section>
  );
}

export default PaymentOptions;
