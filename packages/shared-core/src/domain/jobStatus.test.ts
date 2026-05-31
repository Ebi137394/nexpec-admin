// ════════════════════════════════════════════════════════════════════════════
//  domain/jobStatus.test.ts — the job state machine (P3.1)
//
//  Mirrors the DB guard trigger guard_jobs_status_transition. Locking the
//  transition table here prevents a client-side refactor from ever allowing an
//  illegal jump (e.g. open → completed) that the server would reject.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  legalNextStatuses,
  isTerminal,
  ALL_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
} from './jobStatus';

describe('job state machine', () => {
  it('allows the legal transitions', () => {
    expect(canTransition('open', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('disputed', 'completed')).toBe(true);
    expect(canTransition('disputed', 'in_progress')).toBe(true);
    expect(canTransition('assigned', 'disputed')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('open', 'completed')).toBe(false);
    expect(canTransition('open', 'in_progress')).toBe(false);
    expect(canTransition('assigned', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'open')).toBe(false);
  });

  it('treats same-status as an allowed no-op', () => {
    expect(canTransition('in_progress', 'in_progress')).toBe(true);
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const t of TERMINAL_JOB_STATUSES) {
      expect(legalNextStatuses(t)).toEqual([]);
      for (const to of ALL_JOB_STATUSES) {
        if (to !== t) expect(canTransition(t, to)).toBe(false);
      }
    }
  });

  it('isTerminal flags completed + cancelled only', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('open')).toBe(false);
    expect(isTerminal('disputed')).toBe(false);
  });

  it('legalNextStatuses matches the transition table', () => {
    expect(legalNextStatuses('open')).toEqual(['assigned', 'cancelled']);
    expect(legalNextStatuses('assigned')).toEqual(['in_progress', 'cancelled', 'disputed']);
  });
});
