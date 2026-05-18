// ════════════════════════════════════════════════════════════════════════════
//  lib/data/audit.ts — Server-side reads against `audit_events`.
//
//  RLS enforces the access contract: super_admin sees everything, parties
//  see their own job's events. Web admin reads run as super_admin because
//  middleware + layout gates this surface to that role.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  AuditSeverity,
  AuditEvent,
  AuditPageResult,
  AuditQuery,
} from './audit.types';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './audit.types';

export type { AuditSeverity, AuditEvent, AuditPageResult, AuditQuery };
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

/**
 * Paged read of audit_events. RLS does the gate; this function only shapes
 * pagination, filters, and ordering.
 */
export async function fetchAuditPage(query: AuditQuery = {}): Promise<AuditPageResult> {
  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from('audit_events')
    .select(
      'id, created_at, event_type, severity, actor_id, actor_role, actor_label, subject_table, subject_id, job_id, summary, delta, metadata, correlation_id',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.eventType) q = q.eq('event_type', query.eventType);
  if (query.severity) q = q.eq('severity', query.severity);
  if (query.correlationId) q = q.eq('correlation_id', query.correlationId);
  if (query.jobId) q = q.eq('job_id', query.jobId);

  const { data, count, error } = await q;

  if (error) {
    if (typeof console !== 'undefined') {
      console.warn('[audit] fetchAuditPage failed:', error.message);
    }
    return {
      events: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    };
  }

  const total = count ?? 0;
  return {
    events: (data ?? []) as AuditEvent[],
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

/** Fetch one event by id. Returns null if not visible / not found. */
export async function fetchAuditEvent(id: string): Promise<AuditEvent | null> {
  if (!id) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select(
      'id, created_at, event_type, severity, actor_id, actor_role, actor_label, subject_table, subject_id, job_id, summary, delta, metadata, correlation_id',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data as AuditEvent;
}

/**
 * Distinct event_type values for the filter dropdown. Capped at 100 — the
 * audit trail's classification grammar is small (we have ~20-30 known
 * types) so 100 is comfortable headroom.
 */
export async function fetchDistinctEventTypes(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select('event_type')
    .order('event_type')
    .limit(500);

  if (error || !data) return [];
  const unique = new Set<string>();
  for (const row of data) {
    if (typeof row.event_type === 'string') unique.add(row.event_type);
  }
  return Array.from(unique).sort();
}
