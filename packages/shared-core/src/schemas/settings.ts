// ════════════════════════════════════════════════════════════════════════════
//  schemas/settings.ts — platform fee schedule input
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const bps = (max: number) =>
  z
    .number()
    .int({ message: 'Basis points must be an integer.' })
    .min(0, { message: 'Cannot be negative.' })
    .max(max, { message: `Maximum is ${max} basis points.` });

export const adminSetFeeScheduleInput = z.object({
  p_client_commission_bps: bps(5000),
  p_stripe_application_fee_bps: bps(2000),
  p_dispute_fee_cents: z
    .number()
    .int()
    .min(0)
    .max(100_000, { message: 'Dispute fee cap is $1,000.' }),
  p_payout_fee_bps: bps(1000),
  p_reason: z
    .string()
    .trim()
    .min(1, { message: 'A reason is required (audit-critical).' })
    .max(1000, { message: 'Reason must be 1000 characters or fewer.' }),
});
export type AdminSetFeeScheduleInput = z.infer<typeof adminSetFeeScheduleInput>;

/** Helper — render bps as a human percent string ("250" → "2.50%"). */
export function bpsToPercentString(bpsVal: number | null | undefined): string {
  if (bpsVal === null || bpsVal === undefined || !Number.isFinite(bpsVal)) return '—';
  return (bpsVal / 100).toFixed(2) + '%';
}

/** Helper — parse user-typed percent string ("2.5" → 250 bps). */
export function percentStringToBps(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
