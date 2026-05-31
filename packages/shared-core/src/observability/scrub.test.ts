// ════════════════════════════════════════════════════════════════════════════
//  observability/scrub.test.ts — PII redaction proof (legal-critical)
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  redactPiiString,
  scrubValue,
  scrubSentryEvent,
  safeErrorTags,
  REDACTED,
} from './scrub';

describe('redactPiiString', () => {
  it('redacts emails', () => {
    expect(redactPiiString('contact jane.doe@acme.co now')).toBe(`contact ${REDACTED} now`);
  });
  it('redacts JWTs and bearer tokens', () => {
    expect(redactPiiString('eyJhbGciOiJIUzI1.eyJzdWIiOiIx.abcDEF_123')).toBe(REDACTED);
    expect(redactPiiString('Authorization: Bearer abcd1234efgh')).toContain('Bearer ' + REDACTED);
  });
  it('redacts Stripe/secret keys', () => {
    expect(redactPiiString('key sk_live_abcd1234 and whsec_zzzz9999')).toBe(`key ${REDACTED} and ${REDACTED}`);
  });
  it('redacts card-like digit runs', () => {
    expect(redactPiiString('card 4242 4242 4242 4242 done')).toBe(`card ${REDACTED} done`);
  });
  it('leaves clean strings untouched', () => {
    expect(redactPiiString('job 8f3a completed in 12ms')).toBe('job 8f3a completed in 12ms');
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys regardless of case', () => {
    const out = scrubValue({ Email: 'a@b.com', Token: 'xyz', job_id: 'j1' }) as Record<string, unknown>;
    expect(out.Email).toBe(REDACTED);
    expect(out.Token).toBe(REDACTED);
    expect(out.job_id).toBe('j1');
  });
  it('recurses into nested objects and arrays', () => {
    const out = scrubValue({ a: { password: 'p', list: ['x@y.com', 'ok'] } }) as any;
    expect(out.a.password).toBe(REDACTED);
    expect(out.a.list[0]).toBe(REDACTED);
    expect(out.a.list[1]).toBe('ok');
  });
  it('is cycle-safe', () => {
    const o: any = { name: 'n' };
    o.self = o;
    expect(() => scrubValue(o)).not.toThrow();
  });
  it('passes through non-PII primitives', () => {
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBe(null);
  });
});

describe('scrubSentryEvent', () => {
  it('reduces user to a pseudonymous id and strips the rest', () => {
    const e = scrubSentryEvent({ user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' } });
    expect(e.user).toEqual({ id: 'u1' });
  });
  it('redacts request headers (authorization/cookie), cookies, and body', () => {
    const e = scrubSentryEvent({
      request: {
        headers: { authorization: 'Bearer secrettoken123', 'x-trace': 'ok' },
        cookies: { sb: 'session' },
        data: { email: 'a@b.com', amount_cents: 500 },
      },
    });
    expect(e.request!.headers!.authorization).toBe(REDACTED);
    expect(e.request!.headers!['x-trace']).toBe('ok');
    expect(e.request!.cookies).toBe(REDACTED);
    expect((e.request!.data as any).email).toBe(REDACTED);
    expect((e.request!.data as any).amount_cents).toBe(500);
  });
  it('redacts message PII and scrubs breadcrumbs', () => {
    const e = scrubSentryEvent({
      message: 'failed for jane@acme.co',
      breadcrumbs: [{ message: 'token=abc', data: { full_name: 'Jane Doe' } }],
    });
    expect(e.message).toBe(`failed for ${REDACTED}`);
    expect((e.breadcrumbs![0]!.data as any).full_name).toBe(REDACTED);
  });
});

describe('safeErrorTags', () => {
  it('includes only the provided non-PII identifiers', () => {
    expect(safeErrorTags({ jobId: 'j1', rpc: 'pi_seal_inspection_report', stripeEventId: 'evt_1' })).toEqual({
      job_id: 'j1',
      rpc: 'pi_seal_inspection_report',
      stripe_event_id: 'evt_1',
    });
    expect(safeErrorTags({})).toEqual({});
  });
});
