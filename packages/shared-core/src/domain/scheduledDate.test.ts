// ════════════════════════════════════════════════════════════════════════════
//  domain/scheduledDate.test.ts
//
//  Proves the canonical calendar-date contract survives a real timezone
//  spread. The pre-change behaviour FAILED these: web wrote midnight-UTC
//  (wrong day for every viewer in the Americas) and mobile wrote
//  `pickerDate.toISOString()` (wrong day for every creator east of Greenwich).
//
//  TZ is mutated per case. Node re-reads process.env.TZ for Dates constructed
//  afterwards; `assertTzActive` makes the suite fail LOUDLY rather than pass
//  vacuously if that ever stops holding.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterAll } from 'vitest';
import {
  toCanonicalScheduledDate,
  canonicalScheduledDateFromParts,
  isCanonicalScheduledDate,
  readCanonicalCalendarDate,
  formatScheduledDate,
  scheduledDateInputValue,
} from './scheduledDate';

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

/** The three zones the launch markets actually live in. */
const ZONES = [
  { tz: 'America/Toronto', label: 'Montreal / Toronto (UTC−4 in Sept)', offsetMin: 240 },
  { tz: 'Europe/Berlin', label: 'Berlin (UTC+2 in Sept)', offsetMin: -120 },
  { tz: 'Asia/Dubai', label: 'Dubai (UTC+4, no DST)', offsetMin: -240 },
] as const;

function withTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = prev;
  }
}

/** Guard: confirm the TZ switch really took effect for this runtime. */
function assertTzActive(expectedOffsetMin: number) {
  const probe = new Date(2026, 8, 15, 0, 0, 0, 0); // Sept 15 2026, local
  expect(probe.getTimezoneOffset()).toBe(expectedOffsetMin);
}

/** What a native date picker hands back: LOCAL midnight on the chosen day. */
function pickerDateFor(year: number, month1Based: number, day: number): Date {
  return new Date(year, month1Based - 1, day, 0, 0, 0, 0);
}

const CANONICAL_SEP_15 = '2026-09-15T12:00:00.000Z';

describe('canonical serialization — write path', () => {
  it('builds the noon-UTC anchor from explicit parts', () => {
    expect(canonicalScheduledDateFromParts(2026, 9, 15)).toBe(CANONICAL_SEP_15);
  });

  it('web: a date-only <input type="date"> value is timezone-free', () => {
    expect(toCanonicalScheduledDate('2026-09-15')).toBe(CANONICAL_SEP_15);
  });

  for (const zone of ZONES) {
    it(`mobile: picking Sep 15 in ${zone.label} serializes to the SAME anchor`, () => {
      withTz(zone.tz, () => {
        assertTzActive(zone.offsetMin);
        const picked = pickerDateFor(2026, 9, 15);
        expect(toCanonicalScheduledDate(picked)).toBe(CANONICAL_SEP_15);
      });
    });

    it(`mobile: raw .toISOString() in ${zone.label} is what we must NOT ship`, () => {
      withTz(zone.tz, () => {
        assertTzActive(zone.offsetMin);
        const picked = pickerDateFor(2026, 9, 15);
        // Documents the defect: only a UTC+0 device would coincide with the
        // canonical day, and never with the canonical time-of-day.
        expect(picked.toISOString()).not.toBe(CANONICAL_SEP_15);
      });
    });
  }

  it('Berlin: raw .toISOString() lands on the PREVIOUS calendar day', () => {
    withTz('Europe/Berlin', () => {
      assertTzActive(-120);
      expect(pickerDateFor(2026, 9, 15).toISOString()).toBe('2026-09-14T22:00:00.000Z');
    });
  });

  it('web + mobile agree byte-for-byte across all three zones', () => {
    const fromWeb = toCanonicalScheduledDate('2026-09-15');
    const fromMobile = ZONES.map((z) =>
      withTz(z.tz, () => toCanonicalScheduledDate(pickerDateFor(2026, 9, 15))),
    );
    expect(new Set([fromWeb, ...fromMobile]).size).toBe(1);
  });

  it('never fabricates a date for absent or malformed input', () => {
    expect(toCanonicalScheduledDate(null)).toBeNull();
    expect(toCanonicalScheduledDate(undefined)).toBeNull();
    expect(toCanonicalScheduledDate('')).toBeNull();
    expect(toCanonicalScheduledDate('   ')).toBeNull();
    expect(toCanonicalScheduledDate('not-a-date')).toBeNull();
    expect(toCanonicalScheduledDate('2026-13-01')).toBeNull();
    expect(toCanonicalScheduledDate(new Date(NaN))).toBeNull();
  });

  it('pads single-digit months and days', () => {
    withTz('America/Toronto', () => {
      expect(toCanonicalScheduledDate(pickerDateFor(2026, 1, 5))).toBe(
        '2026-01-05T12:00:00.000Z',
      );
    });
  });
});

describe('canonical display — read path', () => {
  for (const zone of ZONES) {
    it(`a canonical Sep 15 renders as Sep 15 to a viewer in ${zone.label}`, () => {
      withTz(zone.tz, () => {
        assertTzActive(zone.offsetMin);
        expect(formatScheduledDate(CANONICAL_SEP_15)).toBe('Sep 15, 2026');
      });
    });
  }

  it('renders identically in every zone (no viewer-dependent drift)', () => {
    const rendered = ZONES.map((z) => withTz(z.tz, () => formatScheduledDate(CANONICAL_SEP_15)));
    expect(new Set(rendered).size).toBe(1);
  });

  it('holds even at the extreme offsets noon-UTC was chosen to survive', () => {
    for (const tz of ['Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Midway']) {
      expect(withTz(tz, () => formatScheduledDate(CANONICAL_SEP_15))).toBe('Sep 15, 2026');
    }
  });

  it('round-trips the calendar date', () => {
    expect(readCanonicalCalendarDate(CANONICAL_SEP_15)).toEqual({
      year: 2026,
      month: 9,
      day: 15,
    });
  });

  it('prefills an edit form without shifting the date', () => {
    for (const z of ZONES) {
      expect(withTz(z.tz, () => scheduledDateInputValue(CANONICAL_SEP_15))).toBe('2026-09-15');
    }
  });

  it('shows the fallback — never a fabricated "today" — for missing values', () => {
    expect(formatScheduledDate(null)).toBe('Not scheduled');
    expect(formatScheduledDate(undefined)).toBe('Not scheduled');
    expect(formatScheduledDate('')).toBe('Not scheduled');
    expect(formatScheduledDate('garbage')).toBe('Not scheduled');
    expect(formatScheduledDate(null, { fallback: 'N/A' })).toBe('N/A');
  });
});

describe('legacy rows — discriminated, preserved, not rewritten', () => {
  // What mobile actually wrote before this contract existed.
  const LEGACY_FROM_TORONTO = '2026-09-15T04:00:00.000Z'; // local midnight, UTC−4
  const LEGACY_FROM_BERLIN = '2026-09-14T22:00:00.000Z'; // local midnight, UTC+2

  it('recognises canonical values', () => {
    expect(isCanonicalScheduledDate(CANONICAL_SEP_15)).toBe(true);
  });

  it('recognises legacy values as NOT canonical', () => {
    expect(isCanonicalScheduledDate(LEGACY_FROM_TORONTO)).toBe(false);
    expect(isCanonicalScheduledDate(LEGACY_FROM_BERLIN)).toBe(false);
    expect(isCanonicalScheduledDate(null)).toBe(false);
    expect(isCanonicalScheduledDate('garbage')).toBe(false);
  });

  it('legacy rows keep their pre-change rendering in the creator zone', () => {
    // Byte-identical to the old viewer-local behaviour: no silent history shift.
    expect(withTz('America/Toronto', () => formatScheduledDate(LEGACY_FROM_TORONTO))).toBe(
      'Sep 15, 2026',
    );
    expect(withTz('Europe/Berlin', () => formatScheduledDate(LEGACY_FROM_BERLIN))).toBe(
      'Sep 15, 2026',
    );
  });

  it('a legacy row promotes to canonical once re-saved through the helper', () => {
    withTz('Europe/Berlin', () => {
      const reSaved = toCanonicalScheduledDate(new Date(LEGACY_FROM_BERLIN));
      expect(reSaved).toBe(CANONICAL_SEP_15);
      expect(isCanonicalScheduledDate(reSaved)).toBe(true);
    });
  });
});
