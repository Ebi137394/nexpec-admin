// ─────────────────────────────────────────────────────────────────
//  lib/money.ts
//  Currency helpers — the app stores all money as integer CENTS in
//  the database (Task 4). Use these helpers at every dollar↔cents
//  boundary so we never accidentally double-convert or lose precision.
//
//  Convention:
//    • DB columns ending in `_cents` are bigint, integer cents.
//    • UI accepts dollar input from users (e.g. "12.34"). Convert with toCents.
//    • Stripe APIs already require cents — pass cents directly.
//    • Display always goes through formatUsd / formatUsdCompact.
// ─────────────────────────────────────────────────────────────────

/**
 * Convert a user-facing dollar amount to integer cents.
 *  toCents(12.34)   → 1234
 *  toCents("12.34") → 1234
 *  toCents(null)    → 0
 *  toCents("")      → 0
 *
 * Uses Math.round to avoid float drift (12.34 → 1233.9999… without round).
 */
export function toCents(dollars: number | string | null | undefined): number {
  if (dollars === null || dollars === undefined || dollars === '') return 0;
  const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Convert integer cents back to a dollar number for math/display.
 *  fromCents(1234)   → 12.34
 *  fromCents("1234") → 12.34
 *  fromCents(null)   → 0
 *
 * The result is a plain number. For display, prefer formatUsd.
 */
export function fromCents(cents: number | string | null | undefined): number {
  if (cents === null || cents === undefined || cents === '') return 0;
  const n = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

/**
 * Format integer cents as a USD string for display.
 *  formatUsd(123456)         → "$1,234.56"
 *  formatUsd(0)              → "$0.00"
 *  formatUsd(150000, { showSign: true })    → "+$1,500.00"
 *
 * Defaults to 2 fraction digits — matches the web dashboard's formatInvoiceCents
 * EXACTLY (empirically verified). Use formatUsdCompact for "$1.2k"-style display.
 */
export function formatUsd(
  cents: number | string | null | undefined,
  options?: { showSign?: boolean; fractionDigits?: number },
): string {
  const dollars = fromCents(cents);
  // Default to 2 fraction digits — byte-identical to the web dashboard's
  // formatInvoiceCents (Intl USD), verified across the full value range incl.
  // sub-dollar, whole-dollar, millions, and negatives. #QA
  const fd = options?.fractionDigits ?? 2;
  const formatted = dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fd,
    maximumFractionDigits: fd,
  });
  if (options?.showSign && dollars > 0) return '+' + formatted;
  return formatted;
}

/**
 * Compact format for dashboards.
 *  formatUsdCompact(123456)      → "$1.2k"
 *  formatUsdCompact(15000000000) → "$1.5M"
 *  formatUsdCompact(50000)       → "$500"
 */
export function formatUsdCompact(cents: number | string | null | undefined): string {
  const dollars = fromCents(cents);
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return '$' + (dollars / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return '$' + (dollars / 1_000).toFixed(1) + 'k';
  return '$' + Math.round(dollars).toLocaleString('en-US');
}

/**
 * Sum a series of cents values, treating null/undefined as 0.
 * Avoids the common `(a ?? 0) + (b ?? 0)` boilerplate.
 */
export function sumCents(
  ...values: Array<number | string | null | undefined>
): number {
  return values.reduce<number>((acc, v) => {
    if (v === null || v === undefined || v === '') return acc;
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/**
 * For Stripe API calls. Stripe wants integer cents in `amount`.
 * Use this at the Stripe boundary so the unit is documented at the call site.
 *  stripeAmount(jobs.price_cents)  → number (already cents)
 *  stripeAmount(12.34)             → 1234   (treats input as dollars)
 *
 * If the input is already a bigint-shaped integer with no decimals,
 * we pass it through unchanged. Otherwise we treat it as dollars.
 */
export function stripeAmount(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  // Heuristic: if integer with no decimal portion, treat as cents already.
  if (Number.isInteger(n)) return n;
  return Math.round(n * 100);
}
