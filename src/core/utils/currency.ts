// ============================================================================
// CURRENCY UTIL — Integer halala math (100 halalas = 1 SAR)
// All arithmetic stays in the integer domain.
// Conversion to float happens ONLY at the display boundary (formatHalalas).
// ============================================================================

export const HALALA_PER_SAR = 100 as const;
export const TAX_ESTIMATE_RATE = 0.25 as const;
export const PLATFORM_FEE_RATE = 0.15 as const;

/** Convert a SAR decimal input → integer halalas. Use for DB writes only. */
export function sarToHalalas(sar: number): number {
  return Math.round(sar * HALALA_PER_SAR);
}

/** Convert integer halalas → SAR decimal. Use only at display boundary. */
export function halalaToSAR(halalas: number): number {
  return halalas / HALALA_PER_SAR;
}

/**
 * Format integer halalas as a SAR string.
 * Uses en-US locale deliberately — ar-SA renders the legacy ﷼ glyph on
 * some Android versions instead of the "SAR" ISO code.
 */
export function formatHalalas(halalas: number, compact = false): string {
  const sar = halalaToSAR(halalas);
  if (compact && Math.abs(sar) >= 1_000) {
    return new Intl.NumberFormat('en-US', {
      style:                 'currency',
      currency:              'SAR',
      notation:              'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(sar);
  }
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'SAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(sar);
}

/** Safe integer platform fee calculation — rounds at the DB unit boundary. */
export function calcPlatformFeeHalalas(
  grossHalalas: number,
  feeRate = PLATFORM_FEE_RATE
): number {
  return Math.round(grossHalalas * feeRate);
}

/** YTD gross × 25% tax estimate — fully integer. */
export function calcTaxEstimateHalalas(ytdGrossHalalas: number): number {
  return Math.round(ytdGrossHalalas * TAX_ESTIMATE_RATE);
}

/** YTD gross × 25% tax estimate — fully integer. */
export function calcTaxEstimateCents(ytdGrossCents: number): number {
  return Math.round(ytdGrossCents * TAX_ESTIMATE_RATE);
}

/** Format HH:MM:SS from raw seconds. */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}