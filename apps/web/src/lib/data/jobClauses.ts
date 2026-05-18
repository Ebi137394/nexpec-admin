// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobClauses.ts — fetchers
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClauseAcceptance,
  ClauseKind,
  JobClause,
} from './jobClauses.types';

export type { JobClause, ClauseAcceptance };

export async function fetchJobClauses(jobId: string): Promise<JobClause[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('job_clauses')
      .select('id, job_id, kind, title, body, is_required, sort_order, created_at, updated_at')
      .eq('job_id', jobId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      kind: ((r.kind as string | null) ?? 'other') as ClauseKind,
      title: String(r.title ?? ''),
      body: String(r.body ?? ''),
      isRequired: Boolean(r.is_required),
      sortOrder: typeof r.sort_order === 'number' ? r.sort_order : 0,
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    }));
  } catch {
    return [];
  }
}

/** Caller's acceptances across the supplied clause ids. */
export async function fetchMyAcceptances(
  clauseIds: string[],
): Promise<ClauseAcceptance[]> {
  if (clauseIds.length === 0) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('clause_acceptances')
      .select('id, clause_id, acceptor_id, accepted_at')
      .eq('acceptor_id', user.id)
      .in('clause_id', clauseIds);
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      clauseId: String(r.clause_id),
      acceptorId: String(r.acceptor_id),
      acceptedAt: String(r.accepted_at ?? ''),
    }));
  } catch {
    return [];
  }
}
