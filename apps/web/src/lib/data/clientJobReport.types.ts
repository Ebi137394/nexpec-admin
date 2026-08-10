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
  /**
   * The job's report of record, for surfaces that want to show WHAT is being
   * approved (per-visit record, contributor attribution). NULL when the
   * inspector has not filed one yet. An id only — no report content, and no
   * inspector identity, is carried here.
   */
  reportId: string | null;
  /** When admin handed the report off to the client. NULL if not yet. */
  adminConfirmedAt: string | null;
  /** Client-side final price (admin-set). NEVER the inspector's payout. */
  clientPriceCents: number | null;
  /**
   * Identity of the inspector who completed the work — display only, and
   * ONLY populated when jobs.identity_mode permits it ('professional' |
   * 'full') AND the workflow reveal boundary has passed (admin_confirmed_at
   * set OR status completed). Under the default 'protected' policy these stay
   * null forever and the UI shows `inspectorHandle` instead.
   */
  inspectorFullName: string | null;
  inspectorCompanyName: string | null;
  /** Pseudonymous NX- handle, always safe to show (anti-poaching). */
  inspectorHandle: string | null;
  /** Current escrow / payout posture for context. */
  payoutStatus: string | null;
  /** Job lifecycle status — drives copy ("completed" vs "in_progress"). */
  status: string;
  /** Most recent client-originated signal in audit_events for this job. */
  latestClientSignal: ClientReportSignal;
}
