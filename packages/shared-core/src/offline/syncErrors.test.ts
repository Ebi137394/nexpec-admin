// ════════════════════════════════════════════════════════════════════════════
//  syncErrors.test.ts — exhaustive classification coverage.
//
//  Every fixture below is a REAL shape Supabase throws (PostgREST / GoTrue /
//  Storage / fetch). The classifier is the gate that decides whether an
//  inspector's queued field evidence is retried or abandoned, so every branch
//  is pinned.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  classifySyncError,
  describeSyncError,
  isAuthExpiry,
  isSyncConflictError,
  SyncConflictError,
} from './syncErrors';

describe('SyncConflictError', () => {
  it('is detected structurally (brand survives instanceof gaps)', () => {
    const e = new SyncConflictError('report sealed', { id: 'r1' });
    expect(isSyncConflictError(e)).toBe(true);
    expect(e.details).toEqual({ id: 'r1' });
    expect(e.name).toBe('SyncConflictError');
  });

  it('detects a plain object carrying the brand (cross-realm safety)', () => {
    const lookalike = { nexpecConflict: true, message: 'x' };
    expect(isSyncConflictError(lookalike)).toBe(true);
  });

  it('rejects ordinary errors', () => {
    expect(isSyncConflictError(new Error('nope'))).toBe(false);
    expect(isSyncConflictError(null)).toBe(false);
    expect(isSyncConflictError('string')).toBe(false);
  });

  it('always classifies as conflict', () => {
    expect(classifySyncError(new SyncConflictError('gone'))).toBe('conflict');
  });
});

describe('classifySyncError — auth / session expiry', () => {
  it('PostgREST JWT-expired (code PGRST301)', () => {
    const err = { code: 'PGRST301', message: 'JWT expired', details: null, hint: null };
    expect(classifySyncError(err)).toBe('auth');
    expect(isAuthExpiry(err)).toBe(true);
  });

  it('any PGRST3xx JWT/role-claim code', () => {
    expect(classifySyncError({ code: 'PGRST302', message: 'anonymous disabled' })).toBe('auth');
    expect(classifySyncError({ code: 'PGRST300', message: 'JWSError' })).toBe('auth');
  });

  it('HTTP 401 from any surface', () => {
    expect(classifySyncError({ status: 401, message: 'Unauthorized' })).toBe('auth');
    expect(classifySyncError({ statusCode: '401', message: 'no perms' })).toBe('auth');
  });

  it('GoTrue AuthApiError with __isAuthError', () => {
    const err = {
      name: 'AuthApiError',
      status: 401,
      message: 'invalid claim: missing sub claim',
      __isAuthError: true,
    };
    expect(classifySyncError(err)).toBe('auth');
  });

  it('dead refresh token (GoTrue 400 + __isAuthError, message-routed)', () => {
    const err = {
      name: 'AuthApiError',
      status: 400,
      message: 'Invalid Refresh Token: Refresh Token Not Found',
      __isAuthError: true,
      code: 'refresh_token_not_found',
    };
    // status is 400 (not 401) — must still be caught via the message regex.
    expect(classifySyncError(err)).toBe('auth');
  });

  it('plain "not authenticated" message', () => {
    expect(classifySyncError({ message: 'User not authenticated' })).toBe('auth');
  });

  it('does NOT misread an RLS 403 as auth', () => {
    const rls = { code: '42501', message: 'new row violates row-level security policy', status: 403 };
    expect(classifySyncError(rls)).toBe('fatal');
  });
});

describe('classifySyncError — conflict', () => {
  it('PostgREST 0-rows from single() (PGRST116) ⇒ row vanished/sealed', () => {
    const err = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
    expect(classifySyncError(err)).toBe('conflict');
  });

  it('bare HTTP 409 Conflict', () => {
    expect(classifySyncError({ status: 409, message: 'Conflict' })).toBe('conflict');
  });

  it('explicit SyncConflictError from a handler', () => {
    const err = new SyncConflictError('report_update matched no row', { id: 'r9' });
    expect(classifySyncError(err)).toBe('conflict');
  });
});

describe('classifySyncError — transient (retry with backoff)', () => {
  it('React-Native network failure (no status, fetch TypeError)', () => {
    const err = new TypeError('Network request failed');
    expect(classifySyncError(err)).toBe('transient');
  });

  it('browser "Failed to fetch"', () => {
    expect(classifySyncError(new TypeError('Failed to fetch'))).toBe('transient');
  });

  it('AuthRetryableFetchError is network, NOT auth', () => {
    const err = { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed', __isAuthError: true };
    expect(classifySyncError(err)).toBe('transient');
  });

  it('5xx gateway/server faults', () => {
    for (const s of [500, 502, 503, 504, 522, 524]) {
      expect(classifySyncError({ status: s, message: 'server error' })).toBe('transient');
    }
  });

  it('429 rate limit', () => {
    expect(classifySyncError({ status: 429, message: 'Too Many Requests' })).toBe('transient');
  });

  it('timeout / connection-reset messages', () => {
    expect(classifySyncError({ message: 'connection reset by peer' })).toBe('transient');
    expect(classifySyncError({ message: 'Request timed out' })).toBe('transient');
    expect(classifySyncError({ message: 'ECONNREFUSED 10.0.0.1:443' })).toBe('transient');
  });

  it('status 0 sentinel', () => {
    expect(classifySyncError({ status: 0, message: '' })).toBe('transient');
  });

  it('unknown / unrecognized error biases to retry (never silently abandon)', () => {
    expect(classifySyncError({ message: 'something weird happened' })).toBe('transient');
    expect(classifySyncError({})).toBe('transient');
    expect(classifySyncError(null)).toBe('transient');
    expect(classifySyncError(undefined)).toBe('transient');
  });
});

describe('classifySyncError — fatal (deterministic)', () => {
  it('constraint violations', () => {
    expect(classifySyncError({ code: '23502', message: 'null value in column "job_id"' })).toBe('fatal');
    expect(classifySyncError({ code: '23503', message: 'foreign key violation' })).toBe('fatal');
    expect(classifySyncError({ code: '23514', message: 'check constraint' })).toBe('fatal');
  });

  it('RLS insufficient privilege', () => {
    expect(classifySyncError({ code: '42501', message: 'permission denied' })).toBe('fatal');
  });

  it('trigger raise_exception (P0001) — e.g. a "report is sealed" guard', () => {
    expect(classifySyncError({ code: 'P0001', message: 'report is sealed and cannot be modified' })).toBe('fatal');
  });

  it('deterministic 4xx statuses', () => {
    for (const s of [400, 403, 404, 422]) {
      expect(classifySyncError({ status: s, message: 'bad' })).toBe('fatal');
    }
  });

  it('unhandled unique violation (23505 that escaped handler dedup)', () => {
    expect(classifySyncError({ code: '23505', message: 'duplicate key value' })).toBe('fatal');
  });
});

describe('describeSyncError', () => {
  it('returns class + extracted detail + retryable flag', () => {
    expect(describeSyncError({ code: 'PGRST301', message: 'JWT expired' })).toEqual({
      klass: 'auth',
      status: undefined,
      code: 'PGRST301',
      message: 'JWT expired',
      retryable: true,
    });
    expect(describeSyncError({ status: 503, message: 'unavailable' }).retryable).toBe(true);
    expect(describeSyncError(new SyncConflictError('gone')).retryable).toBe(false);
    expect(describeSyncError({ code: '23502', message: 'not null' }).retryable).toBe(false);
  });

  it('never leaks the raw object — always a string message', () => {
    const d = describeSyncError({});
    expect(typeof d.message).toBe('string');
    expect(d.message).toBe('Unknown error');
  });

  it('digs status out of nested cause / originalError', () => {
    expect(describeSyncError({ message: 'wrap', cause: { status: 503 } }).klass).toBe('transient');
    expect(describeSyncError({ message: 'wrap', originalError: { status: 401 } }).klass).toBe('auth');
  });
});
