// ════════════════════════════════════════════════════════════════════════════
//  lib/data/audit.types.ts — type-only module. Safe for Client Components.
// ════════════════════════════════════════════════════════════════════════════

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: AuditSeverity;
  actor_id: string | null;
  actor_role: string | null;
  actor_label: string | null;
  subject_table: string;
  subject_id: string;
  job_id: string | null;
  summary: string;
  delta: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  } | null;
  metadata: Record<string, unknown> | null;
  correlation_id: string | null;
}

export interface AuditPageResult {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  eventType?: string;
  severity?: AuditSeverity;
  correlationId?: string;
  jobId?: string;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
