// ════════════════════════════════════════════════════════════════════════════
//  lib/services/aiops/core.ts — shared query grammar for every AI-Ops service
//  and API route: pagination, sorting, search, date-ranges, and column filters
//  applied uniformly to Supabase queries. One implementation ⇒ every future
//  dashboard gets identical semantics for free.
// ════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ListQuery {
  page?: number;          // 1-based
  pageSize?: number;      // default 25, max 200
  sort?: string;          // column
  dir?: 'asc' | 'desc';
  search?: string;        // ilike on searchable columns
  from?: string;          // ISO date — created_at >= from
  to?: string;            // ISO date — created_at <= to
  /** Exact-match column filters, validated against an allowlist. */
  filters?: Record<string, string>;
}

export interface ListResult<T = Record<string, unknown>> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ResourceSpec {
  table: string;
  /** Columns callers may sort/filter on (allowlist — never raw user input). */
  columns: readonly string[];
  searchColumns?: readonly string[];
  defaultSort?: string;
  dateColumn?: string; // default 'created_at'
}

const MAX_PAGE_SIZE = 200;

/** Parse a URLSearchParams into a ListQuery (route-side). */
export function parseListQuery(sp: URLSearchParams, spec: ResourceSpec): ListQuery {
  const filters: Record<string, string> = {};
  for (const col of spec.columns) {
    const v = sp.get(`f.${col}`);
    if (v != null && v !== '') filters[col] = v;
  }
  return {
    page: Math.max(1, Number(sp.get('page') ?? '1') || 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get('pageSize') ?? '25') || 25)),
    sort: sp.get('sort') ?? undefined,
    dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
    search: sp.get('search') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    filters,
  };
}

/** Run a validated, paginated list against a table. */
export async function listResource<T = Record<string, unknown>>(
  sb: SupabaseClient,
  spec: ResourceSpec,
  q: ListQuery,
): Promise<ListResult<T>> {
  const page = q.page ?? 1;
  const pageSize = Math.min(q.pageSize ?? 25, MAX_PAGE_SIZE);
  const dateCol = spec.dateColumn ?? 'created_at';

  let query = sb.from(spec.table).select('*', { count: 'exact' });
  for (const [col, v] of Object.entries(q.filters ?? {})) {
    if (spec.columns.includes(col)) query = query.eq(col, v);
  }
  if (q.from) query = query.gte(dateCol, q.from);
  if (q.to) query = query.lte(dateCol, q.to);
  if (q.search && spec.searchColumns?.length) {
    query = query.or(spec.searchColumns.map((c) => `${c}.ilike.%${q.search!.replace(/[%,()]/g, '')}%`).join(','));
  }
  const sortCol = q.sort && spec.columns.includes(q.sort) ? q.sort : (spec.defaultSort ?? dateCol);
  query = query.order(sortCol, { ascending: q.dir === 'asc' })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`aiops:${spec.table}: ${error.message}`);
  return { rows: (data ?? []) as T[], page, pageSize, total: count ?? 0 };
}

/** Defence-in-depth admin gate for services/routes (RLS enforces regardless). */
export async function assertAdmin(sb: SupabaseClient): Promise<void> {
  const { data, error } = await sb.rpc('nx_is_admin');
  if (error || data !== true) throw new Error('AI_OPS_FORBIDDEN: admin only');
}

/** Classify a caught error into a SAFE client response — never leaks internal
 *  DB/stack detail to the browser. The raw error is logged server-side only. */
export function classifyAiOpsError(e: unknown): { status: number; code: 'forbidden' | 'not_provisioned' | 'error'; message: string } {
  const raw = e instanceof Error ? e.message : String(e);
  if (/FORBIDDEN/i.test(raw)) return { status: 403, code: 'forbidden', message: 'You do not have access to this resource.' };
  if (/relation .* does not exist|does not exist|schema cache|could not find the table|not_provisioned|PGRST\d+/i.test(raw)) {
    return { status: 503, code: 'not_provisioned', message: 'The AI Operations backend is not provisioned in this environment yet.' };
  }
  // Unknown/internal error — log the real one, return a generic message.
  console.error('[ai-ops] internal error:', raw);
  return { status: 400, code: 'error', message: 'The request could not be completed. Please try again.' };
}

/** Append an immutable audit row (best-effort; never throws into the caller). */
export async function audit(
  sb: SupabaseClient, action: string, entity: string, entityId?: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  const { data: u } = await sb.auth.getUser();
  await sb.from('ai_audit_history').insert({
    actor_id: u.user?.id ?? null, action, entity,
    entity_id: entityId ?? null, detail: detail ?? {},
  }).then(() => undefined, () => undefined);
}
