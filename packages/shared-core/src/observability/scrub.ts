// ════════════════════════════════════════════════════════════════════════════
//  observability/scrub.ts — bulletproof PII redaction for telemetry
//
//  NEXPEC is a legal-compliance platform: NO personal data, secrets, tokens, or
//  inspection payloads may leave the device/server into an error monitor. This
//  is the single, unit-tested redaction layer used by Sentry `beforeSend` /
//  `beforeBreadcrumb` on both web and mobile. Pure, dependency-free, $0.
//
//  Defence in depth: (1) value-pattern redaction (emails, JWTs, bearer tokens,
//  Stripe/secret keys, card-like digit runs), and (2) sensitive-key redaction
//  (password, token, cookie, email, signature, …). Cycle-safe + depth-capped so
//  a hostile/huge object can never hang the redactor. All regexes are bounded
//  (no nested unbounded quantifiers) → ReDoS-safe.
// ════════════════════════════════════════════════════════════════════════════

export const REDACTED = '[redacted]';

// Bounded, ReDoS-safe patterns.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]{8,}/gi;
const SECRET_TOKEN_RE = /\b(?:sk|pk|rk|sbp|whsec)_[A-Za-z0-9_]{6,}\b/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'passwd', 'secret', 'client_secret', 'token', 'access_token',
  'refresh_token', 'id_token', 'authorization', 'auth', 'cookie', 'cookies',
  'set-cookie', 'api_key', 'apikey', 'x-api-key', 'jwt', 'session', 'session_id',
  'ssn', 'dob', 'date_of_birth', 'card', 'card_number', 'cardnumber', 'cvv', 'cvc',
  'pan', 'email', 'phone', 'phone_number', 'address', 'street', 'full_name',
  'first_name', 'last_name', 'display_name', 'signature', 'private_key',
  'service_role_key', 'anon_key', 'supabase_service_role_key', 'stripe_secret_key',
]);

/** Redact PII / secret patterns inside a free string. */
export function redactPiiString(input: string): string {
  return input
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, 'Bearer ' + REDACTED)
    .replace(SECRET_TOKEN_RE, REDACTED)
    .replace(CARD_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED);
}

/** Deep-redact any value: sensitive keys → [redacted], PII patterns in strings
 *  → [redacted]. Cycle-safe, depth-capped (returns [redacted] past depth 8). */
export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return redactPiiString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return REDACTED;
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

/** Minimal shape of a Sentry event we touch. */
export interface SentryLikeEvent {
  message?: string;
  request?: {
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: Array<Record<string, unknown>>;
  exception?: unknown;
  [k: string]: unknown;
}

/** Sentry `beforeSend` body: strip request headers/cookies/body, reduce `user`
 *  to a pseudonymous id, and redact every string/sensitive key everywhere else. */
export function scrubSentryEvent(event: SentryLikeEvent): SentryLikeEvent {
  const e: SentryLikeEvent = { ...event };

  if (typeof e.message === 'string') e.message = redactPiiString(e.message);

  if (e.request) {
    const r = { ...e.request };
    if (r.headers) {
      const h: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.headers)) {
        h[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : scrubValue(v);
      }
      r.headers = h;
    }
    if ('cookies' in r) r.cookies = REDACTED;
    if ('query_string' in r) {
      r.query_string = typeof r.query_string === 'string' ? redactPiiString(r.query_string) : REDACTED;
    }
    if ('data' in r) r.data = scrubValue(r.data);
    e.request = r;
  }

  // Keep only a pseudonymous id; drop email / ip_address / username / etc.
  if (e.user) {
    e.user = e.user.id !== undefined ? { id: e.user.id } : {};
  }

  if (e.extra) e.extra = scrubValue(e.extra) as Record<string, unknown>;
  if (e.contexts) e.contexts = scrubValue(e.contexts) as Record<string, unknown>;
  if (e.tags) e.tags = scrubValue(e.tags) as Record<string, unknown>;
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs.map((b) => scrubValue(b) as Record<string, unknown>);
  }
  if (e.exception) e.exception = scrubValue(e.exception);

  return e;
}

/** Build a NON-PII tag set for seal/payment instrumentation. Ids + names only —
 *  seal/root hashes are non-reversible and safe to attach for correlation. */
export function safeErrorTags(input: {
  jobId?: string;
  reportId?: string;
  sealId?: string;
  rootSha256?: string;
  rpc?: string;
  stripeEventId?: string;
  stripeEventType?: string;
}): Record<string, string> {
  const t: Record<string, string> = {};
  if (input.jobId) t.job_id = input.jobId;
  if (input.reportId) t.report_id = input.reportId;
  if (input.sealId) t.seal_id = input.sealId;
  if (input.rootSha256) t.root_sha256 = input.rootSha256;
  if (input.rpc) t.rpc = input.rpc;
  if (input.stripeEventId) t.stripe_event_id = input.stripeEventId;
  if (input.stripeEventType) t.stripe_event_type = input.stripeEventType;
  return t;
}
