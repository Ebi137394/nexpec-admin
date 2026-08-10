// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobVisits.ts — site visits under a job
//
//  Reads the canonical RPCs from 20260801384000 / 20260801386000. Both are
//  authorization-gated in their own bodies; nothing here re-checks, because a
//  third layer only gives the three somewhere to disagree.
//
//  ── NO PRICING, STRUCTURALLY ───────────────────────────────────────────────
//  nx_job_visits and nx_visit_schedule_conflicts return no money column, so
//  payout, buyer price and platform margin have nowhere to land in these types.
//
//  ── THE LEGACY FALLBACK MATTERS ────────────────────────────────────────────
//  A job with no explicit job_visits rows returns ONE synthetic row with
//  fromFallback = true and visitId = null, built from jobs.scheduled_date.
//  Reading it writes nothing. The UI must show that as a schedule fallback, not
//  as a real visit record — a synthetic row has no id, so it cannot be
//  rescheduled, cancelled or crewed until an explicit visit is created.
// ════════════════════════════════════════════════════════════════════════════
import { formatScheduledDate, isCanonicalScheduledDate } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type VisitStatus =
  | 'planned' | 'scheduled' | 'in_progress'
  | 'completed' | 'cancelled' | 'rescheduled' | 'no_show';

export type VisitKind =
  | 'single' | 'recurring' | 'surveillance' | 'resident' | 'repeat' | 'followup';

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  single: 'Single visit',
  recurring: 'Recurring',
  surveillance: 'Surveillance',
  resident: 'Resident',
  repeat: 'Repeat',
  followup: 'Follow-up',
};

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  planned: 'Planned (no date)',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Superseded',
  no_show: 'No show',
};

export interface JobVisit {
  /** NULL for the synthetic legacy row — it has no database identity. */
  visitId: string | null;
  visitNumber: number;
  title: string | null;
  visitKind: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string | null;
  recurrenceGroupId: string | null;
  assignedCount: number;
  /** True when this row was synthesised from jobs.scheduled_date. */
  fromFallback: boolean;
}

function mapVisitRows(data: unknown): JobVisit[] {
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    visitId: (r.visit_id as string | null) ?? null,
    visitNumber: Number(r.visit_number ?? 0),
    title: (r.title as string | null) ?? null,
    visitKind: (r.visit_kind as string | null) ?? 'single',
    status: (r.status as string | null) ?? 'scheduled',
    scheduledStart: (r.scheduled_start as string | null) ?? null,
    scheduledEnd: (r.scheduled_end as string | null) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    recurrenceGroupId: (r.recurrence_group_id as string | null) ?? null,
    assignedCount: Number(r.assigned_count ?? 0),
    fromFallback: Boolean(r.from_fallback),
  }));
}

export async function fetchJobVisits(jobId: string): Promise<JobVisit[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_job_visits', { p_job_id: jobId });
  if (error) {
    // An empty list reads as "this job has no visits", which is a different
    // and misleading claim from "we could not load them".
    console.error('[jobVisits] load failed:', error.message);
    throw new Error(`Could not load visits: ${error.message}`);
  }
  return mapVisitRows(data);
}

export type JobVisitsRead =
  | { ok: true; visits: JobVisit[] }
  | { ok: false; unauthorized: boolean; message: string };

/**
 * Non-throwing read, for a visits panel EMBEDDED in a job page it does not own.
 *
 * fetchJobVisits throws, which is right for /admin/jobs/[id]/visits — the whole
 * page is the visit list. It is wrong for a panel on the inspector or buyer job
 * detail page: nx_job_visits raises 42501 for anyone who is merely browsing an
 * open job (an applicant who was never hired), and a throw there would take a
 * working page down over a section that person should simply not see.
 *
 * The distinction is preserved rather than flattened: `unauthorized` means "you
 * are not on this job", which the caller renders as nothing, while any other
 * failure is a genuine load error the caller may report.
 */
export async function readJobVisits(jobId: string): Promise<JobVisitsRead> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_job_visits', { p_job_id: jobId });
    if (error) {
      const unauthorized =
        /not authori[sz]ed|42501|not_authenticated|28000/i.test(error.message);
      if (!unauthorized) console.error('[jobVisits] panel load failed:', error.message);
      return { ok: false, unauthorized, message: error.message };
    }
    return { ok: true, visits: mapVisitRows(data) };
  } catch (e) {
    return {
      ok: false,
      unauthorized: false,
      message: e instanceof Error ? e.message : 'unexpected error',
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PRESENTATION — pure, shared by every non-admin visit surface
//
//  Ported deliberately from src/components/visits/JobVisitsPanel.tsx (mobile,
//  Phase 2C) so the two platforms cannot disagree about which visit is "now",
//  which is "next", or how a visit instant is written down. Pure functions, no
//  Supabase, no React — the same reason the mobile file keeps them separable.
// ════════════════════════════════════════════════════════════════════════════

/** Statuses that put a visit behind the viewer rather than ahead of them. */
export const TERMINAL_VISIT_STATUSES: readonly string[] = [
  'completed', 'cancelled', 'rescheduled', 'no_show',
];

export function isTerminalVisit(status: string): boolean {
  return TERMINAL_VISIT_STATUSES.includes(status);
}

/** Stable key for a row. The synthetic fallback has no visitId to key on. */
export function visitKey(v: JobVisit): string {
  return v.visitId ?? `fallback-${v.visitNumber}`;
}

function parseInstant(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Absolute date/time for a visit.
 *
 * `zoneLabel` is non-null ONLY when the value was genuinely rendered in that
 * zone. jobs.timezone is free text, and this runs on the server where the
 * process clock is not the viewer's clock — so if Intl refuses the zone we fall
 * back and say nothing, rather than stamping a zone name onto some other time.
 *
 * A noon-UTC anchor is a CALENDAR DATE (see @nexpec/shared-core scheduledDate),
 * not an instant: printing "12:00 PM" for it would be a fabricated time.
 */
export function formatVisitWhen(
  start: string | null,
  end: string | null,
  timezone: string | null,
): { when: string; zoneLabel: string | null; dated: boolean } {
  const d = parseInstant(start);
  if (!d) return { when: 'No date set', zoneLabel: null, dated: false };

  if (isCanonicalScheduledDate(d)) {
    return { when: formatScheduledDate(d), zoneLabel: null, dated: true };
  }

  const dateOpts: Intl.DateTimeFormatOptions = {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

  const tryFormat = (
    value: Date, opts: Intl.DateTimeFormatOptions, tz: string | null,
  ): string | null => {
    try {
      const out = new Intl.DateTimeFormat(
        'en-US', tz ? { ...opts, timeZone: tz } : opts,
      ).format(value);
      return out && out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };

  let zoneLabel: string | null = null;
  let base = timezone ? tryFormat(d, dateOpts, timezone) : null;
  if (base) zoneLabel = timezone;
  else base = tryFormat(d, dateOpts, null);
  if (!base) return { when: d.toISOString(), zoneLabel: null, dated: true };

  // A same-day end turns the row into a window, which is what people actually
  // plan around. A multi-day end is left off; the start still leads.
  const e = parseInstant(end);
  if (e && e.getTime() > d.getTime() && e.getTime() - d.getTime() < 86_400_000) {
    const endText = tryFormat(e, timeOpts, zoneLabel);
    if (endText) base = `${base} – ${endText}`;
  }

  return { when: base, zoneLabel, dated: true };
}

/** Calendar day of a visit start, read the same way it is rendered. */
function visitCalendarDay(d: Date): number {
  const [y, m, day] = isCanonicalScheduledDate(d)
    ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]
    : [d.getFullYear(), d.getMonth(), d.getDate()];
  return Date.UTC(y, m, day);
}

/** "Today" / "In 3 days" / "2 days ago", or null when the date speaks for itself. */
export function relativeDayLabel(start: string | null, now: Date): string | null {
  const d = parseInstant(start);
  if (!d) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((visitCalendarDay(d) - today) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff <= 6) return `In ${diff} days`;
  if (diff < -1 && diff >= -6) return `${-diff} days ago`;
  return null;
}

export interface VisitSummary {
  /** Chronological, undated visits last. This is a timeline, not a table. */
  ordered: JobVisit[];
  /** Key of the visit happening right now, if any. */
  currentKey: string | null;
  /** Key of the next visit ahead of the viewer, if any. */
  nextKey: string | null;
  /** True when the ONLY thing the job has is the synthetic schedule fallback. */
  fallbackOnly: boolean;
  /** Counts over real, non-cancelled visits — the programme, as planned. */
  planned: number;
  completed: number;
  cancelled: number;
}

/**
 * Order the visits and work out which one is current and which is next.
 *
 * Pure, so the "is this now?" question has exactly one answer across the
 * inspector panel, the buyer panel and the mobile screen.
 */
export function summariseVisits(rows: JobVisit[], now: Date): VisitSummary {
  const all = rows ?? [];
  const fallbackOnly = all.length > 0 && all.every((v) => v.fromFallback);

  // Defensive: the synthetic row is only ever returned alone. If a real visit
  // exists, the fallback is noise and must not be listed beside it.
  const real = all.filter((v) => !v.fromFallback);
  const list = real.length > 0 ? real : all;

  const ordered = [...list].sort((a, b) => {
    const ta = parseInstant(a.scheduledStart)?.getTime();
    const tb = parseInstant(b.scheduledStart)?.getTime();
    if (ta == null && tb == null) return a.visitNumber - b.visitNumber;
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return ta - tb;
    return a.visitNumber - b.visitNumber;
  });

  const nowMs = now.getTime();
  const live = ordered.filter((v) => !isTerminalVisit(v.status));

  const current =
    live.find((v) => v.status === 'in_progress') ??
    live.find((v) => {
      const s = parseInstant(v.scheduledStart);
      const e = parseInstant(v.scheduledEnd);
      return s != null && e != null && s.getTime() <= nowMs && e.getTime() >= nowMs;
    }) ??
    null;

  const currentKey = current ? visitKey(current) : null;
  const next =
    live.find((v) => {
      if (currentKey && visitKey(v) === currentKey) return false;
      const s = parseInstant(v.scheduledStart);
      return s != null && s.getTime() > nowMs;
    }) ?? null;

  const cancelled = ordered.filter((v) => v.status === 'cancelled').length;

  return {
    ordered,
    currentKey,
    nextKey: next ? visitKey(next) : null,
    fallbackOnly,
    planned: ordered.length - cancelled,
    completed: ordered.filter((v) => v.status === 'completed').length,
    cancelled,
  };
}

export interface VisitConflict {
  conflictCount: number;
  conflictDates: string[];
  visitScheduledAt: string | null;
  /** False when the visit itself has no date — distinct from "checked, none". */
  visitHasDate: boolean;
}

/**
 * Advisory clash preview for allocating an inspector to a visit.
 *
 * Delegates to nx_visit_schedule_conflicts, which shares its predicate with
 * nx_visit_assign_inspector, so the number shown before the click equals the
 * number the assignment reports after it.
 *
 * Failures degrade to a neutral result on purpose: a conflict hint decorates
 * the decision and must not take the visits page down.
 */
export async function fetchVisitConflicts(
  visitId: string,
  inspectorId: string,
): Promise<VisitConflict> {
  const neutral: VisitConflict = {
    conflictCount: 0, conflictDates: [], visitScheduledAt: null, visitHasDate: false,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_visit_schedule_conflicts', {
      p_visit_id: visitId,
      p_inspector_id: inspectorId,
    });
    if (error) return neutral;
    const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!r) return neutral;
    return {
      conflictCount: Number(r.conflict_count ?? 0),
      conflictDates: Array.isArray(r.conflict_dates) ? (r.conflict_dates as string[]) : [],
      visitScheduledAt: (r.visit_scheduled_at as string | null) ?? null,
      visitHasDate: Boolean(r.visit_has_date),
    };
  } catch {
    return neutral;
  }
}
