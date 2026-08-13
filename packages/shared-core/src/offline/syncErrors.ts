// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core — offline/syncErrors
//
//  Pure, framework-free classification of the errors thrown while draining the
//  mobile offline outbox against Supabase (PostgREST · GoTrue · Storage).
//
//  WHY THIS EXISTS (the failure it prevents):
//    The drain loop used to treat EVERY thrown error identically — increment
//    the attempt counter, set exponential backoff, stop. That is catastrophic
//    for two error families:
//
//      1. Auth expiry. When the JWT expires mid-drain, every queued write 401s.
//         The old loop burned one retry-attempt per 60s poll on the head op
//         until it hit the 8-attempt ceiling and ABANDONED perfectly-good
//         inspector field data — over a problem a single token refresh fixes
//         in well under a second.
//
//      2. State conflicts. A 0-row UPDATE (the report was deleted, sealed, or
//         is now RLS-filtered) is NOT a transport failure — retrying it 8 times
//         changes nothing. It needs to be surfaced for a human decision, not
//         silently buried in backoff.
//
//  So the drain loop asks this module to bucket each error into one of four
//  classes and reacts accordingly:
//
//      auth      → session/JWT problem. Requeue WITHOUT burning an attempt,
//                  attempt a session refresh, then retry. Never counts against
//                  the abandonment ceiling.
//      conflict  → server state diverged (row gone / sealed / optimistic-lock
//                  miss / 409). Terminal-pending: surface for user resolution,
//                  do not auto-retry into oblivion.
//      transient → network blip / 5xx / 429 / timeout. Normal exponential
//                  backoff — the existing, battle-tested path.
//      fatal     → deterministic 4xx / constraint / RLS-deny. Retrying is
//                  pointless; surface it instead of grinding the ceiling.
//
//  DESIGN BIAS: when an error is genuinely unrecognizable, we classify it
//  'transient' (retry) rather than 'fatal' (give up). The whole value of this
//  platform is that an inspector NEVER silently loses field evidence; a misread
//  that costs a few retries is acceptable, a misread that drops data is not.
//  Even a truly-stuck transient still becomes *visible* as 'exhausted' once the
//  attempt ceiling is reached — it is never deleted without a trace.
//
//  PHILOSOPHICAL RULE (package-wide): no imports from react / react-native /
//  next / @supabase. This file only duck-types plain error objects, so it is
//  pure and exhaustively unit-testable.
// ════════════════════════════════════════════════════════════════════════════

export type SyncErrorClass = 'auth' | 'conflict' | 'transient' | 'fatal';

export interface SyncErrorInfo {
  /** The bucket the drain loop reacts to. */
  klass: SyncErrorClass;
  /** Best-effort HTTP status, if one could be recovered. */
  status?: number;
  /** Best-effort error code (PostgREST `PGRSTxxx`, Postgres SQLSTATE, GoTrue). */
  code?: string;
  /** Human-readable message (already-extracted, never the raw object). */
  message: string;
  /** True for `auth` + `transient` — i.e. worth trying again automatically. */
  retryable: boolean;
}

// ── SyncConflictError ────────────────────────────────────────────────────────
//
// Thrown by an outbox handler when a write provably targeted a row that no
// longer matches — a deleted/sealed report, an RLS-filtered row, or a failed
// optimistic-concurrency guard. This is distinct from a duplicate-key replay
// (which handlers already translate to success). Carries a structural brand so
// detection survives across duplicated module instances, where `instanceof`
// can silently fail.
export class SyncConflictError extends Error {
  /** Structural brand — robust across module realms / bundler duplication. */
  readonly nexpecConflict = true as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SyncConflictError';
    this.details = details;
    // Restore the prototype chain (TS target < ES2015 / bundler edge cases).
    Object.setPrototypeOf(this, SyncConflictError.prototype);
  }
}

export function isSyncConflictError(e: unknown): e is SyncConflictError {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { nexpecConflict?: unknown }).nexpecConflict === true
  );
}

// ── Internal: robust field extraction from an unknown error ──────────────────

interface PickedError {
  status?: number;
  code?: string;
  message: string;
  name?: string;
  isAuth: boolean;
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Pull a normalized {status, code, message, name, isAuth} out of the wildly
 * polymorphic shapes Supabase throws:
 *   - PostgrestError: { message, details, hint, code }            (no status)
 *   - AuthError:      { name, status, message, code, __isAuthError }
 *   - StorageError:   { name, status|statusCode, message }
 *   - FunctionsError / fetch TypeError / plain string / nested .cause / .error
 */
function pickError(err: unknown): PickedError {
  if (err == null) return { message: '', isAuth: false };
  if (typeof err === 'string') return { message: err, isAuth: false };
  if (typeof err !== 'object') return { message: String(err), isAuth: false };

  const e = err as Record<string, any>;
  const nested = (e.originalError ?? e.cause ?? e.error ?? {}) as Record<string, any>;

  const status =
    toFiniteNumber(e.status) ??
    toFiniteNumber(e.statusCode) ??
    toFiniteNumber(e.httpStatus) ??
    toFiniteNumber(nested.status) ??
    toFiniteNumber(nested.statusCode) ??
    toFiniteNumber(nested.httpStatus);

  // Postgres SQLSTATEs (e.g. '23502', '42501') are all-digit and load-bearing,
  // so we must NOT strip numeric-looking codes. Supabase never stuffs a bare
  // HTTP status into `code`, so there is nothing to defend against here.
  const code = firstString(e.code, nested.code);

  const message =
    firstString(
      e.message,
      e.error_description,
      e.msg,
      nested.message,
      e.hint,
      e.details,
      nested.hint,
      nested.details,
    ) ?? '';

  const name = firstString(e.name, nested.name);
  const isAuth = e.__isAuthError === true || nested.__isAuthError === true;

  return { status, code, message, name, isAuth };
}

// ── Lookup tables ────────────────────────────────────────────────────────────

// Worth retrying with backoff — load shedding, gateway hiccups, server faults.
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

// Deterministic client/server rejections — retrying changes nothing.
const FATAL_STATUS = new Set([400, 403, 404, 405, 406, 410, 411, 412, 413, 414, 415, 422, 423, 428, 431, 451]);

// Postgres SQLSTATE + PostgREST codes that are deterministic (won't self-heal).
const FATAL_CODES = new Set([
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '23P01', // exclusion_violation
  '22P02', // invalid_text_representation
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '42501', // insufficient_privilege (RLS deny)
  '42703', // undefined_column
  '42P01', // undefined_table
  '42883', // undefined_function
  'PGRST204', // column not found in schema cache
  'P0001', // raise_exception (a trigger said no)
  '23505', // unique_violation that a handler did NOT translate to success
  // ── added by Lane F offline ────────────────────────────────────────────────
  // These two were MISSING, and they are the codes NEXPEC's own RPCs use for
  // deliberate business refusals: 111 `USING ERRCODE = '22000'` and 81
  // `ERRCODE = 'P0002'` across supabase/migrations. Without them a refusal like
  // FUNDING_REQUIRED, REPORT_CHANGED, NOT_AWAITING_CORRECTION or NO_OPEN_REVIEW
  // classified as transient and the outbox retried it until attempts exhausted
  // — a retry storm against a server that can never say yes, ending in
  // 'exhausted' rather than the truthful 'fatal'.
  //
  // operations.ts:434 already DOCUMENTED the intended behaviour — "the RPC
  // raises (22000/42501) → classified fatal → surfaced, not retried into
  // oblivion" — so half of that comment was false until now.
  //
  // Both are deterministic: 22000 here is always a hand-raised refusal, and
  // P0002 means the target row is not visible to this caller. Neither self-heals
  // on retry. Ops that must not race their dependency are already composite
  // (e.g. flash_report_raise), so P0002 is not load-bearing for ordering.
  '22000', // data_exception — NEXPEC business refusal (RAISE … ERRCODE '22000')
  'P0002', // no_data_found — the row is absent or RLS-invisible to this caller
]);

/**
 * REFUSALS WHOSE PRECONDITION CAN LATER BECOME TRUE.
 *
 * 20260801456000 added SQLSTATE 22000 and P0002 to FATAL_CODES, which is right
 * for the overwhelming majority of NEXPEC's hand-raised refusals: authority
 * (NOT_AUTHORIZED, NOT_ACTIVE_INSPECTOR, REVIEWER_NOT_ELIGIBLE), stale state
 * (REPORT_CHANGED, REVIEW_ROUND_CHANGED, NO_OPEN_REVIEW) and malformed input
 * (INVALID_DECISION, RETURN_REQUIRES_COMMENT). None of those can succeed by
 * replaying the same operation.
 *
 * FUNDING_REQUIRED is the exception, and a blanket rule would get it wrong.
 * "the remaining tranche must be in" is a statement about the WORLD, not about
 * this operation: the client can pay afterwards and the identical op becomes
 * valid. Marking it fatal would abandon work that was only ever early.
 *
 * These are classified 'conflict' rather than 'transient': terminal-pending,
 * awaiting an explicit user decision (retryConflict | discardOperation), so the
 * device neither hammers a gate that is closed nor silently discards the op.
 */
const RETRYABLE_REFUSAL_RE =
  /\bFUNDING_REQUIRED\b|\bFUNDING_STAGE_NOT_FOUND\b|\bAWAITING_\w+\b|\bPRECONDITION\b/i;

const NETWORK_RE =
  /network request failed|failed to fetch|networkerror|load failed|fetch failed|aborterror|the operation was aborted|timeout|timed[- ]?out|econn|enotfound|eai_again|socket hang up|connection (?:reset|refused|closed|timed out)|stream closed|offline|getaddrinfo|dns/i;

const JWT_RE =
  /jwt (?:expired|is expired|malformed|invalid)|token (?:is )?expired|expired token|invalid (?:jwt|token|claim|signature|api key)|missing (?:authorization|jwt)|not authenticated|unauthenticated|unauthorized|invalid api key|session (?:expired|missing|not found|from session_id claim)|refresh token/i;

// ── The classifier ───────────────────────────────────────────────────────────

export function classifySyncError(err: unknown): SyncErrorClass {
  // Our own explicit conflict signal always wins.
  if (isSyncConflictError(err)) return 'conflict';

  const p = pickError(err);

  // PostgREST single()-returned-no-rows ⇒ the target row vanished/sealed.
  if (p.code === 'PGRST116') return 'conflict';
  // A bare HTTP 409 Conflict from any surface.
  if (p.status === 409) return 'conflict';

  // ── auth / session ──────────────────────────────────────────────────────
  // AuthRetryableFetchError is a NETWORK failure wearing an auth-error costume.
  if (p.name === 'AuthRetryableFetchError') return 'transient';
  if (p.status === 401) return 'auth';
  // PostgREST's PGRST3xx family is the JWT/role-claim error group.
  if (p.code && /^PGRST3\d\d$/.test(p.code)) return 'auth';
  // GoTrue auth errors that aren't a network blip and aren't an RLS 403.
  if (p.isAuth && (p.status === undefined || p.status === 401) && !NETWORK_RE.test(p.message)) {
    return 'auth';
  }
  if (JWT_RE.test(p.message)) return 'auth';

  // ── transient (retry with backoff) ──────────────────────────────────────
  if (p.status !== undefined && TRANSIENT_STATUS.has(p.status)) return 'transient';
  if (p.status === 0) return 'transient'; // RN/GoTrue "no response" sentinel
  if (p.status === undefined && NETWORK_RE.test(p.message)) return 'transient';
  if (p.code === 'PGRST000' || p.code === 'PGRST001') return 'transient'; // could not connect

  // ── semantically retryable refusals, checked BEFORE the fatal codes ─────
  // A 22000/P0002 whose precondition the world can still satisfy is not
  // deterministic. See RETRYABLE_REFUSAL_RE.
  if (
    (p.code === '22000' || p.code === 'P0002') &&
    RETRYABLE_REFUSAL_RE.test(p.message)
  ) {
    return 'conflict';
  }

  // ── fatal (deterministic) ───────────────────────────────────────────────
  if (p.status !== undefined && FATAL_STATUS.has(p.status)) return 'fatal';
  if (p.code && FATAL_CODES.has(p.code)) return 'fatal';

  // Unknown ⇒ bias to retry. Never silently abandon on a misclassification;
  // a stuck transient still surfaces as 'exhausted' at the attempt ceiling.
  return 'transient';
}

/** Classify + return the extracted detail (for logging / surfacing). */
export function describeSyncError(err: unknown): SyncErrorInfo {
  const klass = classifySyncError(err);
  const p = pickError(err);
  return {
    klass,
    status: p.status,
    code: p.code,
    message: p.message || 'Unknown error',
    retryable: klass === 'auth' || klass === 'transient',
  };
}

/** Convenience predicate the drain loop reads. */
export function isAuthExpiry(err: unknown): boolean {
  return classifySyncError(err) === 'auth';
}
