// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/aiops/lifecycle — the dataset-image lifecycle state
//  machine, mirroring the SQL guard trigger (ai_ops_guard_lifecycle) EXACTLY.
//  One definition consumed by web UI, mobile, services, and tooling so a
//  client can pre-validate what the database will enforce.
// ════════════════════════════════════════════════════════════════════════════

export const IMAGE_LIFECYCLE_STATES = [
  'pending', 'reviewed', 'accepted', 'rejected', 'hard_example',
  'golden_sample', 'training_candidate', 'archived', 'deleted',
] as const;
export type ImageLifecycle = (typeof IMAGE_LIFECYCLE_STATES)[number];

/** Legal transitions — MUST match ai_ops_guard_lifecycle in the migration. */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<ImageLifecycle, readonly ImageLifecycle[]>> = {
  pending: ['reviewed', 'rejected', 'deleted'],
  reviewed: ['accepted', 'rejected', 'hard_example', 'deleted'],
  accepted: ['training_candidate', 'golden_sample', 'hard_example', 'archived', 'deleted'],
  rejected: ['reviewed', 'archived', 'deleted'],
  hard_example: ['training_candidate', 'accepted', 'archived', 'deleted'],
  golden_sample: ['archived'],
  training_candidate: ['accepted', 'archived', 'deleted'],
  archived: ['reviewed', 'deleted'],
  deleted: [],
};

export function canTransitionLifecycle(from: ImageLifecycle, to: ImageLifecycle): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

/** States that count toward a training set. */
export const TRAINABLE_STATES: readonly ImageLifecycle[] =
  ['accepted', 'golden_sample', 'training_candidate', 'hard_example'];

export function isTrainable(s: ImageLifecycle): boolean {
  return TRAINABLE_STATES.includes(s);
}
