// src/components/visits/JobVisitsPanel.tsx — the inspector's view of a job's
// site visits.
//
// Drop into the existing Job Details screen next to JobTeamPanel. READ-ONLY by
// design: a normal inspector sees the schedule of the job they are on, and
// never gets visit management. nx_job_add_visit / nx_job_create_recurring_visits
// / nx_job_reschedule_visit / nx_job_cancel_visit / nx_visit_assign_inspector /
// nx_visit_schedule_conflicts are admin-gated in the database and are
// deliberately not referenced here at all, so this file cannot become an
// accidental scheduling surface.
//
// ── WHAT IT SHOWS ───────────────────────────────────────────────────────────
// Reads the canonical nx_job_visits(jobId), which authorises the caller in its
// own body (admin, job party, contracted inspector, or an active team member).
// An unrelated inspector gets an error, not an empty list, and this panel
// renders nothing rather than implying "no visits". 'rescheduled' rows are
// already filtered out server-side, so a superseded slot never appears here.
//
// ── PRIVACY ─────────────────────────────────────────────────────────────────
// The RPC returns no pricing column of any kind, so no payout, buyer price,
// platform margin or *_cents value can reach this component. Nothing here joins
// anything else — the row the database hands over is the row that is rendered.
//
// ── LEGACY JOBS ─────────────────────────────────────────────────────────────
// A job with no explicit job_visits rows returns ONE synthetic row with
// from_fallback = true and visit_id = null, synthesised from jobs.scheduled_date.
// That is a schedule fallback, not a visit record: it has no database identity,
// no crew and no history. Rendering it as a one-row "Site visits" card would
// claim this job has a visit plan when it has none, and would duplicate the
// scheduled date the Job Details screen already shows above. So, exactly like
// JobTeamPanel does for its team-of-one fallback, the panel hides itself.
//
// ── TIME RENDERING ──────────────────────────────────────────────────────────
// A real visit is an instant with a meaningful time of day, so it renders as
// date + time, in the visit's own timezone when the device's Intl can honour
// it. The synthetic fallback carries jobs.scheduled_date, which is a CALENDAR
// DATE stored at the noon-UTC anchor (see @nexpec/shared-core/domain/
// scheduledDate) — printing "12:00 PM" for it would be a fabricated time, so
// canonical anchors render date-only through formatScheduledDate. Every Intl
// call is guarded: Hermes' Intl does not support a `timeZone` for every zone on
// every device, and a schedule panel must degrade, not crash.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NEXPEC_THEME as T } from '../DynamicForm/theme';
import { supabase } from '@/lib/supabase';
import { formatScheduledDate, isCanonicalScheduledDate } from '@nexpec/shared-core';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** One row of nx_job_visits, in the shape the RPC returns it. */
export interface JobVisit {
  /** NULL for the synthetic legacy row — it has no database identity. */
  visit_id: string | null;
  visit_number: number;
  title: string | null;
  visit_kind: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  timezone: string | null;
  recurrence_group_id: string | null;
  assigned_count: number;
  /** True when this row was synthesised from jobs.scheduled_date. */
  from_fallback: boolean;
}

export const VISIT_STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Superseded',
  no_show: 'No show',
};

export const VISIT_KIND_LABELS: Record<string, string> = {
  single: 'Single visit',
  recurring: 'Recurring',
  surveillance: 'Surveillance',
  resident: 'Resident',
  repeat: 'Repeat',
  followup: 'Follow-up',
};

const STATUS_ICONS: Record<string, IoniconName> = {
  planned: 'ellipse-outline',
  scheduled: 'time-outline',
  in_progress: 'radio-button-on',
  completed: 'checkmark-circle',
  cancelled: 'close-circle-outline',
  rescheduled: 'repeat-outline',
  no_show: 'alert-circle-outline',
};

const STATUS_COLORS: Record<string, string> = {
  planned: T.colors.textMuted,
  scheduled: T.colors.textSecondary,
  in_progress: T.colors.primaryLight,
  completed: T.colors.success,
  cancelled: T.colors.error,
  rescheduled: T.colors.textMuted,
  no_show: T.colors.error,
};

/** Statuses that put a visit behind the inspector rather than ahead of them. */
const TERMINAL_STATUSES = ['completed', 'cancelled', 'rescheduled', 'no_show'];

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Stable identity for a row. The synthetic row has no visit_id to key on. */
export function visitKey(v: JobVisit): string {
  return v.visit_id ?? `fallback-${v.visit_number}`;
}

function parseInstant(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Absolute date/time for a visit.
 *
 * `zoneLabel` is only non-null when the value was genuinely rendered in that
 * zone — if Intl refused the timezone we fall back to the device clock and say
 * nothing, rather than stamping a zone name onto a local-time string.
 */
export function formatVisitWhen(
  start: string | null,
  end: string | null,
  timezone: string | null,
): { when: string; zoneLabel: string | null; dated: boolean } {
  const d = parseInstant(start);
  if (!d) return { when: 'No date set', zoneLabel: null, dated: false };

  // A noon-UTC anchor is a calendar date, not an instant: no time to show.
  if (isCanonicalScheduledDate(d)) {
    return { when: formatScheduledDate(d), zoneLabel: null, dated: true };
  }

  const dateOpts: Record<string, string> = {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  };
  const timeOpts: Record<string, string> = { hour: 'numeric', minute: '2-digit' };

  const tryFormat = (value: Date, opts: Record<string, string>, tz: string | null): string | null => {
    try {
      if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return null;
      const withTz = tz ? { ...opts, timeZone: tz } : opts;
      const out = new Intl.DateTimeFormat('en-US', withTz as Intl.DateTimeFormatOptions).format(value);
      return out && out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };

  let zoneLabel: string | null = null;
  let base = timezone ? tryFormat(d, dateOpts, timezone) : null;
  if (base) {
    zoneLabel = timezone;
  } else {
    base = tryFormat(d, dateOpts, null);
  }
  if (!base) {
    // Last resort: device clock components, no Intl involved at all.
    base = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    zoneLabel = null;
  }

  // A same-day end time turns the row into a window, which is what an inspector
  // actually plans around. A multi-day end is left off; the start still leads.
  const e = parseInstant(end);
  if (e && e.getTime() > d.getTime() && e.getTime() - d.getTime() < 24 * 60 * 60 * 1000) {
    const endText = tryFormat(e, timeOpts, zoneLabel);
    if (endText) base = `${base} – ${endText}`;
  }

  return { when: base, zoneLabel, dated: true };
}

/**
 * Calendar-day components of a visit start, read the same way it is rendered:
 * UTC for a canonical calendar-date anchor, device-local for a real instant.
 */
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
  const diff = Math.round((visitCalendarDay(d) - today) / 86400000);
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
}

/**
 * Order the visits and work out which one is current and which is next.
 *
 * Pure, so it is unit-testable without a renderer, and so the "is this now?"
 * question has exactly one answer in this file.
 */
export function summariseVisits(rows: JobVisit[], now: Date): VisitSummary {
  const all = rows ?? [];
  const fallbackOnly = all.length > 0 && all.every((v) => v.from_fallback);

  // Defensive: a synthetic row is only ever returned alone. If a real visit
  // exists, the fallback is noise and must not be listed beside it.
  const real = all.filter((v) => !v.from_fallback);
  const list = real.length > 0 ? real : all;

  const ordered = [...list].sort((a, b) => {
    const ta = parseInstant(a.scheduled_start)?.getTime();
    const tb = parseInstant(b.scheduled_start)?.getTime();
    if (ta == null && tb == null) return a.visit_number - b.visit_number;
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return ta - tb;
    return a.visit_number - b.visit_number;
  });

  const nowMs = now.getTime();
  const live = ordered.filter((v) => !TERMINAL_STATUSES.includes(v.status));

  const current =
    live.find((v) => v.status === 'in_progress') ??
    live.find((v) => {
      const s = parseInstant(v.scheduled_start);
      const e = parseInstant(v.scheduled_end);
      return s != null && e != null && s.getTime() <= nowMs && e.getTime() >= nowMs;
    }) ??
    null;

  const currentKey = current ? visitKey(current) : null;
  const next =
    live.find((v) => {
      if (currentKey && visitKey(v) === currentKey) return false;
      const s = parseInstant(v.scheduled_start);
      return s != null && s.getTime() > nowMs;
    }) ?? null;

  return { ordered, currentKey, nextKey: next ? visitKey(next) : null, fallbackOnly };
}

export function JobVisitsPanel({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<JobVisit[] | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('nx_job_visits', { p_job_id: jobId });
    if (rpcError) {
      // Not authorised is the normal case for someone merely browsing an open
      // job — that is not an error worth showing, so the panel hides itself.
      const notAuthorised = /not authorized|not authorised|42501/i.test(rpcError.message);
      setError(notAuthorised ? null : rpcError.message);
      setItems(notAuthorised ? [] : null);
      setLoading(false);
      return;
    }
    setItems((data ?? []) as JobVisit[]);
    setNow(new Date());
    setLoading(false);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={s.card}>
        <View style={s.headerRow}>
          <Ionicons name="calendar-outline" size={16} color={T.colors.textMuted} />
          <Text style={s.header}>Site visits</Text>
        </View>
        <ActivityIndicator style={{ marginTop: 12 }} color={T.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.card}>
        <View style={s.headerRow}>
          <Ionicons name="calendar-outline" size={16} color={T.colors.textMuted} />
          <Text style={s.header}>Site visits</Text>
        </View>
        <Text style={s.error}>Could not load the visit schedule. {error}</Text>
        <TouchableOpacity onPress={() => void load()} style={s.retry} accessibilityRole="button">
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rows = items ?? [];
  if (rows.length === 0) return null;

  const { ordered, currentKey, nextKey, fallbackOnly } = summariseVisits(rows, now);

  // Legacy job: one synthetic row built from jobs.scheduled_date is a schedule
  // fallback, not a visit plan. The Job Details screen already shows that date.
  if (fallbackOnly) return null;

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name="calendar-outline" size={16} color={T.colors.textMuted} />
        <Text style={s.header}>
          Site visits{ordered.length > 1 ? ` · ${ordered.length}` : ''}
        </Text>
      </View>

      {ordered.map((v) => {
        const key = visitKey(v);
        const isCurrent = key === currentKey;
        const isNext = key === nextKey;
        const isTerminal = TERMINAL_STATUSES.includes(v.status);
        const { when, zoneLabel } = formatVisitWhen(v.scheduled_start, v.scheduled_end, v.timezone);
        const relative = isTerminal ? null : relativeDayLabel(v.scheduled_start, now);
        const statusColor = STATUS_COLORS[v.status] ?? T.colors.textSecondary;
        const statusIcon: IoniconName = STATUS_ICONS[v.status] ?? 'ellipse-outline';

        return (
          <View key={key} style={[s.row, isCurrent && s.rowCurrent]}>
            <View style={s.rowMain}>
              <View style={s.titleLine}>
                <Text style={[s.name, isTerminal && s.nameMuted]} numberOfLines={1}>
                  Visit {v.visit_number}
                  {v.title ? ` · ${v.title}` : ''}
                </Text>
                {v.recurrence_group_id != null && (
                  <View style={s.seriesChip}>
                    <Ionicons name="repeat-outline" size={11} color={T.colors.primaryLight} />
                    <Text style={s.seriesText}>Series</Text>
                  </View>
                )}
              </View>

              <Text style={s.meta} numberOfLines={2}>
                {when}
                {zoneLabel ? ` · ${zoneLabel}` : ''}
                {` · ${VISIT_KIND_LABELS[v.visit_kind] ?? v.visit_kind}`}
                {v.assigned_count > 0 ? ` · ${v.assigned_count} assigned` : ''}
              </Text>

              <View style={s.statusLine}>
                <Ionicons name={statusIcon} size={11} color={statusColor} />
                <Text style={[s.statusText, { color: statusColor }]}>
                  {VISIT_STATUS_LABELS[v.status] ?? v.status}
                </Text>
                {relative != null && <Text style={s.relative}>{relative}</Text>}
              </View>
            </View>

            {isCurrent ? (
              <View style={s.nowChip}>
                <Ionicons name="radio-button-on" size={11} color={T.colors.primaryLight} />
                <Text style={s.nowText}>Now</Text>
              </View>
            ) : isNext ? (
              <View style={s.nextChip}>
                <Ionicons name="arrow-forward" size={11} color={T.colors.textSecondary} />
                <Text style={s.nextText}>Next</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.colors.cardBackground,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: T.colors.inputBorder,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { color: T.colors.text, fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 10, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.colors.inputBorder,
    marginTop: 2,
  },
  rowCurrent: {
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderRadius: 10,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  rowMain: { flexShrink: 1, flexGrow: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: T.colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  nameMuted: { color: T.colors.textSecondary },
  meta: { color: T.colors.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  statusText: { fontSize: 10, fontWeight: '700' },
  relative: { color: T.colors.textMuted, fontSize: 10, fontWeight: '600' },
  seriesChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(124,58,237,0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  seriesText: { color: T.colors.primaryLight, fontSize: 10, fontWeight: '700' },
  nowChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(124,58,237,0.16)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  nowText: { color: T.colors.primaryLight, fontSize: 10, fontWeight: '700' },
  nextChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(148,163,184,0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  nextText: { color: T.colors.textSecondary, fontSize: 10, fontWeight: '700' },
  error: { color: T.colors.error, fontSize: 12, marginTop: 10 },
  retry: { marginTop: 8, alignSelf: 'flex-start' },
  retryText: { color: T.colors.primary, fontSize: 12, fontWeight: '700' },
});

export default JobVisitsPanel;
