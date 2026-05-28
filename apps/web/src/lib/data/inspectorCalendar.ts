// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/inspectorCalendar.ts
//
//  Sprint 13.5 — Inspector Calendar web data fetcher.
//
//  Reads the calling inspector's assigned + hired jobs that have a
//  scheduled_date set. The mobile CalendarSync service (already shipped)
//  uses the same source columns, so events stay consistent across
//  surfaces. Conflict detection runs in-memory after fetch.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface CalendarEvent {
  id: string;
  title: string;
  status: string;
  domain: string | null;
  scheduledStart: string; // ISO
  /** ISO end (synthesised from estimated_duration_minutes when known). */
  scheduledEnd: string;
  location: string | null;
  href: string;
  /** Other events on the same day that overlap this one. */
  conflicts: string[];
}

const DEFAULT_DURATION_MINUTES = 60;

interface JobRow {
  id: string;
  title: string | null;
  status: string | null;
  domain: string | null;
  scheduled_date: string | null;
  location: string | null;
  location_city: string | null;
}

export interface CalendarRange {
  fromIso: string;
  toIso: string;
}

/**
 * Compute the start (Sunday) of the calendar grid that contains the
 * first of `month`. Months span ~6 weeks max.
 */
export function gridRangeForMonth(monthDate: Date): CalendarRange {
  const firstOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1,
  );
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 42);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

/**
 * Fetch the current inspector's calendar events within `range`. Never
 * throws — returns [] on any error.
 */
export async function fetchInspectorCalendarEvents(
  range: CalendarRange,
): Promise<CalendarEvent[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  try {
    const { data, error } = await supabase
      .from('jobs')
      .select(
        'id, title, status, domain, scheduled_date, location, location_city, assigned_inspector_id, hired_inspector_id, inspector_id',
      )
      .or(
        `assigned_inspector_id.eq.${user.id},hired_inspector_id.eq.${user.id},inspector_id.eq.${user.id}`,
      )
      .gte('scheduled_date', range.fromIso)
      .lt('scheduled_date', range.toIso)
      .not('scheduled_date', 'is', null)
      .is('deleted_at', null);

    if (error) {
      console.error('[inspectorCalendar] query error', error);
      return [];
    }

    const rows = ((data ?? []) as Array<JobRow & { id: string }>).map(
      (j) => normaliseEvent(j),
    );

    return computeConflicts(rows);
  } catch (err) {
    console.error('[inspectorCalendar] threw', err);
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────────── */

function normaliseEvent(j: JobRow): CalendarEvent {
  const start = j.scheduled_date ?? new Date().toISOString();
  const startDate = new Date(start);
  const endDate = new Date(
    startDate.getTime() + DEFAULT_DURATION_MINUTES * 60 * 1000,
  );
  return {
    id: j.id,
    title: j.title ?? 'Untitled job',
    status: j.status ?? 'unknown',
    domain: j.domain,
    scheduledStart: startDate.toISOString(),
    scheduledEnd: endDate.toISOString(),
    location: j.location || j.location_city || null,
    href: `/inspector/jobs/${j.id}`,
    conflicts: [],
  };
}

/**
 * Two events conflict when their [start, end) intervals overlap.
 * Naive O(n²) is fine for inspector-scale event counts (<200 / month).
 */
function computeConflicts(events: CalendarEvent[]): CalendarEvent[] {
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (!a) continue;
    const aStart = Date.parse(a.scheduledStart);
    const aEnd = Date.parse(a.scheduledEnd);
    for (let k = 0; k < events.length; k++) {
      if (i === k) continue;
      const b = events[k];
      if (!b) continue;
      const bStart = Date.parse(b.scheduledStart);
      const bEnd = Date.parse(b.scheduledEnd);
      if (aStart < bEnd && bStart < aEnd) {
        a.conflicts.push(b.id);
      }
    }
  }
  return events;
}

/* ─────────────────────────────────────────────────────────────────── */

/** Same query as fetchInspectorCalendarEvents but without date range —
 *  used by the .ics feed export. */
export async function fetchAllUpcomingInspectorEvents(): Promise<
  CalendarEvent[]
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  try {
    const horizon = new Date();
    horizon.setMonth(horizon.getMonth() + 12); // 1 year horizon
    const past = new Date();
    past.setMonth(past.getMonth() - 1); // include recent past for diary

    const { data, error } = await supabase
      .from('jobs')
      .select(
        'id, title, status, domain, scheduled_date, location, location_city, assigned_inspector_id, hired_inspector_id, inspector_id',
      )
      .or(
        `assigned_inspector_id.eq.${user.id},hired_inspector_id.eq.${user.id},inspector_id.eq.${user.id}`,
      )
      .gte('scheduled_date', past.toISOString())
      .lt('scheduled_date', horizon.toISOString())
      .not('scheduled_date', 'is', null)
      .is('deleted_at', null);

    if (error) {
      console.error('[inspectorCalendar] feed error', error);
      return [];
    }

    return ((data ?? []) as Array<JobRow & { id: string }>).map(normaliseEvent);
  } catch (err) {
    console.error('[inspectorCalendar] feed threw', err);
    return [];
  }
}
