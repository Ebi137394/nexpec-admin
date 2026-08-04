// ════════════════════════════════════════════════════════════════════════════
//  domain/jobStatus.ts
//
//  The canonical job state machine. The DB-side guard trigger
//  (guard_jobs_status_transition) enforces this same table at the schema
//  layer; we mirror it here so client code can pre-validate before round-
//  tripping the server (better UX, less DB load on illegal taps).
// ════════════════════════════════════════════════════════════════════════════

export const JOB_STATUS = {
  OPEN: 'open',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const ALL_JOB_STATUSES: readonly JobStatus[] = Object.values(JOB_STATUS);

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  JOB_STATUS.COMPLETED,
  JOB_STATUS.CANCELLED,
];

/**
 * Legal `from → to` transition table. Mirrors the BEFORE-UPDATE trigger
 * `public.guard_jobs_status_transition`. Idempotent (same status) is
 * always allowed implicitly — call sites should treat NEW === OLD as a
 * no-op rather than passing it to a transition RPC.
 */
const TRANSITIONS: Record<JobStatus, ReadonlyArray<JobStatus>> = {
  open: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled', 'disputed'],
  in_progress: ['completed', 'disputed', 'cancelled'],
  disputed: ['completed', 'cancelled', 'in_progress'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function legalNextStatuses(from: JobStatus): ReadonlyArray<JobStatus> {
  return TRANSITIONS[from] ?? [];
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/**
 * Human-readable label for UI badges. Defaults to title-cased status.
 *
 * Takes `string`, not `JobStatus`, on purpose. `jobs_status_check` in the
 * database is WIDER than the transitionable union above — it also admits
 * 'pending_approval' (the parked pre-marketplace state) and the legacy 'paid'.
 * Typing the parameter as `JobStatus` did not stop those values arriving at
 * runtime; it only stopped us handling them, and the switch then fell off the
 * end and returned `undefined`. That is why an unapproved job rendered a
 * completely BLANK status pill in the admin moderation panel while its real
 * state was 'pending_approval' — the docstring above promised a title-cased
 * default that the code never actually had.
 *
 * `JobStatus` itself is deliberately left alone: it models what the state
 * machine can TRANSITION between, and `TRANSITIONS` mirrors the DB guard
 * `guard_jobs_status_transition`. Labelling is a display concern and must be
 * total over whatever the column can hold.
 */
export function jobStatusLabel(status: string): string {
  switch (status) {
    case JOB_STATUS.OPEN:
      return 'Open';
    case JOB_STATUS.ASSIGNED:
      return 'Assigned';
    case JOB_STATUS.IN_PROGRESS:
      return 'In Progress';
    case JOB_STATUS.COMPLETED:
      return 'Completed';
    case JOB_STATUS.CANCELLED:
      return 'Cancelled';
    case JOB_STATUS.DISPUTED:
      return 'Disputed';
    case 'pending_approval':
      return 'Pending Approval';
    default:
      // Total fallback: snake_case → Title Case, so a status added to the DB
      // before it reaches this file degrades to something readable instead of
      // an empty badge.
      return status
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
  }
}
