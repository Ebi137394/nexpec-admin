// ════════════════════════════════════════════════════════════════════════════
//  useClientEscrowCredit — mobile parity for the web /client/finance
//  "Escrow vs Credit" section.
//
//  Mirrors apps/web/src/lib/data/clientFinance.ts EXACTLY so the two buckets
//  read identically on both platforms:
//    • PREPAY escrow held  = client_price_cents for prepay jobs that are active
//                            and not yet released/refunded (cash actually held).
//    • NET-TERMS credit    = drawn (committed + unsettled) vs limit vs available,
//                            with the invoiced-and-due subset broken out.
//
//  All figures are integer CENTS (jobs.client_price_cents is bigint cents;
//  profiles.client_credit_limit_cents is bigint cents). No FX, no dollar math.
//  GOLDEN_RULE_2: client-side money columns only — never inspector payout/spread.
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

interface UseClientEscrowCreditReturn {
  data: ClientEscrowCredit;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

const EMPTY: ClientEscrowCredit = {
  heldInEscrowCents: 0,
  terms: 'prepay',
  creditLimitCents: 0,
  creditUsedCents: 0,
  creditAvailableCents: 0,
  netTermsDueCents: 0,
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

export function useClientEscrowCredit(): UseClientEscrowCreditReturn {
  const { user } = useAuth();
  const [data, setData] = useState<ClientEscrowCredit>(EMPTY);
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
            .from('jobs')
            .select(
              'client_price_cents, status, payment_mode, escrow_status, client_settled_at, admin_confirmed_at',
            )
            .eq('client_id', user.id)
            .is('deleted_at', null),
          supabase
            .from('profiles')
            .select('client_payment_terms, client_credit_limit_cents')
            .eq('id', user.id)
            .maybeSingle(),
        ]);

        const jobs = (jobsRes.data ?? []) as Record<string, unknown>[];

        let heldInEscrowCents = 0;
        let creditUsedCents = 0;
        let netTermsDueCents = 0;

        for (const j of jobs) {
          const price = parseCents(j.client_price_cents as number | string | null);
          const status = String(j.status ?? '');
          const isNetTerms = String(j.payment_mode ?? 'prepay') === 'net_terms';
          const escrowStatus = String(j.escrow_status ?? '');
          const settled = j.client_settled_at != null;
          const isActive = status === 'assigned' || status === 'in_progress';
          const isCommitted = isActive || status === 'completed';

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
            if (j.admin_confirmed_at != null) netTermsDueCents += price;
          }
        }

        const prof = profRes.data as Record<string, unknown> | null;
        const creditLimitCents = parseCents(
          prof?.client_credit_limit_cents as number | string | null,
        );

        setData({
          heldInEscrowCents,
          terms: normalizeTerms(prof?.client_payment_terms),
          creditLimitCents,
          creditUsedCents,
          creditAvailableCents: Math.max(0, creditLimitCents - creditUsedCents),
          netTermsDueCents,
        });
      } catch (err) {
        console.error('❌ useClientEscrowCredit:', err);
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
    data,
    isLoading,
    isRefreshing,
    refresh: () => fetchData(true),
  };
}
