// ════════════════════════════════════════════════════════════════════════════
//  src/core/net/deadline.test.ts
//
//  Regression proof for D32 (run 29): a never-settling supabase request must
//  not be able to hold a loading-gated screen's spinner forever.
//
//  NON-VACUITY: the "never-settling promise" case models the exact old
//  behavior — before withDeadline, `await neverSettles` hangs the caller's
//  finally-block indefinitely (this test would time out against that shape).
//  With withDeadline the await settles (rejects) at the deadline, so the
//  caller's catch/finally provably runs.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { withDeadline, DeadlineError } from './deadline';

describe('withDeadline (D32)', () => {
  it('resolves with the value when the promise settles before the deadline', async () => {
    await expect(withDeadline(Promise.resolve(42), 1000, 't')).resolves.toBe(42);
  });

  it('propagates the original rejection when it loses no race', async () => {
    await expect(
      withDeadline(Promise.reject(new Error('boom')), 1000, 't'),
    ).rejects.toThrow('boom');
  });

  it('rejects with DeadlineError when the promise NEVER settles (the D32 hang)', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => {});
      const raced = withDeadline(never, 12_000, 'profile:fetch');
      // attach the assertion BEFORE advancing time so the rejection is handled
      const assertion = expect(raced).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof DeadlineError &&
          e.label === 'profile:fetch' &&
          e.ms === 12_000,
      );
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its timer when the promise settles first (no stray rejection)', async () => {
    vi.useFakeTimers();
    try {
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      await withDeadline(Promise.resolve('ok'), 5_000, 't');
      await vi.advanceTimersByTimeAsync(10_000);
      process.off('unhandledRejection', onUnhandled);
      expect(unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
