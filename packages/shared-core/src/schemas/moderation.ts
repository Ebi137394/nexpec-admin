// ════════════════════════════════════════════════════════════════════════════
//  schemas/moderation.ts — job moderation review input
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

export const JOB_MODERATION_DECISIONS = ['approved', 'edits_requested', 'rejected'] as const;
export type JobModerationDecision = (typeof JOB_MODERATION_DECISIONS)[number];

export const adminReviewJobInput = z
  .object({
    p_job_id: uuid,
    p_decision: z.enum(JOB_MODERATION_DECISIONS),
    p_notes: z
      .string()
      .trim()
      .max(1000, { message: 'Notes must be 1000 characters or fewer.' })
      .optional()
      .nullable(),
  })
  .refine(
    (v) => v.p_decision === 'approved' || (v.p_notes && v.p_notes.length > 0),
    {
      message: 'Notes are required for edits-requested and rejected decisions.',
      path: ['p_notes'],
    },
  );
export type AdminReviewJobInput = z.infer<typeof adminReviewJobInput>;
