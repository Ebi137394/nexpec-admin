// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientFinance.ts — finance dashboard data
//
//  Single-query derivation from public.jobs. No separate invoices /
//  transactions / payment_methods tables exist on the live schema, so
//  the dashboard is built around the client's job ledger.
//
//  GOLDEN_RULE_2 — projection limited to client-side money columns
//  (client_price_cents). Never inspector_payout_cents or spread.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClientCreditProfile,
  ClientFinance,
  ClientFinanceMetrics,
  FinanceActivityKind,
  FinanceActivityRow,
  PaymentTerms,
} from './clientFinance.types';

export type {
  ClientCreditProfile,
  ClientFinance,
  ClientFinanceMetrics,
  FinanceActivityRow,
  PaymentTerms,
};

const EMPTY_CREDIT: ClientCreditProfile = {
  terms: 'prepay',
  creditLimitCents: 0,
  creditUsedCents: 0,
  creditAvailableCents: 0,
  netTermsDueCents: 0,
};

const EMPTY: ClientFinance = {
  metrics: {
    totalSpendYtdCents: 0,
    heldInEscrowCents: 0,
    paidOutYtdCents: 0,
    completedJobsYtd: 0,
    activeJobsCount: 0,
  },
  credit: EMPTY_CREDIT,
  recentActivity: [],
};

const VALID_TERMS: readonly PaymentTerms[] = [
  'prepay', 'net_15', 'net_30', 'net_45', 'net_60',
];
function normalizeTerms(v: unknown): PaymentTerms {
  return VALID_TERMS.includes(v as PaymentTerms) ? (v as PaymentTerms) : 'prepay';
}

export async function fetchClientFinance(): Promise<ClientFinance> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY;

    // Credit posture lives on the profile (Net-30/60 trade terms + ceiling).
    // Read it alongside the job ledger; default to prepay if the row is absent.
    const [{ data: jobs, error }, { data: prof }] = await Promise.all([
      supabase
        // PRIVILEGE (20260801312000): client_price_cents was REVOKED from the
        // `authenticated` role on public.jobs. Selecting it off the base table
        // fails the WHOLE query with "permission denied for column", which this
        // fetcher swallows into EMPTY — the finance page then rendered $0 spend,
        // $0 held, $0 paid out and "No financial activity yet" for every client.
        // Buyers read pricing through the row-gated jobs_secure_view
        // (client_id = auth.uid() OR agency_id = auth.uid() OR nx_is_admin());
        // the explicit .eq('client_id', user.id) below still scopes admins.
        .from('jobs_secure_view')
        .select(
          [
            'id',
            'title',
            'status',
            'client_price_cents',
            'payout_status',
            'payment_mode',
            'escrow_status',
            'client_settled_at',
            'created_at',
            'updated_at',
            'admin_confirmed_at',
            'payout_paid_at',
          ].join(', '),
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

    if (error || !jobs) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchClientFinance] jobs query failed:', error.message);
      }
      return EMPTY;
    }

    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

    let totalSpendYtdCents = 0;
    let heldInEscrowCents = 0;
    let paidOutYtdCents = 0;
    let completedJobsYtd = 0;
    let activeJobsCount = 0;

    // Net-terms credit exposure.
    let creditUsedCents = 0;
    let netTermsDueCents = 0;

    const activity: FinanceActivityRow[] = [];

    for (const job of jobs) {
      const j = job as unknown as Record<string, unknown>;
      const status = String(j.status ?? '');
      const price = parseCents(
        (j.client_price_cents as number | string | null) ?? null,
      );
      const updatedAt = String(j.updated_at ?? j.created_at ?? '');

      // prepay is the default when payment_mode is unset; net_terms is explicit.
      const isNetTerms = String(j.payment_mode ?? 'prepay') === 'net_terms';
      const escrowStatus = String(j.escrow_status ?? '');
      const settled = j.client_settled_at != null;
      const isActive = status === 'assigned' || status === 'in_progress';
      const isCommitted = isActive || status === 'completed';

      // Metrics
      if (
        status === 'open' ||
        status === 'assigned' ||
        status === 'in_progress'
      ) {
        activeJobsCount += 1;
      }
      // PREPAY escrow only: cash the client locked up front, still held.
      if (
        !isNetTerms &&
        isActive &&
        escrowStatus !== 'released' &&
        escrowStatus !== 'refunded'
      ) {
        heldInEscrowCents += price;
      }
      // NET-TERMS credit: drawn exposure (committed, unsettled) + invoiced-due subset.
      if (isNetTerms && isCommitted && !settled) {
        creditUsedCents += price;
        if (j.admin_confirmed_at != null) netTermsDueCents += price;
      }
      if (status === 'completed' && updatedAt >= yearStart) {
        completedJobsYtd += 1;
        totalSpendYtdCents += price;
      }
      const paidAt = j.payout_paid_at as string | null;
      if (
        j.payout_status === 'paid' &&
        paidAt &&
        paidAt >= yearStart
      ) {
        paidOutYtdCents += price;
      }

      // Activity (derive one row per job — most recent meaningful event)
      const kind: FinanceActivityKind | null = (() => {
        if (j.payout_status === 'paid') return 'payout_released';
        if (status === 'completed') return 'job_completed';
        if (j.admin_confirmed_at) return 'report_received';
        if (status === 'assigned' || status === 'in_progress')
          return 'job_assigned';
        return 'job_posted';
      })();

      const occurredAt =
        kind === 'payout_released'
          ? (j.payout_paid_at as string | null) ?? updatedAt
          : kind === 'report_received'
            ? (j.admin_confirmed_at as string | null) ?? updatedAt
            : updatedAt;

      activity.push({
        jobId: String(j.id),
        jobTitle: String(j.title ?? '(untitled)'),
        kind,
        amountCents: price > 0 ? price : null,
        occurredAt,
        jobStatus: status,
        payoutStatus: (j.payout_status as string | null) ?? null,
      });
    }

    activity.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

    const creditLimitCents = parseCents(
      (prof?.client_credit_limit_cents as number | string | null) ?? null,
    );
    const credit: ClientCreditProfile = {
      terms: normalizeTerms(prof?.client_payment_terms),
      creditLimitCents,
      creditUsedCents,
      creditAvailableCents: Math.max(0, creditLimitCents - creditUsedCents),
      netTermsDueCents,
    };

    return {
      metrics: {
        totalSpendYtdCents,
        heldInEscrowCents,
        paidOutYtdCents,
        completedJobsYtd,
        activeJobsCount,
      },
      credit,
      recentActivity: activity.slice(0, 25),
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchClientFinance] threw:', e);
    }
    return EMPTY;
  }
}

function parseCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
