'use server';

import { revalidatePath } from 'next/cache';
import {
  adminSetFeeScheduleInput,
  percentStringToBps,
} from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SetFeeScheduleActionState {
  ok: boolean;
  error: string | null;
  saved?: {
    correlation_id: string;
    after: {
      client_commission_bps: number;
      stripe_application_fee_bps: number;
      dispute_fee_cents: number;
      payout_fee_bps: number;
    };
  };
}

export const setFeeScheduleInitialState: SetFeeScheduleActionState = {
  ok: false,
  error: null,
};

export async function setFeeSchedule(
  _prev: SetFeeScheduleActionState,
  formData: FormData,
): Promise<SetFeeScheduleActionState> {
  // Parse percent strings → basis points, dollars → cents.
  const clientCommissionBps = percentStringToBps(String(formData.get('clientCommissionPct') ?? ''));
  const stripeFeeBps = percentStringToBps(String(formData.get('stripeApplicationFeePct') ?? ''));
  const payoutFeeBps = percentStringToBps(String(formData.get('payoutFeePct') ?? ''));
  const disputeFeeDollars = Number(String(formData.get('disputeFeeDollars') ?? ''));
  const disputeFeeCents = Number.isFinite(disputeFeeDollars)
    ? Math.round(disputeFeeDollars * 100)
    : NaN;

  if (clientCommissionBps === null) {
    return { ok: false, error: 'Client commission must be a number (e.g. 15 for 15%).' };
  }
  if (stripeFeeBps === null) {
    return { ok: false, error: 'Stripe application fee must be a number (e.g. 2.5 for 2.5%).' };
  }
  if (payoutFeeBps === null) {
    return { ok: false, error: 'Payout fee must be a number (e.g. 0 for none).' };
  }
  if (!Number.isFinite(disputeFeeCents)) {
    return { ok: false, error: 'Dispute fee must be a dollar amount.' };
  }

  const parsed = adminSetFeeScheduleInput.safeParse({
    p_client_commission_bps: clientCommissionBps,
    p_stripe_application_fee_bps: stripeFeeBps,
    p_dispute_fee_cents: disputeFeeCents,
    p_payout_fee_bps: payoutFeeBps,
    p_reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_set_fee_schedule', parsed.data);

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    correlation_id?: string;
    after?: {
      client_commission_bps: number;
      stripe_application_fee_bps: number;
      dispute_fee_cents: number;
      payout_fee_bps: number;
    };
  };

  if (!result.ok) {
    return { ok: false, error: 'Fee schedule RPC returned a non-ok response.' };
  }

  revalidatePath('/admin/settings');
  revalidatePath('/admin/dashboard');

  return {
    ok: true,
    error: null,
    saved: {
      correlation_id: result.correlation_id ?? '',
      after: result.after ?? {
        client_commission_bps: parsed.data.p_client_commission_bps,
        stripe_application_fee_bps: parsed.data.p_stripe_application_fee_bps,
        dispute_fee_cents: parsed.data.p_dispute_fee_cents,
        payout_fee_bps: parsed.data.p_payout_fee_bps,
      },
    },
  };
}
