// ════════════════════════════════════════════════════════════════════════════
//  lib/data/disputes.ts — fetchers
//
//  ── WHY THIS FILE WAS REWRITTEN ────────────────────────────────────────────
//  It read `public.disputes` with a column vocabulary that exists on NO table
//  in this database:
//
//      .from('disputes')
//      .select('id, job_id, opener_id, opener_role, category, body, status,
//               resolution, resolved_at, resolved_by, created_at, updated_at,
//               jobs(title)')
//      .eq('opener_id', user.id)
//
//  Three separate things were wrong.
//
//  1. WRONG TABLE. The canonical dispute table is public.job_disputes. That is
//     what file_dispute() writes to, what flag_job_dispute() writes to, what
//     resolve_job_dispute() resolves, and what carries the RLS policies
//     (job_disputes_parties_read, job_disputes_admin_read,
//     job_disputes_no_writes, hide_soft_deleted). public.disputes is a
//     vestigial table with a different shape again (project_id, priority,
//     metadata, report_url) that nothing writes.
//  2. WRONG COLUMNS. job_disputes uses raised_by / reason_category / reason /
//     resolution_notes. opener_id, opener_role, category and body exist
//     nowhere. Even disputes.types.ts already said the vocabulary "mirrors the
//     job_disputes reason_category check constraint" — the fetcher simply never
//     matched its own type file.
//  3. THE ERROR WAS SWALLOWED. `if (error || !data) return [];` turned a failed
//     request into an empty list, so /client/disputes and /inspector/disputes
//     rendered "No disputes filed." forever. PostgREST answered
//     "Could not find a relationship between 'disputes' and 'jobs' in the
//     schema cache" on every single call and no user or log ever saw it.
//
//  A page that renders an empty state when the query actually failed is worse
//  than a page that errors: it looks like an answer. These fetchers therefore
//  return { rows, error } and the pages render an explicit failure banner.
//
//  ── STATUS VOCABULARY ──────────────────────────────────────────────────────
//  job_disputes_status_check admits exactly: open, resolved_paid,
//  resolved_refunded. The old DisputeStatus union invented
//  investigating/rejected/closed, so every status filter matched nothing.
//  disputes.types.ts now mirrors the constraint.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  DisputeCategory,
  DisputeRow,
  DisputeStatus,
  DisputesResult,
} from './disputes.types';

export type { DisputeRow };

/**
 * Columns as they actually exist on public.job_disputes.
 *
 * The two embedded resources are disambiguated by constraint name because
 * job_disputes has TWO foreign keys into profiles (raised_by and resolved_by);
 * an unqualified `profiles(role)` is ambiguous and PostgREST rejects it.
 */
const DISPUTE_SELECT =
  'id, job_id, raised_by, reason_category, reason, status, resolution_notes, ' +
  'resolved_at, resolved_by, created_at, updated_at, ' +
  'jobs(title), raiser:profiles!job_disputes_raised_by_fkey(role)';

export async function fetchMyDisputes(): Promise<DisputesResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { rows: [], error: null };

  const { data, error } = await supabase
    .from('job_disputes')
    .select(DISPUTE_SELECT)
    .eq('raised_by', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    // Loud, and surfaced to the caller. Never rewritten as an empty list.
    console.error('[disputes] fetchMyDisputes failed:', error.message, error.code);
    return { rows: [], error: error.message || 'Could not load disputes.' };
  }
  return { rows: (data ?? []).map(toRow), error: null };
}

export async function fetchAdminDisputes(
  status?: DisputeStatus | 'all',
): Promise<DisputesResult> {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from('job_disputes')
    .select(DISPUTE_SELECT)
    .order('created_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    console.error('[disputes] fetchAdminDisputes failed:', error.message, error.code);
    return { rows: [], error: error.message || 'Could not load disputes.' };
  }
  return { rows: (data ?? []).map(toRow), error: null };
}

function toRow(raw: unknown): DisputeRow {
  const r = raw as Record<string, unknown>;
  const jobJoin = (r.jobs ?? null) as { title?: string | null } | null;
  const raiser = (r.raiser ?? null) as { role?: string | null } | null;

  // openerRole is presentational only. job_disputes has no such column, so it
  // is derived from the raiser's profile role rather than invented.
  const rawRole = (raiser?.role ?? '') as string;
  const openerRole: DisputeRow['openerRole'] =
    rawRole === 'inspector' || rawRole === 'agency' || rawRole === 'enterprise'
      ? rawRole
      : 'client';

  return {
    id: String(r.id),
    jobId: String(r.job_id),
    jobTitle: jobJoin?.title ?? null,
    openerId: String(r.raised_by ?? ''),
    openerRole,
    category: ((r.reason_category as string | null) ?? 'other') as DisputeCategory,
    body: String(r.reason ?? ''),
    status: ((r.status as string | null) ?? 'open') as DisputeStatus,
    resolution: (r.resolution_notes as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  };
}
