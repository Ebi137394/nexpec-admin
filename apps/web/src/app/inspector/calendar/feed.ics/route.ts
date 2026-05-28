// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/inspector/calendar/feed.ics/route.ts
//
//  Dynamic iCal (.ics) feed for the signed-in inspector. Compatible with
//  Apple Calendar, Google Calendar, Outlook, etc.
//
//  Auth is enforced via the underlying fetchAllUpcomingInspectorEvents()
//  — RLS on jobs already gates rows to the assigned inspector.
//
//  Cache-Control: no-store so subscribers always see the latest state.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { fetchAllUpcomingInspectorEvents } from '@/lib/data/inspectorCalendar';

export const dynamic = 'force-dynamic';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a Date as a UTC iCal stamp (YYYYMMDDTHHMMSSZ). */
function icalUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** Escape a text field for iCal: commas, semicolons, backslashes, newlines. */
function icalText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a single iCal line to ≤75 octets per RFC 5545. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const slice = line.slice(i, i + (i === 0 ? 75 : 74));
    out.push((i === 0 ? '' : ' ') + slice);
    i += i === 0 ? 75 : 74;
  }
  return out.join('\r\n');
}

export async function GET() {
  const events = await fetchAllUpcomingInspectorEvents();
  const now = new Date();

  const siteOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    'https://nexpecapp.com';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NEXPEC//Inspector Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:NEXPEC Inspections'),
    fold('X-WR-CALDESC:Your assigned NEXPEC inspections'),
  ];

  for (const e of events) {
    const start = new Date(e.scheduledStart);
    const end = new Date(e.scheduledEnd);
    const titleParts = [e.title];
    if (e.domain) titleParts.push(`[${e.domain}]`);
    const summary = icalText(titleParts.join(' '));

    const description = icalText(
      [
        `Job: ${e.title}`,
        e.status ? `Status: ${e.status}` : '',
        e.domain ? `Domain: ${e.domain}` : '',
        e.conflicts.length > 0
          ? `⚠ Conflicts with ${e.conflicts.length} other job(s)`
          : '',
        '',
        `Open on NEXPEC: ${siteOrigin}${e.href}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );

    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${e.id}@nexpec.app`));
    lines.push(fold(`DTSTAMP:${icalUtc(now)}`));
    lines.push(fold(`DTSTART:${icalUtc(start)}`));
    lines.push(fold(`DTEND:${icalUtc(end)}`));
    lines.push(fold(`SUMMARY:${summary}`));
    if (e.location) lines.push(fold(`LOCATION:${icalText(e.location)}`));
    lines.push(fold(`DESCRIPTION:${description}`));
    lines.push(fold(`URL:${siteOrigin}${e.href}`));
    lines.push(fold(`STATUS:${(e.status ?? 'CONFIRMED').toUpperCase()}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Disposition': 'inline; filename="nexpec-inspections.ics"',
    },
  });
}
