// ════════════════════════════════════════════════════════════════════════════
//  payments/stripeWebhook.test.ts — payment-integrity unit tests (P3.1b)
//
//  Locks the Stripe signature algorithm + the claim-then-process idempotency
//  decisions. The HMAC is a deterministic, comma/equals-free fake so the tests
//  are pure and reproducible.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  parseStripeSignatureHeader,
  verifyStripeWebhookSignature,
  constantTimeEqual,
  decideClaimOutcome,
  decideHandlerOutcome,
  stripeEventIdempotencyKey,
} from './stripeWebhook';

// Deterministic FNV-1a → 8-char hex. No commas/equals, so it never breaks the
// `t=..,v1=..` header grammar; distinct messages → distinct digests.
function fakeHmac(key: string, message: string): string {
  let h = 2166136261;
  const s = key + '|' + message;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const PAYLOAD = '{"id":"evt_123","type":"payment_intent.succeeded"}';
const SECRET = 'whsec_test';
const T = 1700000000;
const goodSig = fakeHmac(SECRET, `${T}.${PAYLOAD}`);
const header = `t=${T},v1=${goodSig}`;

describe('parseStripeSignatureHeader', () => {
  it('parses t + one or more v1', () => {
    expect(parseStripeSignatureHeader(`t=${T},v1=abc,v1=def`)).toEqual({ timestamp: T, v1: ['abc', 'def'] });
  });
  it('returns null when t or v1 is missing or malformed', () => {
    expect(parseStripeSignatureHeader('v1=abc')).toBeNull();
    expect(parseStripeSignatureHeader(`t=${T}`)).toBeNull();
    expect(parseStripeSignatureHeader('garbage')).toBeNull();
    expect(parseStripeSignatureHeader('')).toBeNull();
  });
});

describe('verifyStripeWebhookSignature', () => {
  const opts = { hmacSha256Hex: fakeHmac, nowSec: T + 10 };

  it('accepts a valid signature within tolerance', () => {
    expect(verifyStripeWebhookSignature(PAYLOAD, header, SECRET, opts)).toEqual({ ok: true });
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const r = verifyStripeWebhookSignature(PAYLOAD + 'x', header, SECRET, opts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_signature_match');
  });

  it('rejects a stale timestamp beyond tolerance', () => {
    const r = verifyStripeWebhookSignature(PAYLOAD, header, SECRET, { hmacSha256Hex: fakeHmac, nowSec: T + 400 });
    expect(r.reason).toBe('timestamp_out_of_tolerance');
  });

  it('rejects a malformed header', () => {
    expect(verifyStripeWebhookSignature(PAYLOAD, 'nope', SECRET, opts).reason).toBe('malformed_header');
  });

  it('accepts when any one of multiple v1 signatures matches', () => {
    const multi = `t=${T},v1=deadbeef,v1=${goodSig}`;
    expect(verifyStripeWebhookSignature(PAYLOAD, multi, SECRET, opts).ok).toBe(true);
  });

  it('rejects a forged signature with a different secret', () => {
    const r = verifyStripeWebhookSignature(PAYLOAD, header, 'whsec_attacker', opts);
    expect(r.ok).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('matches equal strings, rejects different length/content', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });
});

describe('claim-then-process decisions', () => {
  it('processes when claimed', () => {
    expect(decideClaimOutcome({ claimed: true, reason: 'claimed' }).process).toBe(true);
  });
  it('acks (200) when already completed or in-flight elsewhere', () => {
    for (const reason of ['already_completed', 'in_flight_elsewhere'] as const) {
      const d = decideClaimOutcome({ claimed: false, reason });
      expect(d.process).toBe(false);
      expect(d.outcome).toEqual({ httpStatus: 200, ledgerAction: 'none', ack: true });
    }
  });
  it('does NOT ack (500) on an unknown ledger state so Stripe retries', () => {
    const d = decideClaimOutcome({ claimed: false, reason: 'unknown_status' });
    expect(d.outcome).toEqual({ httpStatus: 500, ledgerAction: 'none', ack: false });
  });
  it('completes on handler success, releases on failure', () => {
    expect(decideHandlerOutcome(true)).toEqual({ httpStatus: 200, ledgerAction: 'complete', ack: true });
    expect(decideHandlerOutcome(false)).toEqual({ httpStatus: 500, ledgerAction: 'release', ack: false });
  });
});

describe('stripeEventIdempotencyKey', () => {
  it('returns the event id, or null when absent', () => {
    expect(stripeEventIdempotencyKey({ id: 'evt_1' })).toBe('evt_1');
    expect(stripeEventIdempotencyKey({})).toBeNull();
    expect(stripeEventIdempotencyKey({ id: 123 })).toBeNull();
  });
});
