// ════════════════════════════════════════════════════════════════════════════
//  components/visits/JobVisitsPanel.tsx — the multi-visit schedule, web.
//
//  Self-fetching async server component, same drop-in shape as
//  FlashReportSection: the inspector and buyer job-detail pages mount it with
//  one line instead of growing a second job-detail architecture. The admin
//  surface stays where it is (/admin/jobs/[id]/visits, Phase 2C) — this panel
//  is the read side of that same canonical backend.
//
//  ── READ-ONLY, STRUCTURALLY ────────────────────────────────────────────────
//  nx_job_add_visit / nx_job_create_recurring_visits / nx_job_reschedule_visit
//  / nx_job_cancel_visit / nx_visit_assign_inspector are admin-gated in the
//  database and are deliberately not imported here at all, so this file cannot
//  become an accidental scheduling surface for an inspector or a buyer. The one
//  read is nx_job_visits, which authorises the caller in its own body.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  nx_job_visits returns no money column, and nothing here joins payments,
//  payouts, invoices or the ledger. Payout, buyer price and platform margin
//  have nowhere to land.
//
//  ── IDENTITY ───────────────────────────────────────────────────────────────
//  viewer='inspector' may see the crew: nx_job_inspectors returns teammates to
//  an active team member, which is the same audience mobile's JobTeamPanel
//  serves. viewer='buyer' NEVER fetches the team — the call is gated on the
//  viewer, not filtered afterwards — and its one crew-shaped detail (a
//  headcount) is additionally gated on nx_job_effective_identity_mode, so a
//  'protected' engagement stays a headcount-free schedule.
//
//  ── THE LEGACY FALLBACK IS NOT A VISIT PLAN ────────────────────────────────
//  A job with no explicit job_visits rows returns ONE synthetic row built from
//  jobs.scheduled_date. Reading it writes nothing, and it has no id, no crew
//  and no history. Both job pages already print that date as "Scheduled", so
//  rendering it here as a one-row programme would claim a visit plan the job
//  does not have. The panel hides itself instead — exactly what mobile's
//  JobVisitsPanel does.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  CalendarDays,
  CalendarClock,
  Repeat,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  History,
  AlertCircle,
  ClipboardCheck,
  MessageSquare,
  ArrowUpRight,
  CircleDashed,
  Crown,
} from 'lucide-react';
import {
  readJobVisits,
  summariseVisits,
  formatVisitWhen,
  relativeDayLabel,
  visitKey,
  isTerminalVisit,
  VISIT_KIND_LABELS,
  VISIT_STATUS_LABELS,
  type JobVisit,
  type VisitKind,
  type VisitStatus,
} from '@/lib/data/jobVisits';
import { fetchJobTeam, TEAM_ROLE_LABELS, type TeamRole, type JobTeamMember } from '@/lib/data/jobTeam';
import { fetchJobIdentityMode, identityDisclosureAllowed } from '@/lib/data/jobIdentityMode';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type VisitPanelViewer = 'inspector' | 'buyer';

export interface VisitInspectionEntryPoints {
  /** Structured inspection + evidence submission. Null when not yet permitted. */
  reportHref: string | null;
  /** Raise a mid-visit non-conformance. Null outside the hired+active window. */
  flashHref: string | null;
  /** A report already exists for this job — changes the entry point's meaning. */
  reportSubmitted: boolean;
  /** Existing brokered admin channel. Visit changes are an admin request. */
  adminMessagesHref: string;
}

interface Props {
  jobId: string;
  viewer: VisitPanelViewer;
  /**
   * Inspector only. Passed in rather than refetched: the job page already
   * knows whether this inspector is hired and whether a report exists, and a
   * second opinion here could disagree with the CTA three sections above.
   */
  inspection?: VisitInspectionEntryPoints | null;
}

const SHELL =
  'rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8';

export default async function JobVisitsPanel({ jobId, viewer, inspection = null }: Props) {
  const read = await readJobVisits(jobId);

  if (!read.ok) {
    // Not authorised is the normal case for someone merely browsing an open
    // job. That is not an error worth showing — the panel is simply not theirs.
    if (read.unauthorized) return null;
    return (
      <section className={SHELL}>
        <SectionHeading count={null} />
        <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <AlertCircle className="h-4 w-4 shrink-0 text-accent-amber" strokeWidth={1.75} />
          The visit schedule could not be loaded just now. Nothing has changed —
          try again shortly.
        </p>
      </section>
    );
  }

  const now = new Date();
  const summary = summariseVisits(read.visits, now);
  if (summary.ordered.length === 0) return null;
  // Legacy job: a schedule fallback is not a visit plan. See the header note.
  if (summary.fallbackOnly) return null;

  // Crew context. The buyer branch never runs, so no identity can be fetched on
  // a buyer surface even by mistake.
  let team: JobTeamMember[] = [];
  let viewerMembership: JobTeamMember | null = null;
  if (viewer === 'inspector') {
    try {
      const supabase = await createSupabaseServerClient();
      const [{ data: auth }, roster] = await Promise.all([
        supabase.auth.getUser(),
        fetchJobTeam(jobId),
      ]);
      team = roster.filter((m) => !m.fromFallback);
      const uid = auth.user?.id ?? null;
      viewerMembership = uid ? (roster.find((m) => m.inspectorId === uid) ?? null) : null;
    } catch {
      // The team read is context, not the point of the panel. A job whose team
      // is still the implicit single contractor legitimately returns nothing
      // useful here, and an authorization refusal must not remove the schedule.
      team = [];
      viewerMembership = null;
    }
  }

  const identityMode = viewer === 'buyer' ? await fetchJobIdentityMode(jobId) : 'protected';
  const showCrewCount = viewer === 'inspector' || identityDisclosureAllowed(identityMode);

  const current = summary.currentKey
    ? (summary.ordered.find((v) => visitKey(v) === summary.currentKey) ?? null)
    : null;
  const next = summary.nextKey
    ? (summary.ordered.find((v) => visitKey(v) === summary.nextKey) ?? null)
    : null;
  const focus = current ?? next;

  return (
    <section className={SHELL}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading count={summary.ordered.length} />
        <ProgressLine
          planned={summary.planned}
          completed={summary.completed}
          cancelled={summary.cancelled}
        />
      </div>

      <p className="mt-2 max-w-3xl text-sm text-zinc-400">
        {viewer === 'inspector'
          ? 'Every time this job puts someone on site, in sequence. Scheduling is managed by admin, this view is read-only.'
          : 'Every planned attendance on your site, in sequence, with what has already happened.'}
      </p>

      {/* ── Focus card: what is happening now, or what is next ──────────── */}
      {focus && (
        <FocusCard
          visit={focus}
          isNow={current != null}
          total={summary.ordered.length}
          now={now}
          viewer={viewer}
          showCrewCount={showCrewCount}
          inspection={inspection}
        />
      )}

      {/* ── The sequence ───────────────────────────────────────────────── */}
      <ol className="mt-6 space-y-3">
        {summary.ordered.map((v) => {
          const key = visitKey(v);
          const isCurrent = key === summary.currentKey;
          const isNext = key === summary.nextKey;
          const terminal = isTerminalVisit(v.status);
          const { when, zoneLabel } = formatVisitWhen(v.scheduledStart, v.scheduledEnd, v.timezone);
          const relative = terminal ? null : relativeDayLabel(v.scheduledStart, now);

          return (
            <li
              key={key}
              className={
                'rounded-2xl border px-4 py-3 sm:px-5 sm:py-4 ' +
                (isCurrent
                  ? 'border-cyan-glow/30 bg-cyan-glow/[0.05]'
                  : v.status === 'cancelled'
                    ? 'border-white/[0.05] bg-white/[0.01] opacity-70'
                    : 'border-white/[0.06] bg-white/[0.02]')
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        'text-sm font-medium ' + (terminal ? 'text-zinc-400' : 'text-white')
                      }
                    >
                      Visit {v.visitNumber} of {summary.ordered.length}
                      {v.title ? ` · ${v.title}` : ''}
                    </span>
                    <VisitStatusPill status={v.status} />
                    {v.recurrenceGroupId && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                        <Repeat className="h-3 w-3" strokeWidth={1.75} />
                        series
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    {when}
                    {zoneLabel ? ` · ${zoneLabel}` : ''}
                    {` · ${VISIT_KIND_LABELS[v.visitKind as VisitKind] ?? v.visitKind}`}
                    {showCrewCount && v.assignedCount > 0
                      ? ` · ${v.assignedCount} assigned`
                      : ''}
                  </p>
                </div>

                {isCurrent ? (
                  <Chip tone="cyan" icon={<Clock className="h-3 w-3" strokeWidth={2} />} label="now" />
                ) : isNext ? (
                  <Chip
                    tone="violet"
                    icon={<CalendarClock className="h-3 w-3" strokeWidth={2} />}
                    label={relative ? relative.toLowerCase() : 'next'}
                  />
                ) : relative ? (
                  <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                    {relative}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── Crew context — inspector only ──────────────────────────────── */}
      {viewer === 'inspector' && team.length > 0 && (
        <div className="mt-6 border-t border-white/[0.05] pt-5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
            Job team
            {viewerMembership && (
              <span className="text-cyan-glow">
                · you are {TEAM_ROLE_LABELS[viewerMembership.role as TeamRole] ?? viewerMembership.role}
              </span>
            )}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {team.map((m) => (
              <li
                key={m.inspectorId}
                className={
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ' +
                  (m.inspectorId === viewerMembership?.inspectorId
                    ? 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow'
                    : 'border-white/[0.08] bg-white/[0.03] text-zinc-300')
                }
              >
                {m.isLead && <Crown className="h-3 w-3" strokeWidth={1.75} />}
                {m.fullName ?? 'Inspector'}
                <span className="text-zinc-500">
                  {TEAM_ROLE_LABELS[m.role as TeamRole] ?? m.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            Who attends each individual visit is allocated by admin from this
            team. Ask admin if a visit needs different cover.
          </p>
        </div>
      )}

      {/* ── Footer microcopy ───────────────────────────────────────────── */}
      <div className="mt-6 space-y-1.5 border-t border-white/[0.05] pt-4">
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
          <History className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          A rescheduled visit is superseded, not deleted: the replacement keeps
          the crew and appears in this sequence, while the original stays in the
          record. Cancelled visits remain listed as history.
        </p>
        {viewer === 'inspector' && inspection && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
            <ClipboardCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            Scheduling changes are made by admin. Raise a reschedule or an access
            problem through the{' '}
            <Link href={inspection.adminMessagesHref} className="underline hover:text-zinc-400">
              existing admin channel
            </Link>
            , not on site.
          </p>
        )}
        {viewer === 'buyer' && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
            <CalendarDays className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            Visits are operational. Adding, rescheduling or cancelling one moves
            no money on its own — settlement stays on the report and payout
            flow. Contact admin to change the programme.
          </p>
        )}
      </div>
    </section>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function SectionHeading({ count }: { count: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
      <h2 className="font-display text-lg font-semibold tracking-tight text-white">
        Site visits{count != null && count > 1 ? ` · ${count}` : ''}
      </h2>
    </div>
  );
}

function ProgressLine({
  planned,
  completed,
  cancelled,
}: {
  planned: number;
  completed: number;
  cancelled: number;
}) {
  if (planned <= 0) return null;
  const pct = Math.min(100, Math.round((completed / planned) * 100));
  return (
    <div className="min-w-[9rem]">
      <p className="text-right font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
        {completed} of {planned} complete
        {cancelled > 0 ? ` · ${cancelled} cancelled` : ''}
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-accent-green/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FocusCard({
  visit,
  isNow,
  total,
  now,
  viewer,
  showCrewCount,
  inspection,
}: {
  visit: JobVisit;
  isNow: boolean;
  total: number;
  now: Date;
  viewer: VisitPanelViewer;
  showCrewCount: boolean;
  inspection: VisitInspectionEntryPoints | null;
}) {
  const { when, zoneLabel } = formatVisitWhen(visit.scheduledStart, visit.scheduledEnd, visit.timezone);
  const relative = relativeDayLabel(visit.scheduledStart, now);
  const tone = isNow
    ? 'border-cyan-glow/30 bg-gradient-to-b from-cyan-glow/[0.08] to-cyan-glow/[0.02]'
    : 'border-violet/30 bg-gradient-to-b from-violet/[0.07] to-violet/[0.02]';

  return (
    <div className={`mt-5 rounded-2xl border p-5 sm:p-6 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={
              'text-[10px] font-semibold uppercase tracking-industrial ' +
              (isNow ? 'text-cyan-glow' : 'text-violet-glow')
            }
          >
            {isNow ? 'On site now' : 'Next visit'}
            {relative && !isNow ? ` · ${relative}` : ''}
          </p>
          <h3 className="mt-1 font-display text-xl font-semibold tracking-tight text-white">
            Visit {visit.visitNumber} of {total}
            {visit.title ? ` · ${visit.title}` : ''}
          </h3>
          <p className="mt-1.5 text-sm text-zinc-300">
            {when}
            {zoneLabel ? ` · ${zoneLabel}` : ''}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {VISIT_KIND_LABELS[visit.visitKind as VisitKind] ?? visit.visitKind}
            {' · '}
            {VISIT_STATUS_LABELS[visit.status as VisitStatus] ?? visit.status}
            {showCrewCount && visit.assignedCount > 0
              ? ` · ${visit.assignedCount} assigned`
              : ''}
          </p>
        </div>

        {/* Entry points — inspector only, and only the ones the job page has
            already established this inspector is entitled to. */}
        {viewer === 'inspector' && inspection && (
          <div className="flex flex-col gap-2 self-start">
            {inspection.reportHref && (
              <Link
                href={inspection.reportHref}
                className={
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-industrial transition ' +
                  (inspection.reportSubmitted
                    ? 'border border-white/10 bg-white/[0.03] text-zinc-300 hover:text-white'
                    : 'bg-cyan-glow text-ink-900 hover:bg-cyan-glow/90')
                }
              >
                <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={2} />
                {inspection.reportSubmitted
                  ? 'View inspection & evidence'
                  : 'Inspection & evidence'}
              </Link>
            )}
            {inspection.flashHref && (
              <Link
                href={inspection.flashHref}
                className="inline-flex items-center gap-2 rounded-xl border border-accent-amber/40 bg-accent-amber/10 px-4 py-2.5 text-xs font-bold uppercase tracking-industrial text-accent-amber transition hover:bg-accent-amber/15"
              >
                <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
                Raise flash report
              </Link>
            )}
            <Link
              href={inspection.adminMessagesHref}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-zinc-300 transition hover:border-violet/40 hover:text-white"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
              Message admin
              <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>
        )}
      </div>

      {viewer === 'inspector' && inspection?.reportSubmitted && (
        <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
          A report is already in for this job. Reports are submitted per job, not
          per visit — evidence you capture in the field app can still be tagged
          to the specific visit it came from.
        </p>
      )}
    </div>
  );
}

function VisitStatusPill({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'green'
      : status === 'in_progress'
        ? 'cyan'
        : status === 'cancelled' || status === 'no_show'
          ? 'red'
          : status === 'planned'
            ? 'zinc'
            : 'violet';
  const icon =
    status === 'completed' ? (
      <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
    ) : status === 'cancelled' || status === 'no_show' ? (
      <XCircle className="h-3 w-3" strokeWidth={2} />
    ) : status === 'planned' ? (
      <CircleDashed className="h-3 w-3" strokeWidth={2} />
    ) : (
      <Clock className="h-3 w-3" strokeWidth={2} />
    );
  return (
    <Chip
      tone={tone}
      icon={icon}
      label={(VISIT_STATUS_LABELS[status as VisitStatus] ?? status).toLowerCase()}
    />
  );
}

function Chip({
  tone,
  icon,
  label,
}: {
  tone: 'cyan' | 'violet' | 'green' | 'red' | 'zinc';
  icon: React.ReactNode;
  label: string;
}) {
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    violet: 'border-violet/30 bg-violet/10 text-violet-glow',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    zinc: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {icon}
      {label}
    </span>
  );
}
