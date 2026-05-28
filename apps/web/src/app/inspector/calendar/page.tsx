// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/inspector/calendar/page.tsx
//
//  Sprint 13.5 — Inspector Calendar web.
//
//  Two views in one page: a 6-week month grid + an agenda list. The
//  ?month=YYYY-MM URL param controls the grid; agenda list shows next 30
//  days from today regardless. Each event carries a conflict flag when it
//  overlaps another assigned job — flagged in the UI with a small chip.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Calendar as CalendarIcon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Download,
  MapPin,
} from 'lucide-react';
import {
  fetchInspectorCalendarEvents,
  gridRangeForMonth,
  type CalendarEvent,
} from '@/lib/data/inspectorCalendar';

export const metadata: Metadata = { title: 'Calendar · Inspector · NEXPEC' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ month?: string }>;
}

export default async function InspectorCalendarPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const month = parseMonthParam(sp.month);
  const range = gridRangeForMonth(month);
  const events = await fetchInspectorCalendarEvents(range);

  return (
    <div className="space-y-8">
      <Header month={month} />
      <MonthGrid month={month} events={events} />
      <AgendaList events={events} />
      <Footnote />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function parseMonthParam(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [yStr, mStr] = raw.split('-');
    if (yStr && mStr) {
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
        return new Date(y, m - 1, 1);
      }
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function monthHref(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `/inspector/calendar?month=${yyyy}-${mm}`;
}

function shiftMonth(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Header({ month }: { month: Date }) {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
          <CalendarIcon className="h-3 w-3" strokeWidth={2} />
          Inspector · Schedule
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {formatMonthLabel(month)}
        </h1>
        <p className="max-w-xl text-sm text-zinc-400">
          Every job assigned to you that has a scheduled date. Overlapping
          jobs are flagged so you can resolve double-bookings before they
          become a problem on site.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={monthHref(prev)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-violet-200"
          aria-label="Previous month"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        </Link>
        <Link
          href="/inspector/calendar"
          className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 font-mono text-[11px] uppercase tracking-industrial text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-violet-200"
        >
          Today
        </Link>
        <Link
          href={monthHref(next)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-violet-200"
          aria-label="Next month"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Link>
        <a
          href="/inspector/calendar/feed.ics"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.16] hover:text-violet-100"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
          .ics feed
        </a>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function MonthGrid({ month, events }: { month: Date; events: CalendarEvent[] }) {
  const range = gridRangeForMonth(month);
  const start = new Date(range.fromIso);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  const today = new Date();

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const d = new Date(e.scheduledStart);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const arr = eventsByDay.get(key) ?? [];
    arr.push(e);
    eventsByDay.set(key, arr);
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-4 sm:p-6">
      {/* Weekday header */}
      <div className="mb-2 grid grid-cols-7 gap-px text-center font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const todayClass = isSameDay(d, today)
            ? 'border-violet-500/40 bg-violet-500/[0.08]'
            : 'border-white/[0.04] bg-white/[0.01]';
          const monthClass = inMonth ? 'text-zinc-100' : 'text-zinc-600';
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const evs = eventsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-[90px] rounded-lg border p-1.5 sm:min-h-[110px] sm:p-2 ${todayClass}`}
            >
              <p className={`text-[11px] ${monthClass}`}>
                {d.getDate()}
              </p>
              <div className="mt-1 space-y-1">
                {evs.slice(0, 3).map((e) => (
                  <EventChip key={e.id} event={e} />
                ))}
                {evs.length > 3 && (
                  <p className="font-mono text-[10px] text-zinc-500">
                    +{evs.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EventChip({ event }: { event: CalendarEvent }) {
  const hasConflict = event.conflicts.length > 0;
  const tint = hasConflict
    ? 'border-amber-500/40 bg-amber-500/[0.08] text-amber-200 hover:bg-amber-500/[0.16]'
    : 'border-violet-500/30 bg-violet-500/[0.08] text-violet-200 hover:bg-violet-500/[0.16]';
  return (
    <Link
      href={event.href}
      title={
        hasConflict
          ? `${event.title} — conflicts with ${event.conflicts.length} other job(s)`
          : event.title
      }
      className={`block truncate rounded border px-1.5 py-0.5 text-[10px] transition-colors ${tint}`}
    >
      {hasConflict && '⚠ '}
      {formatTime(event.scheduledStart)} · {event.title}
    </Link>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/* ─────────────────────────────────────────────────────────────────── */

function AgendaList({ events }: { events: CalendarEvent[] }) {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart),
  );
  const conflicted = sorted.filter((e) => e.conflicts.length > 0);
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            Agenda
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-white">
            All jobs this view
          </h2>
        </div>
        {conflicted.length > 0 && (
          <p className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-industrial text-amber-300">
            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
            {conflicted.length} conflict{conflicted.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-5 text-center text-sm text-zinc-400">
          No scheduled jobs in this view.
        </p>
      ) : (
        <ol className="space-y-2">
          {sorted.map((e) => (
            <AgendaRow key={e.id} event={e} />
          ))}
        </ol>
      )}
    </section>
  );
}

function AgendaRow({ event }: { event: CalendarEvent }) {
  const d = new Date(event.scheduledStart);
  const conflict = event.conflicts.length > 0;
  return (
    <li>
      <Link
        href={event.href}
        className={`flex items-start gap-4 rounded-xl border p-3 transition-colors ${
          conflict
            ? 'border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/60'
            : 'border-white/[0.06] bg-white/[0.01] hover:border-violet-500/40 hover:bg-violet-500/[0.04]'
        }`}
      >
        <div className="shrink-0 rounded-lg border border-white/[0.06] bg-ink-950/40 px-3 py-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            {d.toLocaleDateString(undefined, { month: 'short' })}
          </p>
          <p className="font-display text-xl font-semibold text-white">
            {d.getDate()}
          </p>
          <p className="font-mono text-[10px] text-zinc-400">
            {formatTime(event.scheduledStart)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">
            {event.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            {event.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" strokeWidth={2} />
                {event.location}
              </span>
            )}
            {event.domain && (
              <span className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                {event.domain}
              </span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
              {event.status}
            </span>
            {conflict && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-industrial text-amber-300">
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                {event.conflicts.length} overlap
                {event.conflicts.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Footnote() {
  return (
    <p className="text-[11px] leading-relaxed text-zinc-500">
      Calendar sourced from{' '}
      <code className="font-mono text-zinc-400">jobs.scheduled_date</code>{' '}
      on rows assigned to you. Subscribe to{' '}
      <code className="font-mono text-zinc-400">/inspector/calendar/feed.ics</code>{' '}
      from any iCal-compatible client (Apple Calendar, Google Calendar,
      Outlook) to keep your device in sync. Mobile app continues to use
      the existing native-calendar sync via{' '}
      <code className="font-mono text-zinc-400">CalendarSync.ts</code>.
    </p>
  );
}
