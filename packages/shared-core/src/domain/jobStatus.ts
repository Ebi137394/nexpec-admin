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
 */
export function jobStatusLabel(status: JobStatus): string {
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
  }
}
