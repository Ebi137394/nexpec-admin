// ════════════════════════════════════════════════════════════════════════════
//  CANONICAL CONTRACT — jobs.scheduled_date
//
//  `jobs.scheduled_date` is TIMESTAMPTZ in Postgres, but the BUSINESS CONCEPT
//  it carries is a CALENDAR DATE: "the day the inspector shows up on site."
//  It has no meaningful time-of-day. Storing a calendar date in an instant
//  column is where every timezone bug in this codebase came from.
//
//  ── THE CONTRACT ───────────────────────────────────────────────────────────
//  A calendar date Y-M-D is serialized as the instant
//
//        YYYY-MM-DDT12:00:00.000Z          ("noon-UTC anchor")
//
//  derived from the user's LOCAL calendar components. Every platform uses the
//  functions in this file — there is no second implementation.
//
//  ── WHY NOON AND NOT MIDNIGHT ──────────────────────────────────────────────
//  Real UTC offsets run from UTC−12 to UTC+14. Anchoring at 12:00Z leaves 12h
//  of headroom westward and 11h59m eastward, so the anchor lands on the
//  intended calendar day for every viewer from UTC−11 through UTC+11. That
//  covers every timezone this product operates in (North America, Europe,
//  GCC). It does NOT cover UTC+12…UTC+14 (NZ/Fiji/Kiribati) or UTC−12 under
//  local-clock rendering — see `formatScheduledDate`, which sidesteps the
//  limitation entirely for canonical values by rendering in UTC.
//
//  Midnight-UTC would have ZERO westward headroom: 2026-09-15T00:00:00Z is
//  still 2026-09-14 for every viewer in the Americas. That was the web bug.
//
//  ── WHY LOCAL COMPONENTS, NEVER `.toISOString()` ───────────────────────────
//  A native date picker hands back a Date at LOCAL midnight. Calling
//  `.toISOString()` on it serializes the instant, not the date:
//
//        Montreal (UTC−4) picks Sep 15  →  2026-09-15T04:00:00.000Z
//        Berlin   (UTC+2) picks Sep 15  →  2026-09-14T22:00:00.000Z   ← wrong day
//
//  So we read getFullYear()/getMonth()/getDate() — the components the user
//  actually saw in the picker — and rebuild the anchor from those.
// ════════════════════════════════════════════════════════════════════════════

/** UTC hour at which a canonical calendar date is anchored. */
export const SCHEDULED_DATE_ANCHOR_HOUR_UTC = 12;

/** A calendar date with a 1-based month, as a human reads it off a calendar. */
export interface CalendarDate {
  year: number;
  /** 1-based: January is 1, not 0. */
  month: number;
  day: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Build the canonical anchor from explicit calendar components.
 * `month` is 1-based.
 */
export function canonicalScheduledDateFromParts(
  year: number,
  month: number,
  day: number,
): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}T12:00:00.000Z`;
}

/**
 * THE write-path function. Every create/edit form on every platform funnels
 * through this.
 *
 * Accepts either:
 *   • a `Date` from a native picker — LOCAL components are extracted (this is
 *     the part `.toISOString()` gets wrong), or
 *   • a date-only string `YYYY-MM-DD` from an `<input type="date">`, which is
 *     already timezone-free and is used verbatim.
 *
 * Returns the canonical ISO instant, or `null` for absent/unparseable input —
 * never a fabricated "today".
 */
export function toCanonicalScheduledDate(
  input: Date | string | null | undefined,
): string | null {
  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    // ★ LOCAL components on purpose. Do not "simplify" this to toISOString().
    return canonicalScheduledDateFromParts(
      input.getFullYear(),
      input.getMonth() + 1,
      input.getDate(),
    );
  }

  const raw = String(input).trim();
  if (raw.length === 0) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return canonicalScheduledDateFromParts(year, month, day);
}

/**
 * True when a stored instant carries the canonical noon-UTC anchor.
 *
 * This is the LEGACY DISCRIMINATOR. Rows written before this contract existed
 * hold a local-midnight instant, whose UTC time-of-day is the creator's negated
 * offset (04:00, 22:00, 18:30, …) — never exactly 12:00:00.000. The only offset
 * that could forge a collision is UTC−12, which has no civil population and is
 * not an IANA zone any device reports. So the test is exact in practice, and it
 * lets us render new rows correctly WITHOUT rewriting a single historical row.
 */
export function isCanonicalScheduledDate(value: Date | string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCHours() === SCHEDULED_DATE_ANCHOR_HOUR_UTC &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/** Read the intended calendar date back out of a stored canonical value. */
export function readCanonicalCalendarDate(
  value: Date | string | null | undefined,
): CalendarDate | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export interface FormatScheduledDateOptions {
  locale?: string;
  /** Rendered when the value is absent or unparseable. NEVER a real date. */
  fallback?: string;
}

/**
 * THE read-path function. One formatting contract for Client, Inspector,
 * Admin, marketplace cards — every surface.
 *
 * ── CANONICAL values (12:00:00.000Z) ──
 * Rendered in UTC. Because the stored anchor already IS the intended calendar
 * date, reading it back in UTC is exact in every timezone on Earth — including
 * the UTC+12…+14 zones that a local-clock render would break. There is no
 * residual drift window.
 *
 * ── LEGACY values (any other time-of-day) ──
 * Rendered in the VIEWER'S local zone, which is byte-for-byte what these
 * screens did before this change. Legacy rows are genuinely ambiguous: their
 * intended date is only recoverable in the CREATOR's zone, and that zone was
 * never recorded. Rendering them in UTC would silently shift every row created
 * at a positive offset back by one day. Preserving today's behaviour is the
 * least-risky option and rewrites nothing.
 *
 * These rows heal on their own — any edit through `toCanonicalScheduledDate`
 * promotes the row to the canonical branch.
 */
export function formatScheduledDate(
  value: Date | string | null | undefined,
  options: FormatScheduledDateOptions = {},
): string {
  const { locale = 'en-US', fallback = 'Not scheduled' } = options;

  if (value === null || value === undefined || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return fallback;

  const fmt: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  if (isCanonicalScheduledDate(d)) {
    fmt.timeZone = 'UTC';
  }

  try {
    return d.toLocaleDateString(locale, fmt);
  } catch {
    return fallback;
  }
}

/**
 * Value for prefilling an `<input type="date">` / picker from a stored row,
 * using the same branch logic as `formatScheduledDate` so that opening an edit
 * form never shifts the date the user is looking at.
 */
export function scheduledDateInputValue(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';

  if (isCanonicalScheduledDate(d)) {
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
