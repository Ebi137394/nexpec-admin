// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientFinance.types.ts — client finance dashboard
//
//  GOLDEN_RULE_2 — every cents figure here is the CLIENT'S side of the
//  ledger (client_price_cents, escrow held). Inspector payouts + spread
//  never appear in this projection.
// ════════════════════════════════════════════════════════════════════════════

export interface ClientFinanceMetrics {
  /** Sum of client_price_cents for completed jobs YTD. */
  totalSpendYtdCents: number;
  /** Sum of client_price_cents for assigned/in_progress jobs (held by NEXPEC escrow). */
  heldInEscrowCents: number;
  /** Sum of client_price_cents released to inspectors YTD (payout_status='paid'). */
  paidOutYtdCents: number;
  /** Count of completed jobs YTD. */
  completedJobsYtd: number;
  /** Count of currently active jobs (open/assigned/in_progress). */
  activeJobsCount: number;
}

export type FinanceActivityKind =
  | 'job_posted'
  | 'job_assigned'
  | 'report_received'
  | 'job_completed'
  | 'payout_released';

export interface FinanceActivityRow {
  jobId: string;
  jobTitle: string;
  kind: FinanceActivityKind;
  amountCents: number | null;
  /** ISO timestamp that drives sort + display. */
  occurredAt: string;
  /** Job's current status — drives the status pill on the row. */
  jobStatus: string;
  /** Payout status as currently tracked on the job. */
  payoutStatus: string | null;
}

export interface ClientFinance {
  metrics: ClientFinanceMetrics;
  recentActivity: FinanceActivityRow[];
}
