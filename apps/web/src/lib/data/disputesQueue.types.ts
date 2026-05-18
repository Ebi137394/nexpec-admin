// ════════════════════════════════════════════════════════════════════════════
//  lib/data/disputesQueue.types.ts — type-only. Safe for Client Components.
// ════════════════════════════════════════════════════════════════════════════

export interface DisputeJob {
  id: string;
  title: string | null;
  location: string | null;
  created_at: string | null;
  updated_at: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  contractor_email: string | null;
  client_price_cents: number | null;
  payout_amount_cents: number | null;
}

export interface DisputeTimelineEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  actor_label: string | null;
  actor_role: string | null;
}
