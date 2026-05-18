// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientJobReport.types.ts — types for the report-approval surface
//
//  GOLDEN_RULE_6 — A client only sees a report when admin has forwarded it
//  (admin_confirmed_at IS NOT NULL). The "client signal" state below tracks
//  whether the client has already approved / requested revision so the page
//  renders idempotent UI (no duplicate audit events from button mashing).
//
//  GOLDEN_RULE_2 — Payload omits inspector_payout_cents and any spread
//  fields. client_price_cents (the client's own money) is fine to show.
// ════════════════════════════════════════════════════════════════════════════

export type ClientReportSignal =
  | { kind: 'none' }
  | { kind: 'approved'; at: string }
  | { kind: 'revision_requested'; at: string; reason: string | null };

export interface ClientReportState {
  jobId: string;
  jobTitle: string;
  /** When admin handed the report off to the client. NULL if not yet. */
  adminConfirmedAt: string | null;
  /** Client-side final price (admin-set). NEVER the inspector's payout. */
  clientPriceCents: number | null;
  /** Identity of the inspector who completed the work (display only). */
  inspectorFullName: string | null;
  inspectorCompanyName: string | null;
  /** Current escrow / payout posture for context. */
  payoutStatus: string | null;
  /** Job lifecycle status — drives copy ("completed" vs "in_progress"). */
  status: string;
  /** Most recent client-originated signal in audit_events for this job. */
  latestClientSignal: ClientReportSignal;
}
