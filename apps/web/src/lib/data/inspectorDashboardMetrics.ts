// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorDashboardMetrics.ts — metric tiles for inspector home
//
//  Two-query pattern (mirrors dispatchQueue.ts): pull the inspector's
//  hired-application job_ids first, then fetch the corresponding jobs
//  rows for aggregation. Reports/30d is a separate cheap COUNT.
//
//  GOLDEN_RULE_2 — payout fields only. NEVER project client_price_cents
//  / budget_cents / spread.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface InspectorDashboardMetrics {
  activeAssignments: number;
  earningsYtdCents: number;
  pendingPayoutCents: number;
  reportsLast30d: number;
}

const EMPTY: InspectorDashboardMetrics = {
  activeAssignments: 0,
  earningsYtdCents: 0,
  pendingPayoutCents: 0,
  reportsLast30d: 0,
};

export async function fetchInspectorDashboardMetrics(): Promise<InspectorDashboardMetrics> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY;

    // 1. Hired applications by this inspector.
    const { data: apps, error: appsErr } = await supabase
      .from('applications')
      .select('job_id')
      .eq('applicant_id', user.id)
      .in('status', ['hired', 'accepted'])
      .is('deleted_at', null);

    if (appsErr) {
      console.warn('[inspectorDashboardMetrics] apps query failed:', appsErr.message);
      return EMPTY;
    }

    const jobIds = (apps ?? [])
      .map((a) => (a as unknown as Record<string, unknown>).job_id as string)
      .filter(Boolean);

    let activeAssignments = 0;
    let earningsYtdCents = 0;
    let pendingPayoutCents = 0;

    if (jobIds.length > 0) {
      // 2. Jobs — GOLDEN_RULE_2 — only payout columns + status / payout_paid_at.
      const { data: jobs, error: jobsErr } = await supabase
        // ★ 20260801318000 — payout revoked on the base table. These ids come
        //   from the caller's own applications → inspector view covers them.
        .from('jobs_inspector_secure_view')
        .select(
          'id, status, inspector_payout_cents, payout_amount_cents, payout_status, payout_paid_at',
        )
        .in('id', jobIds)
        .is('deleted_at', null);

      if (jobsErr) {
        console.warn('[inspectorDashboardMetrics] jobs query failed:', jobsErr.message);
      } else {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        for (const job of jobs ?? []) {
          const j = job as unknown as Record<string, unknown>;
          const status = String(j.status ?? '');
          const payout = parseCents(
            (j.inspector_payout_cents as number | string | null) ??
              (j.payout_amount_cents as number | string | null),
          );

          if (status === 'assigned' || status === 'in_progress') {
            activeAssignments += 1;
          }

          const paidAt = j.payout_paid_at as string | null;
          if (
            j.payout_status === 'paid' &&
            paidAt &&
            paidAt >= yearStart
          ) {
            earningsYtdCents += payout;
          }

          if (status === 'completed' && j.payout_status !== 'paid') {
            pendingPayoutCents += payout;
          }
        }
      }
    }

    // 3. Reports last 30d — separate COUNT for cheapness.
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    let reportsLast30d = 0;
    const { count, error: reportErr } = await supabase
      .from('inspection_reports')
      .select('id', { count: 'exact', head: true })
      .eq('inspector_id', user.id)
      .gte('created_at', thirtyDaysAgo)
      .is('deleted_at', null);
    if (reportErr) {
      console.warn('[inspectorDashboardMetrics] reports count failed:', reportErr.message);
    } else {
      reportsLast30d = count ?? 0;
    }

    return {
      activeAssignments,
      earningsYtdCents,
      pendingPayoutCents,
      reportsLast30d,
    };
  } catch (e) {
    console.warn('[inspectorDashboardMetrics] threw:', e);
    return EMPTY;
  }
}

function parseCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
