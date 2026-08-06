// ════════════════════════════════════════════════════════════════════════════
//  useClientFinance — single live source for the mobile /client finance hub.
//
//  Mirrors apps/web/src/lib/data/clientFinance.ts EXACTLY so web and mobile
//  show the same numbers:
//    • metrics      — total spend YTD, paid-out YTD, active/completed counts.
//    • escrowCredit — PREPAY escrow held vs NET-TERMS credit (drawn/limit/
//                     available + invoiced-due subset).
//    • recentActivity — one row per job, derived from the job ledger.
//
//  All money is integer CENTS (jobs.*_cents bigint; profiles credit limit
//  bigint cents). Single-currency USD. No FX, no SAR, no mock data.
//  GOLDEN_RULE_2: client-side money columns only (client_price_cents) — never
//  inspector payout / platform spread.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

export type PaymentTerms = 'prepay' | 'net_15' | 'net_30' | 'net_45' | 'net_60';

export interface ClientEscrowCredit {
  /** PREPAY cash locked in escrow for active jobs (cents). */
  heldInEscrowCents: number;
  /** Account terms (profiles.client_payment_terms). */
  terms: PaymentTerms;
  /** Approved credit ceiling (cents). 0 = prepay-only. */
  creditLimitCents: number;
  /** Drawn credit: committed, unsettled net-terms jobs (cents). */
  creditUsedCents: number;
  /** Remaining headroom = max(0, limit − used) (cents). */
  creditAvailableCents: number;
  /** Invoiced & payable subset: delivered (admin_confirmed) + unsettled (cents). */
  netTermsDueCents: number;
}

export interface ClientFinanceMetrics {
  /** Sum of client_price_cents for completed jobs YTD. */
  totalSpendYtdCents: number;
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
  occurredAt: string;
  jobStatus: string;
  payoutStatus: string | null;
}

export interface ClientFinance {
  metrics: ClientFinanceMetrics;
  escrowCredit: ClientEscrowCredit;
  recentActivity: FinanceActivityRow[];
}

interface UseClientFinanceReturn extends ClientFinance {
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_ESCROW_CREDIT: ClientEscrowCredit = {
  heldInEscrowCents: 0,
  terms: 'prepay',
  creditLimitCents: 0,
  creditUsedCents: 0,
  creditAvailableCents: 0,
  netTermsDueCents: 0,
};

const EMPTY_METRICS: ClientFinanceMetrics = {
  totalSpendYtdCents: 0,
  paidOutYtdCents: 0,
  completedJobsYtd: 0,
  activeJobsCount: 0,
};

const EMPTY: ClientFinance = {
  metrics: EMPTY_METRICS,
  escrowCredit: EMPTY_ESCROW_CREDIT,
  recentActivity: [],
};

const VALID_TERMS: readonly PaymentTerms[] = [
  'prepay', 'net_15', 'net_30', 'net_45', 'net_60',
];
function normalizeTerms(v: unknown): PaymentTerms {
  return VALID_TERMS.includes(v as PaymentTerms) ? (v as PaymentTerms) : 'prepay';
}
function parseCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Math.trunc(n as number) : 0;
}

export function useClientFinance(): UseClientFinanceReturn {
  const { user } = useAuth();
  const [data, setData] = useState<ClientFinance>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(
    async (showRefresh = false) => {
      if (!user?.id) {
        setData(EMPTY);
        setIsLoading(false);
        return;
      }
      try {
        if (showRefresh) setIsRefreshing(true);
        else setIsLoading(true);

        const [jobsRes, profRes] = await Promise.all([
          supabase
            .from('jobs_secure_view')
            .select(
              'id, title, status, client_price_cents, payout_status, payment_mode, escrow_status, client_settled_at, admin_confirmed_at, payout_paid_at, created_at, updated_at',
            )
            .eq('client_id', user.id)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false }),
          supabase
            .from('profiles')
            .select('client_payment_terms, client_credit_limit_cents')
            .eq('id', user.id)
            .maybeSingle(),
        ]);

        const jobs = (jobsRes.data ?? []) as Record<string, unknown>[];
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

        // Escrow / credit buckets
        let heldInEscrowCents = 0;
        let creditUsedCents = 0;
        let netTermsDueCents = 0;
        // Metrics
        let totalSpendYtdCents = 0;
        let paidOutYtdCents = 0;
        let completedJobsYtd = 0;
        let activeJobsCount = 0;

        const recentActivity: FinanceActivityRow[] = [];

        for (const j of jobs) {
          const price = parseCents(j.client_price_cents as number | string | null);
          const status = String(j.status ?? '');
          const updatedAt = String(j.updated_at ?? j.created_at ?? '');
          const payoutStatus = (j.payout_status as string | null) ?? null;
          const adminConfirmedAt = (j.admin_confirmed_at as string | null) ?? null;
          const payoutPaidAt = (j.payout_paid_at as string | null) ?? null;

          const isNetTerms = String(j.payment_mode ?? 'prepay') === 'net_terms';
          const escrowStatus = String(j.escrow_status ?? '');
          const settled = j.client_settled_at != null;
          const isActive = status === 'assigned' || status === 'in_progress';
          const isCommitted = isActive || status === 'completed';

          // Escrow + credit
          if (
            !isNetTerms &&
            isActive &&
            escrowStatus !== 'released' &&
            escrowStatus !== 'refunded'
          ) {
            heldInEscrowCents += price;
          }
          if (isNetTerms && isCommitted && !settled) {
            creditUsedCents += price;
            if (adminConfirmedAt != null) netTermsDueCents += price;
          }

          // Metrics
          if (status === 'open' || isActive) activeJobsCount += 1;
          if (status === 'completed' && updatedAt >= yearStart) {
            completedJobsYtd += 1;
            totalSpendYtdCents += price;
          }
          if (payoutStatus === 'paid' && payoutPaidAt && payoutPaidAt >= yearStart) {
            paidOutYtdCents += price;
          }

          // Activity — most recent meaningful event per job
          const kind: FinanceActivityKind =
            payoutStatus === 'paid'
              ? 'payout_released'
              : status === 'completed'
                ? 'job_completed'
                : adminConfirmedAt
                  ? 'report_received'
                  : isActive
                    ? 'job_assigned'
                    : 'job_posted';
          const occurredAt =
            kind === 'payout_released'
              ? payoutPaidAt ?? updatedAt
              : kind === 'report_received'
                ? adminConfirmedAt ?? updatedAt
                : updatedAt;

          recentActivity.push({
            jobId: String(j.id),
            jobTitle: String(j.title ?? '(untitled)'),
            kind,
            amountCents: price > 0 ? price : null,
            occurredAt,
            jobStatus: status,
            payoutStatus,
          });
        }

        recentActivity.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

        const prof = profRes.data as Record<string, unknown> | null;
        const creditLimitCents = parseCents(
          prof?.client_credit_limit_cents as number | string | null,
        );

        setData({
          metrics: {
            totalSpendYtdCents,
            paidOutYtdCents,
            completedJobsYtd,
            activeJobsCount,
          },
          escrowCredit: {
            heldInEscrowCents,
            terms: normalizeTerms(prof?.client_payment_terms),
            creditLimitCents,
            creditUsedCents,
            creditAvailableCents: Math.max(0, creditLimitCents - creditUsedCents),
            netTermsDueCents,
          },
          recentActivity: recentActivity.slice(0, 25),
        });
      } catch (err) {
        console.error('❌ useClientFinance:', err);
        setData(EMPTY);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    ...data,
    isLoading,
    isRefreshing,
    refresh: () => fetchData(true),
  };
}
