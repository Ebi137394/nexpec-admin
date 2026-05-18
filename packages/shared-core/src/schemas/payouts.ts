// ════════════════════════════════════════════════════════════════════════════
//  schemas/payouts.ts — payout settlement input shape
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

/* ─── admin_mark_payout_processed(p_job_id, p_stripe_reference, p_notes) */
export const adminMarkPayoutProcessedInput = z.object({
  p_job_id: uuid,
  p_stripe_reference: z
    .string()
    .trim()
    .min(1, { message: 'A reference is required (Stripe transfer id, or "manual:<context>").' })
    .max(200, { message: 'Reference must be 200 characters or fewer.' }),
  p_notes: z
    .string()
    .trim()
    .max(1000, { message: 'Notes must be 1000 characters or fewer.' })
    .optional()
    .nullable(),
});
export type AdminMarkPayoutProcessedInput = z.infer<
  typeof adminMarkPayoutProcessedInput
>;

/**
 * Heuristic — true if the reference looks like a Stripe Connect transfer id.
 * Stripe transfer ids start with `tr_` and are followed by 24+ chars.
 * Used only for UI signaling, never for validation (Stripe could change
 * the format; the DB doesn't care).
 */
export function isLikelyStripeTransferId(ref: string | null | undefined): boolean {
  if (!ref) return false;
  return /^tr_[A-Za-z0-9]{14,}$/.test(ref.trim());
}
