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
   * inspector has not filed one yet. No inspector identity is carried here.
   */
  reportId: string | null;
  /**
   * The DELIVERED report's findings, so the client can actually read what they
   * are approving.
   *
   * This used to be omitted deliberately ("an id only — no report content"),
   * which produced D22: the release page asked the client to approve a report
   * whose findings were never fetched and never rendered, with no PDF either.
   *
   * Populated ONLY when `inspection_reports.status = 'delivered'`, so a draft
   * or a report still in senior review cannot leak through a guessed URL. The
   * read itself is scoped by RLS to the owning client.
   *
   * Plain text — render it as text, never as HTML.
   */
  reportSummary: string | null;
  /** Delivered outcome ('pass' | 'partial' | 'fail'), same delivery gate. */
  reportResult: string | null;
  /** Report lifecycle status, so surfaces can explain WHY content is absent. */
  reportStatus: string | null;
  /** When admin handed the report off to the client. NULL if not yet. */
  adminConfirmedAt: string | null;
  /** Client-side final price (admin-set). NEVER the inspector's payout. */
  clientPriceCents: number | null;
  /**
   * Where clientPriceCents came from, so the surface can label it honestly
   * instead of implying a committed price that does not exist yet:
   *   'contract' — the live job contract (authoritative, signed figure)
   *   'job'      — jobs.client_price_cents (admin-set on the job)
   *   'budget'   — the posted budget; NO price agreed yet
   *   null       — nothing is set; render "not set yet", never $0
   * Mirrors the mobile buyerPriceCents() fallback chain so both platforms
   * present the same commercial figure for the same job.
   */
  clientPriceSource: 'contract' | 'job' | 'budget' | null;
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
