// ════════════════════════════════════════════════════════════════════════════
//  lib/data/payoutsQueue.types.ts — type-only. Safe for Client Components.
// ════════════════════════════════════════════════════════════════════════════

export interface PayoutJob {
  id: string;
  title: string | null;
  location: string | null;
  /** Derived from jobs.updated_at — public.jobs has no completed_at column.
   *  status='completed' + updated_at is the moment the job reached completed. */
  completed_at: string | null;
  /** Canonical settlement stamp once the payout has actually been paid. */
  payout_paid_at: string | null;
  updated_at: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  contractor_email: string | null;
  client_price_cents: number | null;
  payout_amount_cents: number | null;
  payout_status: string | null;
}

export interface PayoutsQueueResult {
  jobs: PayoutJob[];
  total: number;
  totalOwedCents: number;
}
