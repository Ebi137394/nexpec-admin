// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientDashboardMetrics.ts — metric tiles for client home
//
//  GOLDEN_RULE_2 — client-side projection only.
//  Uses client_price_cents (client's own number) for the escrow tile.
//  NEVER projects inspector_payout_cents / platform_spread_cents.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ClientDashboardMetrics {
  activeJobs: number;
  escrowHeldCents: number;
  pendingApplications: number;
  reportsLast30d: number;
}

const EMPTY: ClientDashboardMetrics = {
  activeJobs: 0,
  escrowHeldCents: 0,
  pendingApplications: 0,
  reportsLast30d: 0,
};

export async function fetchClientDashboardMetrics(): Promise<ClientDashboardMetrics> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY;

    // 1. All non-deleted jobs owned by this client.
    //    Strict projection — no inspector_payout_cents in this SELECT.
    const { data: jobs, error: jobsErr } = await supabase
      .from('jobs_secure_view')
      .select('id, status, client_price_cents, admin_confirmed_at')
      .eq('client_id', user.id)
      .is('deleted_at', null);

    if (jobsErr) {
      console.warn('[clientDashboardMetrics] jobs query failed:', jobsErr.message);
      return EMPTY;
    }

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    let activeJobs = 0;
    let escrowHeldCents = 0;
    let reportsLast30d = 0;
    const jobIds: string[] = [];

    for (const job of jobs ?? []) {
      const j = job as unknown as Record<string, unknown>;
      const status = String(j.status ?? '');
      const id = String(j.id);
      jobIds.push(id);

      // "Active" = anything not closed-out.
      if (
        status === 'open' ||
        status === 'assigned' ||
        status === 'in_progress'
      ) {
        activeJobs += 1;
      }

      // "Held in escrow" = jobs in the working-state band (after admin
      // dispatches, before they're paid out).
      if (status === 'assigned' || status === 'in_progress') {
        escrowHeldCents += parseCents(
          (j.client_price_cents as number | string | null) ?? null,
        );
      }

      // Reports admin handed off in the last 30 days.
      const handoff = j.admin_confirmed_at as string | null;
      if (handoff && handoff >= thirtyDaysAgo) {
        reportsLast30d += 1;
      }
    }

    // 2. Pending applications across this client's jobs.
    //    "Pending review" = pending + shortlisted. CLIENT_SELECTED already
    //    means the client decided; it's awaiting admin dispatch, not the
    //    client.
    let pendingApplications = 0;
    if (jobIds.length > 0) {
      const { count, error: appsErr } = await supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .in('job_id', jobIds)
        .in('status', ['pending', 'shortlisted'])
        .is('deleted_at', null);
      if (appsErr) {
        console.warn(
          '[clientDashboardMetrics] applications count failed:',
          appsErr.message,
        );
      } else {
        pendingApplications = count ?? 0;
      }
    }

    return {
      activeJobs,
      escrowHeldCents,
      pendingApplications,
      reportsLast30d,
    };
  } catch (e) {
    console.warn('[clientDashboardMetrics] threw:', e);
    return EMPTY;
  }
}

function parseCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
