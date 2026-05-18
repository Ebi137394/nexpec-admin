// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientReports.types.ts — types for the client deliverables surface
//
//  GOLDEN_RULE_6 — A "report" surfaces to the client only after Admin
//  has reviewed it and forwarded it. We use admin_confirmed_at as the
//  admin-forwarded signal: NULL means admin hasn't approved yet; non-NULL
//  means it's been handed off to the client.
//
//  GOLDEN_RULE_2 — fields exposed here intentionally exclude
//  inspector_payout_cents / platform_spread_cents. The client sees the
//  final client_price_cents if set (their amount) and the inspector's
//  identity, never the inspector's price.
// ════════════════════════════════════════════════════════════════════════════

export interface ClientReportRow {
  jobId: string;
  jobTitle: string;
  /** Inspector who delivered the work. Their name shows here. */
  inspectorId: string | null;
  inspectorFullName: string | null;
  /** When admin handed the report off to the client. */
  adminConfirmedAt: string | null;
  /** Job completion timestamp (set when status → completed). */
  completedAt: string | null;
  /** Client-side price (admin-set). NEVER the inspector's payout. */
  clientPriceCents: number | null;
  /** Was the escrow already released to inspector? */
  payoutStatus: string | null;
}
