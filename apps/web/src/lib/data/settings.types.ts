// ════════════════════════════════════════════════════════════════════════════
//  lib/data/settings.types.ts — pure types for /admin/settings
// ════════════════════════════════════════════════════════════════════════════

export interface FeeSchedule {
  client_commission_bps: number;
  stripe_application_fee_bps: number;
  dispute_fee_cents: number;
  payout_fee_bps: number;
  updated_at: string | null;
}

export interface IntegrationSecret {
  /** Env var name. */
  key: string;
  /** Human label. */
  label: string;
  /** Where the secret is used. */
  category: 'supabase' | 'stripe' | 'mail' | 'expo' | 'platform';
  /** Masked preview, e.g. `sk_live_…cZk`. Null if not set. */
  masked: string | null;
  /** Whether the env var is present at all. */
  present: boolean;
  /** Optional inline help. */
  hint?: string;
}
