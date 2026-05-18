// ════════════════════════════════════════════════════════════════════════════
//  schemas/disputes.ts — dispute-resolution input shapes
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

/** Legal resolution paths — mirrors the DB-side CHECK. */
export const DISPUTE_RESOLUTIONS = ['completed', 'cancelled', 'in_progress'] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

/* ─── admin_resolve_dispute(p_job_id, p_resolution, p_reason) ────────── */
export const adminResolveDisputeInput = z.object({
  p_job_id: uuid,
  p_resolution: z.enum(DISPUTE_RESOLUTIONS),
  p_reason: z
    .string()
    .trim()
    .min(1, { message: 'A reason is required for dispute resolution.' })
    .max(1000, { message: 'Reason must be 1000 characters or fewer.' }),
});
export type AdminResolveDisputeInput = z.infer<typeof adminResolveDisputeInput>;
