// ════════════════════════════════════════════════════════════════════════════
//  domain/money.ts
//
//  Cents-as-integer is the only currency representation that crosses
//  process boundaries in NEXPEC. Floats are forbidden for ledger values.
//  These helpers are the only sanctioned bridge between human-typed
//  decimals and integer cents.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Convert a user-typed decimal string ("1234.56", "1,234.56", "$1,234.56")
 * to an integer-cents value. Returns null on un-parseable input.
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const raw = typeof input === 'number' ? String(input) : input;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

/**
 * Format an integer cents value as a display string. Locale-aware, but
 * defaults to en-US for predictability across mobile / web.
 */
export interface FormatCentsOptions {
  locale?: string;
  currency?: string;
  /** Default: true. Show cents on every value, even round dollars. */
  showCents?: boolean;
}

export function formatCents(
  cents: number | null | undefined,
  options: FormatCentsOptions = {},
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '—';
  }
  const { locale = 'en-US', currency = 'USD', showCents = true } = options;
  const value = cents / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(value);
}

/** Same as formatCents but always rounds to whole dollars. */
export function formatCentsCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return formatCents(Math.round(cents / 100) * 100, { showCents: false });
}

/**
 * Compute the platform spread (client_price - inspector_payout) and the
 * inspector's share as a percentage. Returns null components for missing
 * inputs to keep the call-site UI defensive.
 */
export function jobSpread(
  clientPriceCents: number | null | undefined,
  inspectorPayoutCents: number | null | undefined,
): {
  spreadCents: number | null;
  inspectorSharePct: number | null;
} {
  if (
    typeof clientPriceCents !== 'number' ||
    typeof inspectorPayoutCents !== 'number' ||
    clientPriceCents <= 0
  ) {
    return { spreadCents: null, inspectorSharePct: null };
  }
  const spreadCents = clientPriceCents - inspectorPayoutCents;
  const inspectorSharePct = Math.round((inspectorPayoutCents / clientPriceCents) * 100);
  return { spreadCents, inspectorSharePct };
}
