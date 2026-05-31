// ════════════════════════════════════════════════════════════════════════════
//  payments/stripeWebhook.ts — Stripe webhook integrity (signature + idempotency)
//
//  The edge function (supabase/functions/stripe-payments-webhook) uses Stripe's
//  SDK for the live signature check and three SECURITY DEFINER RPCs for the
//  claim-then-process idempotency lifecycle. THIS module is the pure, testable
//  spine of that logic — no `react`/`deno`/network — so the payment flow's
//  correctness is regression-locked and reusable on any runtime.
//
//  The HMAC primitive is INJECTED (Deno/Web/Node supply SHA-256 HMAC), keeping
//  this platform-agnostic while still verifying signatures exactly like Stripe:
//  HMAC-SHA256 over `${t}.${payload}`, constant-time compared to a `v1`, inside
//  a timestamp tolerance window.
// ════════════════════════════════════════════════════════════════════════════

/* ─── Signature verification ─────────────────────────────────────────────── */

export interface StripeSignatureParts {
  /** Unix seconds from the `t=` field. */
  timestamp: number;
  /** All `v1=` signatures present (Stripe may send more than one). */
  v1: string[];
}

/** Parse a `Stripe-Signature` header (`t=169..,v1=abc,v1=def`). Returns null if
 *  it lacks a valid integer `t` or any `v1`. */
export function parseStripeSignatureHeader(header: string): StripeSignatureParts | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  let timestamp = NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === 't') timestamp = parseInt(val, 10);
    else if (key === 'v1' && val.length > 0) v1.push(val);
  }
  if (!Number.isInteger(timestamp) || v1.length === 0) return null;
  return { timestamp, v1 };
}

export type StripeVerifyFailure =
  | 'malformed_header'
  | 'timestamp_out_of_tolerance'
  | 'no_signature_match';

export interface StripeVerifyResult {
  ok: boolean;
  reason?: StripeVerifyFailure;
}

export interface VerifyStripeOptions {
  /** HMAC-SHA256(key, message) → lowercase hex. Injected to stay platform-agnostic. */
  hmacSha256Hex: (key: string, message: string) => string;
  /** Current time, unix seconds. */
  nowSec: number;
  /** Max age of the signed timestamp (Stripe default 300s). */
  toleranceSec?: number;
}

/** Constant-time string equality (avoids timing oracles on the signature). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Verify a Stripe webhook signature: HMAC-SHA256 over `${t}.${payload}`,
 *  constant-time compared to any `v1`, within the timestamp tolerance. */
export function verifyStripeWebhookSignature(
  payload: string,
  header: string,
  secret: string,
  opts: VerifyStripeOptions,
): StripeVerifyResult {
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const tolerance = opts.toleranceSec ?? 300;
  if (Math.abs(opts.nowSec - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const expected = opts.hmacSha256Hex(secret, `${parsed.timestamp}.${payload}`);
  const matched = parsed.v1.some((sig) => constantTimeEqual(sig, expected));
  return matched ? { ok: true } : { ok: false, reason: 'no_signature_match' };
}

/* ─── Idempotency / claim-then-process decision ──────────────────────────── */

/** Result of claim_stripe_webhook_event(). 'claimed' → this worker may process. */
export type ClaimReason =
  | 'claimed'
  | 'in_flight_elsewhere'
  | 'already_completed'
  | 'unknown_status';

export interface ClaimResult {
  claimed: boolean;
  reason: ClaimReason;
}

export type LedgerAction = 'complete' | 'release' | 'none';

export interface WebhookOutcome {
  /** HTTP status to return to Stripe. */
  httpStatus: number;
  /** What to do with the ledger row. */
  ledgerAction: LedgerAction;
  /** True = Stripe should stop retrying (acknowledged). */
  ack: boolean;
}

/** Pure pre-handler decision: should we run the handler, and if not, what to
 *  return. ACK (200) only when another delivery owns it or it's already done;
 *  an unknown ledger state is NOT acked so Stripe retries. */
export function decideClaimOutcome(
  claim: ClaimResult,
): { process: boolean; outcome?: WebhookOutcome } {
  if (claim.claimed) return { process: true };
  switch (claim.reason) {
    case 'already_completed':
    case 'in_flight_elsewhere':
      return { process: false, outcome: { httpStatus: 200, ledgerAction: 'none', ack: true } };
    default:
      return { process: false, outcome: { httpStatus: 500, ledgerAction: 'none', ack: false } };
  }
}

/** Pure post-handler decision: success → complete + 200; failure → release the
 *  claim + 500 so Stripe's next retry can re-claim and re-run. */
export function decideHandlerOutcome(success: boolean): WebhookOutcome {
  return success
    ? { httpStatus: 200, ledgerAction: 'complete', ack: true }
    : { httpStatus: 500, ledgerAction: 'release', ack: false };
}

/** The idempotency key for a Stripe event = its immutable `id`. */
export function stripeEventIdempotencyKey(event: { id?: unknown }): string | null {
  return typeof event?.id === 'string' && event.id.length > 0 ? event.id : null;
}
