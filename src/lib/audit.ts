// ════════════════════════════════════════════════════════════════════════════
//  src/lib/audit.ts
//  NEXPEC — Industrial Black Box (Patch 2 / v1)
//
//  Client-side library for the audit_events table + audit_events_public view.
//
//  Exports:
//    • Types mirroring the DB schema (AuditEvent, AuditSeverity, …).
//    • EVENT_TYPE_META taxonomy: maps event_type → { icon, color, category }
//      for consistent UI rendering across every surface.
//    • Severity + time + currency formatters reused by the Timeline + Sheet.
//    • fetchAuditEvents(opts): single read path, switches between the
//      admin-facing table and the metadata-masked view automatically.
//    • withAuditIntent + callAuditedRpc: forward-compatible intent context
//      helpers. v1 caveat noted in JSDoc — see comments inside.
//    • newCorrelationId(): UUID v4, used to group multi-step user actions.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

// ─── TYPES ────────────────────────────────────────────────────────────────

export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditSubjectTable =
  | 'jobs'
  | 'applications'
  | 'contracts'
  | 'payout_requests';

export interface AuditDelta {
  before?: Record<string, any>;
  after?: Record<string, any>;
}

export interface AuditMetadata {
  intent?: string | null;
  op?: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_keys?: string[] | null;
  // Admin-only keys (stripped by audit_events_public view for non-admins):
  ip?: string;
  ua?: string;
  ai_label?: string;
  admin_notes?: string;
  [key: string]: any;
}

/** Mirrors a row of `audit_events` (or its masked view). */
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
  delta: AuditDelta;
  metadata: AuditMetadata;

  correlation_id: string | null;
}

// ─── EVENT-TYPE TAXONOMY (UI METADATA) ────────────────────────────────────
// Single source of truth mapping event_type → icon + color + category.
// Keep this in sync with the trigger function's classification block.

export type EventCategory =
  | 'status'
  | 'pricing'
  | 'hiring'
  | 'money'
  | 'reporting'
  | 'other';

export interface EventTypeMeta {
  category: EventCategory;
  icon: string;          // Ionicons name
  color: string;         // hex (NEXPEC-locked palette)
  label?: string;        // optional override for filter chips
}

export const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  // Job lifecycle
  'job.created':          { category: 'other',     icon: 'add-circle-outline',  color: '#7C3AED' },
  'job.status_changed':   { category: 'status',    icon: 'git-branch-outline',  color: '#3B82F6' },
  'job.completed':        { category: 'status',    icon: 'checkmark-done',      color: '#10B981' },
  'job.price_updated':    { category: 'pricing',   icon: 'pricetag',            color: '#F59E0B' },
  'job.assigned':         { category: 'hiring',    icon: 'person-add',          color: '#7C3AED' },
  'job.unassigned':       { category: 'hiring',    icon: 'person-remove',       color: '#F59E0B' },
  'job.reassigned':       { category: 'hiring',    icon: 'people-circle',       color: '#F59E0B' },
  'job.scheduled':        { category: 'status',    icon: 'calendar',            color: '#06B6D4' },
  'job.updated':          { category: 'other',     icon: 'create-outline',      color: '#94A3B8' },
  'job.deleted':          { category: 'other',     icon: 'trash',               color: '#EF4444' },

  // Applications / hiring
  'applications.created': { category: 'hiring',    icon: 'paper-plane',         color: '#3B82F6' },
  'application.accepted': { category: 'hiring',    icon: 'checkmark-circle',    color: '#10B981' },
  'application.rejected': { category: 'hiring',    icon: 'close-circle',        color: '#EF4444' },
  'application.updated':  { category: 'hiring',    icon: 'create-outline',      color: '#94A3B8' },
  'applications.deleted': { category: 'hiring',    icon: 'trash',               color: '#EF4444' },

  // Contracts
  'contracts.created':    { category: 'reporting', icon: 'document-text',       color: '#3B82F6' },
  'contract.signed':      { category: 'reporting', icon: 'shield-checkmark',    color: '#10B981' },
  'contract.terminated':  { category: 'reporting', icon: 'shield-half',         color: '#EF4444' },
  'contract.updated':     { category: 'reporting', icon: 'create-outline',      color: '#94A3B8' },
  'contracts.deleted':    { category: 'reporting', icon: 'trash',               color: '#EF4444' },

  // Money (payouts)
  'payout_requests.created':  { category: 'money', icon: 'cash-outline',        color: '#3B82F6' },
  'payout_request.approved':  { category: 'money', icon: 'checkmark-circle',    color: '#F59E0B' },
  'payout_request.paid':      { category: 'money', icon: 'cash',                color: '#10B981' },
  'payout_request.failed':    { category: 'money', icon: 'alert-circle',        color: '#EF4444' },
  'payout_request.updated':   { category: 'money', icon: 'create-outline',      color: '#94A3B8' },
  'payout_requests.deleted':  { category: 'money', icon: 'trash',               color: '#EF4444' },
};

const FALLBACK_META: EventTypeMeta = {
  category: 'other',
  icon: 'ellipse',
  color: '#94A3B8',
};

export function getEventTypeMeta(eventType: string): EventTypeMeta {
  return EVENT_TYPE_META[eventType] ?? FALLBACK_META;
}

// Category label + icon used in the filter strip.
export const CATEGORY_META: Record<EventCategory, { label: string; icon: string }> = {
  status:    { label: 'Status',    icon: 'git-branch-outline' },
  pricing:   { label: 'Pricing',   icon: 'pricetag-outline' },
  hiring:    { label: 'Hiring',    icon: 'people-outline' },
  money:     { label: 'Money',     icon: 'cash-outline' },
  reporting: { label: 'Reporting', icon: 'document-text-outline' },
  other:     { label: 'Other',     icon: 'ellipsis-horizontal' },
};

// ─── SEVERITY HELPERS ─────────────────────────────────────────────────────

export interface SeverityMeta {
  label: string;
  color: string;
  bg: string;
}

export function getSeverityMeta(severity: AuditSeverity): SeverityMeta {
  switch (severity) {
    case 'critical':
      return { label: 'Critical', color: '#EF4444', bg: 'rgba(239,68,68,0.14)' };
    case 'warning':
      return { label: 'Warning',  color: '#F59E0B', bg: 'rgba(245,158,11,0.14)' };
    case 'info':
    default:
      return { label: 'Info',     color: '#3B82F6', bg: 'rgba(59,130,246,0.14)' };
  }
}

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function severityAtLeast(value: AuditSeverity, min: AuditSeverity): boolean {
  return SEVERITY_RANK[value] >= SEVERITY_RANK[min];
}

// ─── RELATIVE TIME ────────────────────────────────────────────────────────

export function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 5)   return 'just now';
  if (diffSec < 60)  return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60)      return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)      return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)       return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ─── FIELD-AWARE VALUE FORMATTER (for the diff viewer) ───────────────────
// The diff sheet renders raw column values. Many fields are integers in
// cents or ISO timestamps that look terrible raw. Pretty-print them by
// inspecting the column name suffix.

export function formatFieldValue(key: string, value: any): string {
  if (value === null || value === undefined) return 'null';

  // Cents → USD
  if (typeof value === 'number' && /(_cents|_amount_cents)$/.test(key)) {
    return `$${(value / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // ISO timestamp → human
  if (typeof value === 'string' && /(_at|_date)$/.test(key)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return formatAbsoluteTime(value);
  }

  // Booleans
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  // Strings
  if (typeof value === 'string') return value;

  // Numbers
  if (typeof value === 'number') return value.toString();

  // Objects / arrays
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── CORRELATION-ID GENERATOR ─────────────────────────────────────────────

export function newCorrelationId(): string {
  // RN 0.72+ exposes crypto.randomUUID on iOS/Android; fall back otherwise.
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── INTENT CONTEXT (forward-compatible) ─────────────────────────────────
//
// ⚠ v1 SCOPE LIMITATION
// ─────────────────────
// PostgREST wraps each Supabase REST call in its own transaction. The
// `audit_set_intent` SQL function uses `SET LOCAL`, which is
// transaction-scoped. That means calling audit_set_intent from one REST
// call and then doing a separate .from('table').update() in a different
// REST call will NOT carry intent across — the second call sees its own
// fresh transaction with no GUC.
//
// To capture intent end-to-end, a MUTATION MUST GO THROUGH A
// SERVER-SIDE RPC that calls audit_set_intent at its start. Until those
// wrapper RPCs land in a follow-up patch, withAuditIntent below just
// stores a module-level breadcrumb that callAuditedRpc forwards to any
// RPC that's been updated to accept p_audit_intent / p_audit_correlation_id.
//
// The audit trail STILL works without intent — triggers capture every
// change with full diff + actor. Intent is layered enrichment.

export interface AuditIntentContext {
  intent: string;
  correlationId?: string;
}

let CURRENT_AUDIT_CONTEXT: AuditIntentContext | null = null;

export function getCurrentAuditContext(): AuditIntentContext | null {
  return CURRENT_AUDIT_CONTEXT;
}

/**
 * Sets a client-side intent context for the duration of `fn`. Any
 * `callAuditedRpc` invocations inside `fn` automatically forward the
 * intent + correlation_id to the server.
 *
 * For direct `.from(...).update()` calls inside `fn`, intent CANNOT be
 * captured (REST transaction boundary — see file header). The audit
 * event still fires; metadata.intent will just be null.
 */
export async function withAuditIntent<T>(
  context: AuditIntentContext,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = CURRENT_AUDIT_CONTEXT;
  CURRENT_AUDIT_CONTEXT = {
    intent: context.intent,
    correlationId: context.correlationId ?? newCorrelationId(),
  };
  try {
    return await fn();
  } finally {
    CURRENT_AUDIT_CONTEXT = prev;
  }
}

/**
 * Wrapper around `supabase.rpc()` that automatically forwards the current
 * audit context (intent + correlation_id) as RPC parameters. The
 * server-side RPC is expected to accept `p_audit_intent` and
 * `p_audit_correlation_id` and call `audit_set_intent` / `audit_set_correlation`
 * at the top of its body before mutating.
 *
 * RPCs that don't accept these params will simply ignore them — Postgres
 * raises an error on unknown args, so we only forward when the caller
 * opts in via withAuditIntent.
 */
export async function callAuditedRpc<T = any>(
  rpcName: string,
  params: Record<string, any> = {},
): Promise<{ data: T | null; error: any }> {
  const ctx = getCurrentAuditContext();
  const finalParams: Record<string, any> = { ...params };
  if (ctx) {
    finalParams.p_audit_intent = ctx.intent;
    finalParams.p_audit_correlation_id = ctx.correlationId ?? null;
  }
  return supabase.rpc(rpcName, finalParams) as any;
}

// ─── PRICE-BLINDNESS REDACTION (anti-poaching) ────────────────────────────
// NEXPEC golden rule: a buyer (client / agency / enterprise) or supplier — and
// even an inspector — must NEVER see the inspector's payout or the platform's
// spread / margin in the audit trail. Audit events diff raw column changes, so
// a `job.price_updated` event would otherwise leak `platform_spread_cents` /
// `inspector_payout_cents` straight to the client, both in the visual diff AND
// in the raw JSON payload. We strip these fields from every event served to a
// non-admin surface and DROP any event that, after stripping, carried only a
// sensitive pricing change. Admin callers (asAdmin) are exempt — they need full
// visibility.
//
// NOTE: this is the client-side guard the UI relies on today. The durable fix
// is to also redact these columns inside the `audit_events_public` DB view so
// the bytes never reach the device at all — tracked as a server-side follow-up.
const SENSITIVE_PRICING_FIELDS = new Set<string>([
  'platform_spread_cents',
  'platform_spread',
  'platform_fee_cents',
  'platform_margin_cents',
  'spread_cents',
  'margin_cents',
  'commission_cents',
  'inspector_payout_cents',
  'inspector_payout',
  'contractor_payout_amount_cents',
  'contractor_payout_cents',
  'contractor_payout',
  'payout_amount_cents',
  'payout_cents',
]);

/**
 * True when a column / field name reveals inspector pay or platform margin.
 * Pattern-guarded so future column aliases (e.g. `*_spread_cents`,
 * `inspector_payout_*`) are caught without a code change. Client-facing price
 * fields (client_price_cents, budget_cents, total_amount_cents, …) are NOT
 * matched, so the buyer still sees what THEY pay.
 */
export function isSensitivePricingField(key: string): boolean {
  if (SENSITIVE_PRICING_FIELDS.has(key)) return true;
  if (/(_spread|_margin|commission)/i.test(key)) return true;
  if (/(inspector|contractor)_payout/i.test(key)) return true;
  return false;
}

/** Recursively strip sensitive pricing keys (and field-name strings) from any value. */
function deepStripSensitivePricing(value: any): any {
  if (Array.isArray(value)) {
    return value
      .filter((v) => !(typeof v === 'string' && isSensitivePricingField(v)))
      .map(deepStripSensitivePricing);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) {
      if (isSensitivePricingField(k)) continue;
      out[k] = deepStripSensitivePricing(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * Returns a price-blind copy of an audit event, or `null` when the event ONLY
 * carried sensitive pricing changes (caller should then hide it entirely).
 * Strips both the structured diff (delta.before / delta.after) and the raw
 * metadata payload. Admin callers must NOT route through this.
 */
export function redactSensitivePricing(event: AuditEvent): AuditEvent | null {
  const stripFlat = (obj?: Record<string, any>) => {
    if (!obj || typeof obj !== 'object') return { cleaned: obj, removed: 0 };
    let removed = 0;
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj)) {
      if (isSensitivePricingField(k)) { removed++; continue; }
      out[k] = obj[k];
    }
    return { cleaned: out, removed };
  };

  const b = stripFlat(event.delta?.before);
  const a = stripFlat(event.delta?.after);
  const removed = b.removed + a.removed;

  // Hide an event whose entire visible diff is empty when it was (or is) a
  // pricing change. `removed > 0` covers client-side stripping; the pricing
  // category check covers the case where the DB view (audit_events_public)
  // ALREADY stripped the fields server-side — so no blank "Pricing updated"
  // rows render on either path.
  const remaining = new Set<string>([
    ...Object.keys(b.cleaned ?? {}),
    ...Object.keys(a.cleaned ?? {}),
  ]);
  if (
    remaining.size === 0 &&
    (removed > 0 || getEventTypeMeta(event.event_type).category === 'pricing')
  ) {
    return null;
  }

  return {
    ...event,
    delta: { before: b.cleaned, after: a.cleaned },
    metadata: deepStripSensitivePricing(event.metadata) as AuditMetadata,
  };
}

// ─── FETCHING ─────────────────────────────────────────────────────────────

export interface FetchAuditOptions {
  /** Limit to one job (per-job timeline). */
  jobId?: string;
  /** Limit to one actor. */
  actorId?: string;
  /** Filter by exact event_type. */
  eventType?: string;
  /** Filter by event category (Status/Pricing/…) — applied client-side. */
  category?: EventCategory | 'all';
  /** Filter to events at/above this severity. */
  minSeverity?: AuditSeverity;
  /** Free-text-ish ILIKE search across `summary`. */
  search?: string;
  /** Pagination. */
  limit?: number;
  offset?: number;
  /** When true, queries `audit_events` for full metadata (admin only). */
  asAdmin?: boolean;
}

export async function fetchAuditEvents(
  opts: FetchAuditOptions = {},
): Promise<AuditEvent[]> {
  const tableOrView = opts.asAdmin ? 'audit_events' : 'audit_events_public';

  let q = supabase
    .from(tableOrView)
    .select('*')
    .order('created_at', { ascending: false });

  if (opts.jobId)       q = q.eq('job_id',      opts.jobId);
  if (opts.actorId)     q = q.eq('actor_id',    opts.actorId);
  if (opts.eventType)   q = q.eq('event_type',  opts.eventType);
  if (opts.search)      q = q.ilike('summary',  `%${opts.search.trim()}%`);

  if (opts.minSeverity === 'critical') {
    q = q.eq('severity', 'critical');
  } else if (opts.minSeverity === 'warning') {
    q = q.in('severity', ['warning', 'critical']);
  }

  const limit  = opts.limit  ?? 50;
  const offset = opts.offset ?? 0;
  q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) throw error;

  let rows = (data ?? []) as AuditEvent[];

  // Category filter is applied client-side because it's derived from
  // EVENT_TYPE_META, which lives in TS. (We could also expose a per-type
  // column server-side later; for v1, client-side is fast enough.)
  if (opts.category && opts.category !== 'all') {
    rows = rows.filter((r) => getEventTypeMeta(r.event_type).category === opts.category);
  }

  // ★ PRICE-BLINDNESS (anti-poaching) — every non-admin surface
  //   (client / agency / enterprise / supplier / inspector) is served a
  //   price-blind view: inspector payout + platform spread/margin are stripped
  //   from the diff AND the raw payload, and pricing-only events are dropped.
  //   Admin (asAdmin → audit_events) keeps full visibility.
  if (!opts.asAdmin) {
    rows = rows
      .map((r) => redactSensitivePricing(r))
      .filter((r): r is AuditEvent => r !== null);
  }

  return rows;
}
