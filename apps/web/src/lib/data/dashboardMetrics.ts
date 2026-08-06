// ════════════════════════════════════════════════════════════════════════════
//  lib/data/dashboardMetrics.ts — admin dashboard live counts.
//
//  Five small, independent fetches. Run in parallel; any individual
//  failure degrades to `null` rather than blocking the whole dashboard.
//  RLS for super_admin grants SELECT on jobs / audit_events, so these
//  reads return platform-wide totals when called from the admin shell.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface DashboardMetrics {
  activeJobs: number | null;
  escrowCents: number | null;
  openDisputes: number | null;
  inspectorsActive: number | null;
  /** Critical audit events in the last 24 hours. */
  criticalLast24h: number | null;
  /** Jobs completed in the last 7 days. */
  completedLast7d: number | null;
}

async function safeCount(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  build: (q: ReturnType<typeof supabase.from>) => Promise<{ count: number | null; error: unknown }>,
  table: string,
): Promise<number | null> {
  try {
    const q = supabase.from(table);
    const { count, error } = await build(q);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = await createSupabaseServerClient();

  const [
    activeJobs,
    escrow,
    openDisputes,
    inspectorsActiveRow,
    criticalLast24h,
    completedLast7d,
  ] = await Promise.all([
    // Active jobs.
    safeCount(
      supabase,
      async (q) =>
        await q.select('id', { count: 'exact', head: true }).in('status', [
          'assigned',
          'in_progress',
        ]),
      'jobs',
    ),

    // Escrow held — sum aggregate. We do a small aggregate query.
    (async () => {
      try {
        const { data, error } = await supabase
          .from('jobs_secure_view')
          .select('client_price_cents')
          .in('status', ['assigned', 'in_progress'])
          .not('client_price_cents', 'is', null);
        if (error || !data) return null;
        return data.reduce(
          (sum, row) => sum + (row.client_price_cents ?? 0),
          0,
        );
      } catch {
        return null;
      }
    })(),

    // Open disputes.
    safeCount(
      supabase,
      async (q) =>
        await q.select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
      'jobs',
    ),

    // Inspectors currently working a job. Distinct contractor_id across
    // in_progress jobs. Postgrest doesn't do DISTINCT directly via the
    // builder, so we fetch the column and dedupe client-side. Small set.
    (async () => {
      try {
        const { data, error } = await supabase
          .from('jobs')
          .select('contractor_id')
          .eq('status', 'in_progress')
          .not('contractor_id', 'is', null);
        if (error || !data) return null;
        const unique = new Set<string>();
        for (const r of data) {
          if (r.contractor_id) unique.add(r.contractor_id as string);
        }
        return unique.size;
      } catch {
        return null;
      }
    })(),

    // Critical audit events in the last 24h.
    safeCount(
      supabase,
      async (q) => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        return await q
          .select('id', { count: 'exact', head: true })
          .eq('severity', 'critical')
          .gte('created_at', since);
      },
      'audit_events',
    ),

    // Jobs completed in the last 7 days.
    safeCount(
      supabase,
      async (q) => {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        return await q
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('updated_at', since);
      },
      'jobs',
    ),
  ]);

  return {
    activeJobs,
    escrowCents: typeof escrow === 'number' ? escrow : null,
    openDisputes,
    inspectorsActive: inspectorsActiveRow,
    criticalLast24h,
    completedLast7d,
  };
}
