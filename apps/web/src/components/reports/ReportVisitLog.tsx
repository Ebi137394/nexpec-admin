// ════════════════════════════════════════════════════════════════════════════
//  components/reports/ReportVisitLog.tsx — what a report covers, and who wrote it
//
//  Self-fetching async server component, the same drop-in shape as
//  FlashReportSection and JobVisitsPanel: a report surface mounts it with one
//  line instead of each surface growing its own visit + contributor plumbing.
//
//  ── THIS IS NOT REPORTS V2 ─────────────────────────────────────────────────
//  There is still exactly ONE report per (job, inspector). This renders the
//  per-visit RECORD INSIDE that report — the daily / resident / surveillance
//  log — derived from inspection_items.visit_id, plus the multi-inspector
//  contributor attribution. It adds no report, no template and no status.
//
//  ── READ-ONLY, STRUCTURALLY ────────────────────────────────────────────────
//  Only three readers are imported. No approval action, no publish action and
//  no visit-management RPC is in scope here, so this file cannot become a
//  second place where a report is signed off or a visit is rescheduled.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  None of the three RPCs returns a money column, and nothing here joins
//  payments, payouts, invoices or the ledger.
//
//  ── IDENTITY ───────────────────────────────────────────────────────────────
//  The disclosure decision belongs to nx_report_contributors, which applies
//  nx_job_effective_identity_mode. This component renders contributorLabel()
//  and NEVER reaches for another name source, so a buyer on a 'protected' job
//  sees NX- handles here exactly as they do everywhere else. When names are
//  withheld it says so, rather than silently showing a crew of codes.
//
//  ── A LEGACY JOB IS NOT A PROGRAMME ────────────────────────────────────────
//  A job with no explicit visits yields ONE synthetic row from
//  jobs.scheduled_date. Rendering that as a "visit programme" would claim a
//  plan the job does not have, so the programme block hides itself and only
//  the contributor attribution remains.
// ════════════════════════════════════════════════════════════════════════════

import {
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  XCircle,
  Repeat,
  Users,
  Crown,
  ClipboardList,
  Camera,
  EyeOff,
  UserX,
} from 'lucide-react';
import {
  fetchReportContributors,
  fetchReportVisitLog,
  fetchReportVisitRollup,
  contributorLabel,
  isRealProgramme,
  type ReportContributor,
  type ReportVisitLogRow,
  type ReportVisitRollup,
} from '@/lib/data/reportVisits';

interface Props {
  reportId: string;
  /** Surfaces differ in how much room they have; both render the same truth. */
  variant?: 'full' | 'compact';
  className?: string;
}

const SHELL =
  'rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 sm:p-6';

function fmtDay(iso: string | null): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'No date' : d.toLocaleDateString();
}

function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function statusTone(status: string | null): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20';
    case 'in_progress':
      return 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/20';
    case 'cancelled':
    case 'no_show':
      return 'bg-amber-500/10 text-amber-300 ring-amber-500/20';
    default:
      return 'bg-white/[0.03] text-zinc-400 ring-white/[0.06]';
  }
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

const KIND_LABEL: Record<string, string> = {
  single: 'Single visit',
  recurring: 'Recurring',
  surveillance: 'Surveillance',
  resident: 'Resident',
  repeat: 'Repeat',
  followup: 'Follow-up',
};

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ' +
        (tone ?? 'bg-white/[0.03] text-zinc-400 ring-white/[0.06]')
      }
    >
      {children}
    </span>
  );
}

/* ─── the programme header ─────────────────────────────────────────────── */

export function VisitProgrammeSummary({ rollup }: { rollup: ReportVisitRollup }) {
  const span =
    rollup.firstStart && rollup.lastStart && rollup.firstStart !== rollup.lastStart
      ? `${fmtDay(rollup.firstStart)} – ${fmtDay(rollup.lastStart)}`
      : fmtDay(rollup.firstStart ?? rollup.lastStart);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone="bg-violet/10 text-violet-glow ring-violet/25">
        <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
        {rollup.visitCount} {rollup.visitCount === 1 ? 'visit' : 'visits'}
      </Pill>
      <Pill tone="bg-emerald-500/10 text-emerald-300 ring-emerald-500/20">
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        {rollup.completed} completed
      </Pill>
      {rollup.outstanding > 0 && (
        <Pill>
          <CircleDashed className="h-3.5 w-3.5" strokeWidth={1.75} />
          {rollup.outstanding} outstanding
        </Pill>
      )}
      {rollup.cancelled + rollup.noShow > 0 && (
        <Pill tone="bg-amber-500/10 text-amber-300 ring-amber-500/20">
          <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {rollup.cancelled + rollup.noShow} not worked
        </Pill>
      )}
      {rollup.isRecurring && (
        <Pill>
          <Repeat className="h-3.5 w-3.5" strokeWidth={1.75} />
          Recurring series
        </Pill>
      )}
      {span !== 'No date' && <Pill>{span}</Pill>}
    </div>
  );
}

/* ─── one visit ────────────────────────────────────────────────────────── */

function VisitRow({ row }: { row: ReportVisitLogRow }) {
  const executed = fmtWhen(row.completedAt) ?? fmtWhen(row.startedAt);

  return (
    <li className="border-t border-white/[0.05] py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            {row.isJobLevel
              ? 'Not linked to a visit'
              : `Visit ${row.visitNumber ?? '—'}${row.title ? ` · ${row.title}` : ''}`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {row.isJobLevel ? (
              'Recorded against the job rather than a specific visit.'
            ) : (
              <>
                {fmtDay(row.scheduledStart)}
                {row.timezone ? ` (${row.timezone})` : ''}
                {row.visitKind ? ` · ${KIND_LABEL[row.visitKind] ?? row.visitKind}` : ''}
                {executed ? ` · worked ${executed}` : ''}
              </>
            )}
          </p>
          {row.notes && (
            <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-zinc-300">
              {row.notes}
            </p>
          )}
          {row.cancelReason && (
            <p className="mt-2 text-xs text-amber-300/80">
              Cancelled: {row.cancelReason}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!row.isJobLevel && row.status && (
            <Pill tone={statusTone(row.status)}>
              {STATUS_LABEL[row.status] ?? row.status}
            </Pill>
          )}
          <Pill>
            <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
            {row.reportItemCount} {row.reportItemCount === 1 ? 'result' : 'results'}
          </Pill>
          {row.reportContributorCount > 0 && (
            <Pill>
              <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
              {row.reportContributorCount}
            </Pill>
          )}
        </div>
      </div>
    </li>
  );
}

/* ─── contributors ─────────────────────────────────────────────────────── */

function ContributorRow({ c }: { c: ReportContributor }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] py-2.5 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        {c.isLead && <Crown className="h-3.5 w-3.5 shrink-0 text-violet-glow" strokeWidth={1.75} />}
        <span className="truncate text-sm text-white">{contributorLabel(c)}</span>
        {c.isContracted && <Pill>Contracted</Pill>}
        {c.teamRole && <Pill>{c.teamRole.replace(/_/g, ' ')}</Pill>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
          {c.itemCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <Camera className="h-3.5 w-3.5" strokeWidth={1.75} />
          {c.captureCount}
        </span>
        {c.visitCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
            {c.visitCount} {c.visitCount === 1 ? 'visit' : 'visits'}
          </span>
        )}
      </div>
    </li>
  );
}

/* ─── the panel ────────────────────────────────────────────────────────── */

export default async function ReportVisitLog({
  reportId,
  variant = 'full',
  className,
}: Props) {
  const [rollup, log, contributors] = await Promise.all([
    fetchReportVisitRollup(reportId),
    fetchReportVisitLog(reportId),
    fetchReportContributors(reportId),
  ]);

  const programme = isRealProgramme(rollup);
  // On a legacy job the single fallback row restates the job's own scheduled
  // date and adds nothing; the job-level bucket, if present, does.
  const visitRows = programme ? log : log.filter((r) => r.isJobLevel);
  const hasCrew = contributors.length > 1;
  const namesWithheld =
    contributors.length > 0 && contributors.every((c) => !c.identityDisclosed);

  if (!programme && visitRows.length === 0 && !hasCrew) return null;

  return (
    <section className={(className ?? '') + ' ' + SHELL}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold tracking-tight text-white">
          What this report covers
        </h2>
        {rollup && programme && <VisitProgrammeSummary rollup={rollup} />}
      </div>

      {programme && rollup && rollup.outstanding > 0 && (
        <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs leading-relaxed text-zinc-400">
          {rollup.outstanding} of {rollup.visitCount} visits are still outstanding
          — this report describes the programme so far, not a finished one.
        </p>
      )}

      {visitRows.length > 0 && (
        <ul className="mt-4">
          {visitRows.map((r) => (
            <VisitRow key={r.visitId ?? (r.isJobLevel ? 'job-level' : 'fallback')} row={r} />
          ))}
        </ul>
      )}

      {contributors.length > 0 && variant === 'full' && (
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
            <h3 className="text-xs font-semibold uppercase tracking-industrial text-zinc-400">
              Contributors
            </h3>
          </div>
          {namesWithheld && (
            <p className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
              <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              Names are withheld under this engagement&rsquo;s identity policy.
              Each contributor is shown by their stable reference.
            </p>
          )}
          <ul className="mt-3">
            {contributors.map((c) => (
              <ContributorRow key={c.inspectorId} c={c} />
            ))}
          </ul>
        </div>
      )}

      {contributors.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
          <UserX className="h-3.5 w-3.5" strokeWidth={1.75} />
          No contributor attribution is available for this report.
        </p>
      )}
    </section>
  );
}
