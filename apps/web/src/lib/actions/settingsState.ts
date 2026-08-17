// State shape + initial value for the fee-schedule Server Action.
// Kept OUT of the 'use server' module — see lib/actions/dispatchState.ts.

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
