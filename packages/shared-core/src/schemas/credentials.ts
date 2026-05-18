// ════════════════════════════════════════════════════════════════════════════
//  schemas/credentials.ts — compliance review input
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

export const CREDENTIAL_DECISIONS = ['approved', 'rejected', 'suspended'] as const;
export type CredentialDecision = (typeof CREDENTIAL_DECISIONS)[number];

export const adminReviewCredentialInput = z.object({
  p_credential_id: uuid,
  p_decision: z.enum(CREDENTIAL_DECISIONS),
  p_notes: z
    .string()
    .trim()
    .min(1, { message: 'Decision notes are required.' })
    .max(1000, { message: 'Notes must be 1000 characters or fewer.' }),
});
export type AdminReviewCredentialInput = z.infer<typeof adminReviewCredentialInput>;
