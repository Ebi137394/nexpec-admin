// ════════════════════════════════════════════════════════════════════════════
//  lib/data/disputes.ts — fetchers
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  DisputeCategory,
  DisputeRow,
  DisputeStatus,
} from './disputes.types';

export type { DisputeRow };

export async function fetchMyDisputes(): Promise<DisputeRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('disputes')
      .select(
        'id, job_id, opener_id, opener_role, category, body, status, resolution, resolved_at, resolved_by, created_at, updated_at, jobs(title)',
      )
      .eq('opener_id', user.id)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(toRow);
  } catch {
    return [];
  }
}

export async function fetchAdminDisputes(
  status?: DisputeStatus | 'all',
): Promise<DisputeRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    let q = supabase
      .from('disputes')
      .select(
        'id, job_id, opener_id, opener_role, category, body, status, resolution, resolved_at, resolved_by, created_at, updated_at, jobs(title)',
      )
      .order('created_at', { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(toRow);
  } catch {
    return [];
  }
}

function toRow(r: Record<string, unknown>): DisputeRow {
  const jobJoin = (r.jobs ?? null) as { title?: string | null } | null;
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    jobTitle: jobJoin?.title ?? null,
    openerId: String(r.opener_id),
    openerRole: ((r.opener_role as string | null) ?? 'client') as DisputeRow['openerRole'],
    category: ((r.category as string | null) ?? 'other') as DisputeCategory,
    body: String(r.body ?? ''),
    status: ((r.status as string | null) ?? 'open') as DisputeStatus,
    resolution: (r.resolution as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  };
}
