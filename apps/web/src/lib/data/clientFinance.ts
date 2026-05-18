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
  ClientFinance,
  ClientFinanceMetrics,
  FinanceActivityKind,
  FinanceActivityRow,
} from './clientFinance.types';

export type {
  ClientFinance,
  ClientFinanceMetrics,
  FinanceActivityRow,
};

const EMPTY: ClientFinance = {
  metrics: {
    totalSpendYtdCents: 0,
    heldInEscrowCents: 0,
    paidOutYtdCents: 0,
    completedJobsYtd: 0,
    activeJobsCount: 0,
  },
  recentActivity: [],
};

export async function fetchClientFinance(): Promise<ClientFinance> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY;

    // STRICT projection — client-side money columns only.
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select(
        [
          'id',
          'title',
          'status',
          'client_price_cents',
          'payout_status',
          'created_at',
          'updated_at',
          'admin_confirmed_at',
          'payout_paid_at',
        ].join(', '),
      )
      .eq('client_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

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

    const activity: FinanceActivityRow[] = [];

    for (const job of jobs) {
      const j = job as unknown as Record<string, unknown>;
      const status = String(j.status ?? '');
      const price = parseCents(
        (j.client_price_cents as number | string | null) ?? null,
      );
      const updatedAt = String(j.updated_at ?? j.created_at ?? '');

      // Metrics
      if (
        status === 'open' ||
        status === 'assigned' ||
        status === 'in_progress'
      ) {
        activeJobsCount += 1;
      }
      if (status === 'assigned' || status === 'in_progress') {
        heldInEscrowCents += price;
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

    return {
      metrics: {
        totalSpendYtdCents,
        heldInEscrowCents,
        paidOutYtdCents,
        completedJobsYtd,
        activeJobsCount,
      },
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
