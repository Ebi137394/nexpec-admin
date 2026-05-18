// ════════════════════════════════════════════════════════════════════════════
//  schemas/jobs.ts — Zod schemas for every job-related mutation
//
//  Single source of truth for form validation. Mobile and web import the
//  same `inspectorStartJobInput` parser. The DB-side RPC validates again
//  (defense in depth), but client-side rejection saves a round trip.
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

/* ─── inspector_start_job(p_job_id uuid) ─────────────────────────────── */
export const inspectorStartJobInput = z.object({
  p_job_id: uuid,
});
export type InspectorStartJobInput = z.infer<typeof inspectorStartJobInput>;

/* ─── owner_cancel_job(p_job_id uuid, p_reason text) ─────────────────── */
export const ownerCancelJobInput = z.object({
  p_job_id: uuid,
  p_reason: z
    .string()
    .trim()
    .max(500, { message: 'Reason must be 500 characters or fewer.' })
    .optional()
    .nullable(),
});
export type OwnerCancelJobInput = z.infer<typeof ownerCancelJobInput>;

/* ─── admin_cancel_job(p_job_id uuid, p_reason text) ─────────────────── */
export const adminCancelJobInput = z.object({
  p_job_id: uuid,
  p_reason: z
    .string()
    .trim()
    .min(1, { message: 'A reason is required.' })
    .max(500, { message: 'Reason must be 500 characters or fewer.' }),
});
export type AdminCancelJobInput = z.infer<typeof adminCancelJobInput>;

/* ─── admin_dispatch_job(...) ────────────────────────────────────────── */
export const adminDispatchJobInput = z
  .object({
    p_job_id: uuid,
    p_application_id: uuid,
    p_client_price_cents: z
      .number()
      .int({ message: 'Cents must be an integer.' })
      .positive({ message: 'Client price must be greater than zero.' }),
    p_payout_cents: z
      .number()
      .int({ message: 'Cents must be an integer.' })
      .positive({ message: 'Inspector payout must be greater than zero.' }),
    p_payout_status: z.enum(['unpaid', 'pending', 'paid']).default('unpaid'),
  })
  .refine((v) => v.p_payout_cents <= v.p_client_price_cents, {
    message: 'Inspector payout cannot exceed client price.',
    path: ['p_payout_cents'],
  });
export type AdminDispatchJobInput = z.infer<typeof adminDispatchJobInput>;
