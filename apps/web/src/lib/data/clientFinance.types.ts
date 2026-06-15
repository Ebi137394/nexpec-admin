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
  /**
   * PREPAY money locked in escrow: client_price_cents for prepay jobs that are
   * active and not yet released/refunded. This is cash the client has already
   * committed — distinct from net-terms credit (which is borrowed, not held).
   */
  heldInEscrowCents: number;
  /** Sum of client_price_cents released to inspectors YTD (payout_status='paid'). */
  paidOutYtdCents: number;
  /** Count of completed jobs YTD. */
  completedJobsYtd: number;
  /** Count of currently active jobs (open/assigned/in_progress). */
  activeJobsCount: number;
}

/** Net-30/60 trade-credit posture for B2B clients (Client/Agency/Enterprise). */
export type PaymentTerms = 'prepay' | 'net_15' | 'net_30' | 'net_45' | 'net_60';

export interface ClientCreditProfile {
  /** Account terms from profiles.client_payment_terms. */
  terms: PaymentTerms;
  /** Approved credit ceiling (profiles.client_credit_limit_cents). 0 = prepay-only. */
  creditLimitCents: number;
  /**
   * Drawn credit: client_price_cents for net-terms jobs that are committed
   * (assigned/in_progress/completed) and not yet settled. This is the client's
   * live exposure against the limit.
   */
  creditUsedCents: number;
  /** Remaining headroom = max(0, limit − used). */
  creditAvailableCents: number;
  /**
   * Currently invoiced & payable: net-terms jobs that have been delivered
   * (admin_confirmed_at set) but not yet settled. A subset of creditUsedCents.
   */
  netTermsDueCents: number;
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
  credit: ClientCreditProfile;
  recentActivity: FinanceActivityRow[];
}
