// ============================================================================
// EARNINGS TYPES — Strict interfaces for all fintech data shapes
// ============================================================================

export interface EarningsRecord {
  id: string;
  inspector_id: string;
  available_balance_cents: number;
  pending_cents: number;
  total_earned_cents: number;
  ytd_gross_cents: number;
  referral_code: string;
  updated_at: string;
}

export interface EarningsTransaction {
  id: string;
  inspector_id: string;
  job_id: string | null;
  description: string | null;
  gross_amount_cents: number;
  platform_fee_cents: number;
  net_amount_cents: number;           // generated column in DB
  status: 'paid' | 'processing' | 'pending' | 'failed';
  created_at: string;
  job?: {
    id: string;
    title: string;
    job_code: string | null;
    client?: { full_name: string } | null;
  } | null;
}

export interface DailyEarning {
  day: string;                           // ISO date "2026-02-17"
  day_label: string;                     // "Mon", "Tue", ...
  net_cents: number;
}

export interface IncomeBreakdown {
  gross_cents: number;
  platform_fee_cents: number;
  net_cents: number;
  fee_rate: number;                      // decimal — e.g. 0.15 for 15%
}

export interface WorkSession {
  id: string;
  inspector_id: string;
  job_id: string | null;
  started_at: string;                    // ISO timestamptz
  ended_at: string | null;
  created_at: string;
}

// ─── Full hook return type ────────────────────────────────────────────────────

export interface UseEarningsReturn {
  // Wallet balances
  availableBalanceCents: number;
  pendingCents: number;
  totalEarnedCents: number;
  balanceProgressPct: number;             // 0–100 for circular chart

  // Monthly breakdown
  monthlyBreakdown: IncomeBreakdown;

  // Weekly bar chart
  weeklyEarnings: DailyEarning[];
  maxWeeklyCents: number;
  weeklyTotalCents: number;

  // Transaction history (replaces demo "Sarah Mitchell" sessions)
  transactions: EarningsTransaction[];

  // Tax
  ytdGrossCents: number;
  taxEstimateCents: number;

  // Work timer
  activeSession: WorkSession | null;
  sessionElapsedSeconds: number;
  effectiveHourlyRateCents: number;
  startWork: (jobId?: string) => Promise<void>;
  stopWork: () => Promise<void>;

  // Meta
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
