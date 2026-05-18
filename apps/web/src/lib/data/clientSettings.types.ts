// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientSettings.types.ts — types for the client's own profile
//
//  GOLDEN_RULE_2 — explicitly excludes any payout-related fields
//  (hourly_rate_cents, balance_cents, stripe_connect_id, etc.). Those
//  are inspector-side concerns and have no place on a client profile.
// ════════════════════════════════════════════════════════════════════════════

export interface ClientProfileSettings {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  phone: string | null;
  /** Marketing / transactional notifications preference. */
  unreadNotificationsCount: number;
  /** Last-active timestamp shown as relative time. */
  lastActive: string | null;
  createdAt: string | null;
}
