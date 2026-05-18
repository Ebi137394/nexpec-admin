// ════════════════════════════════════════════════════════════════════════════
//  lib/data/payoutsQueue.types.ts — type-only. Safe for Client Components.
// ════════════════════════════════════════════════════════════════════════════

export interface PayoutJob {
  id: string;
  title: string | null;
  location: string | null;
  completed_at: string | null;
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
