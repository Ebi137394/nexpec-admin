// ════════════════════════════════════════════════════════════════════════════
//  components/payments/PaymentOptions.tsx — payment posture (web)
//
//  Mirrors src/shared-ui/payments/PaymentOptions.tsx (mobile) and is DRIVEN BY
//  THE SERVER FLAG (platform_settings.online_payments_enabled via
//  nx_online_payments_enabled):
//
//    flag OFF → Manual payment available · card payment "Coming soon" (inert)
//    flag ON  → Online card payment available · manual also available
//
//  Server component: the flag is read server-side per render, so enabling live
//  payments is a data flip with no redeploy. Fail CLOSED — an error reading
//  the flag renders the OFF state. The edge-function guard enforces the
//  posture regardless; this panel is honest UI, never the boundary.
// ════════════════════════════════════════════════════════════════════════════

import { CheckCircle2, CreditCard, Clock } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function onlinePaymentsEnabled(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_online_payments_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function PaymentOptions({ className = '' }: { className?: string }) {
  const online = await onlinePaymentsEnabled();

  return (
    <section
      aria-label="Payment options"
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}
    >
      {online && (
        <div
          className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-4"
          data-testid="payment-option-online-available"
        >
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-accent-green" strokeWidth={2} />
            <p className="text-sm font-semibold text-white">Online card payment</p>
            <span className="ml-auto rounded-full border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-accent-green">
              AVAILABLE
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Pay securely by card. Processed by Stripe; NEXPEC never stores your
            card details.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-accent-green" strokeWidth={2} />
          <p className="text-sm font-semibold text-white">Manual payment</p>
          <span className="ml-auto rounded-full border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-accent-green">
            {online ? 'ALSO AVAILABLE' : 'AVAILABLE NOW'}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Bank transfer / invoice, handled by NEXPEC after the required
          approvals.
        </p>
      </div>

      {!online && (
        <div
          className="pointer-events-none rounded-2xl border border-white/10 bg-white/[0.02] p-4 opacity-60"
          aria-disabled="true"
          data-testid="payment-option-online-coming-soon"
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" strokeWidth={2} />
            <p className="text-sm font-semibold text-slate-400">Online card payment</p>
            <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-slate-500">
              COMING SOON
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Secure online payments will be added in a future update.
          </p>
        </div>
      )}
    </section>
  );
}

export default PaymentOptions;
