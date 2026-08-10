// ════════════════════════════════════════════════════════════════════════════
//  components/jobs/JobItpPanel.tsx — the Inspection & Test Plan, web.
//
//  Self-fetching async server component, the same drop-in shape as
//  JobVisitsPanel and FlashReportSection: the inspector and buyer job-detail
//  pages mount it with one line instead of growing a second job-detail
//  architecture. The admin ITP surface stays where it is — this panel is the
//  read side of that same canonical backend.
//
//  ── WHAT THIS SURFACE IS, AND IS NOT ───────────────────────────────────────
//  It is the plan of record: every point, in canonical stage order, with what
//  it requires, what "acceptable" means, who is responsible, which document
//  governs it, and where its result currently stands with the server's own
//  attribution and timestamps.
//
//  It is NOT where a point is executed. Recording a result is a field act that
//  has to survive no signal, so it goes through the mobile execution module and
//  its offline outbox. Putting a second write path on the web would give the
//  two somewhere to disagree, and would silently drop a result recorded in a
//  basement. The panel says so plainly rather than drawing a button that only
//  works on good wifi.
//
//  ── THE CONTRACT IS FROZEN ELSEWHERE ───────────────────────────────────────
//  Every type, label, ordering rule and helper comes from
//  @nexpec/shared-core/domain/itp. Nothing here defines ITP vocabulary, and
//  nothing here recomputes `isBlockingNow` — that flag is backend truth, and a
//  surface that derives its own version will eventually tell someone the line
//  is clear when it is not.
//
//  ── AUTHORISATION IS THE SERVER'S ──────────────────────────────────────────
//  readJobItp is non-throwing on purpose: an embedded panel must not take a
//  working job page down for someone who simply should not see the section. An
//  unauthorized read renders nothing at all.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  nx_job_itp returns no pricing column, and nothing here joins payments,
//  payouts, invoices or the ledger. Recording an ITP point moves no money.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  ClipboardCheck,
  AlertCircle,
  CheckCircle2,
  XCircle,
  CircleDashed,
  MinusCircle,
  Ban,
  Lock,
  Eye,
  FileText,
  Activity,
  History,
  User,
  Clock,
  Smartphone,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react';
import {
  ITP_RESULT_LABELS,
  ITP_POINT_TYPE_LABELS,
  ITP_POINT_TYPE_MEANING,
  groupItpByStage,
  itpProgress,
  canOfferHoldRelease,
  type ItpPoint,
  type ItpResult,
  type ItpPointType,
} from '@nexpec/shared-core';
// Owned by the ITP read lane. Non-throwing by contract — see the header note.
import { readJobItp } from '@/lib/data/jobItp';
import { fetchJobTeam, type JobTeamMember } from '@/lib/data/jobTeam';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ItpPanelViewer = 'inspector' | 'buyer';

/**
 * Entry points into the EXISTING evidence workflow.
 *
 * Passed in rather than refetched, exactly as JobVisitsPanel takes its
 * `inspection` prop: the job page already knows whether this inspector is
 * hired and whether a report exists, and a second opinion here could disagree
 * with the CTA a few sections above. No evidence capture is built in this file.
 */
export interface ItpEvidenceEntryPoints {
  /** Structured inspection + evidence submission. Null when not yet permitted. */
  reportHref: string | null;
  /** A report already exists — changes what the entry point means. */
  reportSubmitted: boolean;
  /** Raise a mid-job non-conformance. Null outside the hired+active window. */
  flashHref: string | null;
}

interface Props {
  jobId: string;
  viewer: ItpPanelViewer;
  /**
   * Which visit these results belong to. NULL means job level — the same
   * meaning inspection_captures.visit_id carries. A point can legitimately
   * hold one result at job level and another on a given visit.
   */
  visitId?: string | null;
  evidence?: ItpEvidenceEntryPoints | null;
  /**
   * Identity for the ADVISORY hold-release check only. Omit it and the check
   * answers "no", which is the correct answer for an ordinary inspector.
   */
  holdRelease?: {
    isAdmin?: boolean;
    clientId?: string | null;
    agencyId?: string | null;
  } | null;
}

const SHELL = 'rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8';

export default async function JobItpPanel({
  jobId,
  viewer,
  visitId = null,
  evidence = null,
  holdRelease = null,
}: Props) {
  const read = await readJobItp(jobId, visitId);

  if (!read.ok) {
    // Not authorised is the normal case for someone merely browsing an open
    // job. That is not an error worth showing — the section is simply not
    // theirs, and the rest of the page keeps working.
    if (read.unauthorized) return null;
    return (
      <section className={SHELL}>
        <SectionHeading count={null} />
        <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <AlertCircle className="h-4 w-4 shrink-0 text-accent-amber" strokeWidth={1.75} />
          The inspection plan could not be loaded just now. Nothing has changed,
          try again shortly.
        </p>
      </section>
    );
  }

  const points = read.points;
  // A job with no scope template simply has no ITP. An empty "Inspection plan"
  // card would claim the job has one.
  if (points.length === 0) return null;

  const progress = itpProgress(points);
  const stages = groupItpByStage(points);

  // Who is looking, for "you" attribution only. Never used to decide access.
  let viewerId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    viewerId = auth.user?.id ?? null;
  } catch {
    viewerId = null;
  }

  // Multi-Inspector attribution. Names arrive already resolved under the
  // server's identity rules; this file does no name lookup of its own and
  // invents nothing when the roster has no entry. The buyer branch never runs,
  // so no crew identity can reach a buyer surface even by mistake.
  const names = new Map<string, string>();
  if (viewer === 'inspector') {
    try {
      const roster: JobTeamMember[] = await fetchJobTeam(jobId);
      for (const m of roster) {
        if (m.fullName) names.set(m.inspectorId, m.fullName);
      }
    } catch {
      // Attribution is context, not the point of the panel. A refusal here must
      // not remove the plan.
    }
  }

  /**
   * ADVISORY ONLY — it decides which sentence is shown, never whether the act
   * is permitted. nx_itp_release_hold re-decides server-side and is the sole
   * authority; it raises 42501 for anyone who is not an admin or the buyer,
   * including the inspector who recorded the hold. This panel therefore draws
   * no release control at all: the flag is cosmetic, and UI state must never
   * stand in for the backend rule.
   */
  const mayRelease = canOfferHoldRelease({
    isAdmin: holdRelease?.isAdmin ?? false,
    viewerId,
    clientId: holdRelease?.clientId ?? null,
    agencyId: holdRelease?.agencyId ?? null,
  });

  return (
    <section className={SHELL}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading count={points.length} />
        <ProgressLine
          total={progress.total}
          recorded={progress.recorded}
          failed={progress.failed}
        />
      </div>

      <p className="mt-2 max-w-3xl text-sm text-zinc-400">
        {viewer === 'inspector'
          ? 'Every point this job is measured against, in plan order, with what it requires and where its result stands.'
          : 'Every point your inspection is measured against, in plan order, with what has been recorded so far.'}
        {visitId
          ? ' Scoped to one visit — a point can hold a different result at job level.'
          : ' Job level. Results recorded against a specific visit are shown on that visit.'}
      </p>

      {/* Blocking is the database's answer, not this component's. */}
      {progress.blocking > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-accent-amber/40 bg-accent-amber/[0.07] p-4">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent-amber" strokeWidth={2} />
          <div className="text-sm text-accent-amber">
            <p className="font-semibold">
              {progress.blocking === 1
                ? '1 point is holding work right now'
                : `${progress.blocking} points are holding work right now`}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-accent-amber/80">
              {mayRelease
                ? 'Releasing a hold is an acceptance decision and is recorded on the admin ITP surface. Nothing on this page clears it.'
                : 'Recording a result does not clear a hold. An admin or the buyer releases it, and the database refuses anyone else.'}
            </p>
          </div>
        </div>
      )}

      {/* ── The plan ─────────────────────────────────────────────────────── */}
      <div className="mt-6 space-y-6">
        {stages.map((group) => (
          <div key={group.stage || 'unstaged'}>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              {group.stage || 'Unstaged'}
            </p>
            <ol className="mt-3 space-y-3">
              {group.points.map((p) => (
                <PointRow
                  key={p.pointId}
                  point={p}
                  viewer={viewer}
                  viewerId={viewerId}
                  names={names}
                  evidence={evidence}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* ── Footer microcopy ─────────────────────────────────────────────── */}
      <div className="mt-6 space-y-1.5 border-t border-white/[0.05] pt-4">
        {viewer === 'inspector' && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
            <Smartphone className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            Points are recorded in the field app, where a result survives a dead
            signal and replays when you are back on the network. This page is the
            plan of record and the current state of it.
          </p>
        )}
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
          <History className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Each point shows the result currently on record with the server&apos;s own
          attribution and timestamp. Earlier attempts are not exposed by this read.
        </p>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Sign-off is not release. Recording a point moves no money and triggers
          no payment behaviour.
        </p>
      </div>
    </section>
  );
}

/* ─── one point ──────────────────────────────────────────────────────────── */

function PointRow({
  point: p,
  viewer,
  viewerId,
  names,
  evidence,
}: {
  point: ItpPoint;
  viewer: ItpPanelViewer;
  viewerId: string | null;
  names: Map<string, string>;
  evidence: ItpEvidenceEntryPoints | null;
}) {
  const who =
    p.inspectorId == null
      ? null
      : p.inspectorId === viewerId
        ? 'you'
        : (names.get(p.inspectorId) ?? 'another inspector on this job');

  return (
    <li
      className={
        'rounded-2xl border px-4 py-3 sm:px-5 sm:py-4 ' +
        (p.isBlockingNow
          ? 'border-accent-amber/30 bg-accent-amber/[0.05]'
          : p.result === 'failed'
            ? 'border-accent-red/25 bg-accent-red/[0.04]'
            : 'border-white/[0.06] bg-white/[0.02]')
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">
              {p.sequenceNo}. {p.title}
            </span>
            <PointTypeChip type={p.pointType} />
            <ResultChip result={p.result} />
            {p.isBlockingNow && (
              <Chip
                tone="amber"
                icon={<Lock className="h-3 w-3" strokeWidth={2} />}
                label="holding work"
              />
            )}
            {p.requiresSignoff && (
              <Chip
                tone="zinc"
                icon={<ClipboardCheck className="h-3 w-3" strokeWidth={2} />}
                label="sign-off"
              />
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            {ITP_POINT_TYPE_MEANING[p.pointType]}
          </p>
        </div>
      </div>

      {/* What "done properly" means for this point */}
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {p.requirement && <Fact label="Requirement" value={p.requirement} />}
        {p.acceptanceCriteria && (
          <Fact label="Acceptance criteria" value={p.acceptanceCriteria} />
        )}
        {p.referenceDocument && (
          <Fact label="Reference document" value={p.referenceDocument} mono />
        )}
        {p.responsibleParty && <Fact label="Responsible party" value={p.responsibleParty} />}
      </dl>

      {/* Attribution + timestamps, entirely from the server */}
      {p.result !== 'pending' && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <User className="h-3 w-3" strokeWidth={1.75} />
            {who ? `Recorded by ${who}` : 'Recorded'}
          </span>
          {p.recordedAt && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              {formatWhen(p.recordedAt)}
            </span>
          )}
          {p.signedOffAt && (
            <span className="inline-flex items-center gap-1.5 text-accent-green">
              <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
              signed off {formatWhen(p.signedOffAt)}
            </span>
          )}
          {p.releasedAt && (
            <span className="inline-flex items-center gap-1.5 text-cyan-glow">
              <Lock className="h-3 w-3" strokeWidth={1.75} />
              hold released {formatWhen(p.releasedAt)}
            </span>
          )}
        </p>
      )}

      {/* Evidence — the workflows this product already has. Never a second one. */}
      {viewer === 'inspector' && evidence && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {evidence.reportHref && (
            <Link
              href={evidence.reportHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:border-cyan-glow/40 hover:text-cyan-glow"
            >
              <ClipboardCheck className="h-3 w-3" strokeWidth={2} />
              {evidence.reportSubmitted
                ? 'View inspection & evidence'
                : 'Attach evidence in the report'}
            </Link>
          )}
          {p.flashReportId ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-red/30 bg-accent-red/10 px-3 py-1.5 text-[11px] font-semibold text-accent-red">
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              NCR raised from this point, see flash reports below
            </span>
          ) : p.result === 'failed' && evidence.flashHref ? (
            <Link
              href={evidence.flashHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent-red/30 bg-accent-red/10 px-3 py-1.5 text-[11px] font-semibold text-accent-red transition hover:bg-accent-red/15"
            >
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              Raise an NCR for this failure
              <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          ) : null}
        </div>
      )}
    </li>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────────── */

function SectionHeading({ count }: { count: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <ClipboardCheck className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
      <h2 className="font-display text-lg font-semibold tracking-tight text-white">
        Inspection &amp; Test Plan{count != null && count > 0 ? ` · ${count}` : ''}
      </h2>
    </div>
  );
}

function ProgressLine({
  total,
  recorded,
  failed,
}: {
  total: number;
  recorded: number;
  failed: number;
}) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((recorded / total) * 100));
  return (
    <div className="min-w-[9rem]">
      <p className="text-right font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
        {recorded} of {total} recorded
        {failed > 0 ? ` · ${failed} failed` : ''}
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

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        {label}
      </dt>
      <dd
        className={
          'mt-1 whitespace-pre-line text-pretty text-[13px] leading-relaxed text-zinc-300 ' +
          (mono ? 'font-mono text-xs text-zinc-400' : '')
        }
      >
        {value}
      </dd>
    </div>
  );
}

function PointTypeChip({ type }: { type: ItpPointType }) {
  const icon =
    type === 'hold' ? (
      <Lock className="h-3 w-3" strokeWidth={2} />
    ) : type === 'witness' ? (
      <Eye className="h-3 w-3" strokeWidth={2} />
    ) : type === 'review' ? (
      <FileText className="h-3 w-3" strokeWidth={2} />
    ) : type === 'surveillance' ? (
      <Activity className="h-3 w-3" strokeWidth={2} />
    ) : (
      <CircleDashed className="h-3 w-3" strokeWidth={2} />
    );
  return (
    <Chip
      tone={type === 'hold' ? 'amber' : type === 'witness' ? 'violet' : 'zinc'}
      icon={icon}
      label={ITP_POINT_TYPE_LABELS[type].toLowerCase()}
    />
  );
}

function ResultChip({ result }: { result: ItpResult }) {
  const tone =
    result === 'passed'
      ? 'green'
      : result === 'failed'
        ? 'red'
        : result === 'waived'
          ? 'amber'
          : result === 'not_applicable'
            ? 'zinc'
            : 'zinc';
  const icon =
    result === 'passed' ? (
      <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
    ) : result === 'failed' ? (
      <XCircle className="h-3 w-3" strokeWidth={2} />
    ) : result === 'waived' ? (
      <MinusCircle className="h-3 w-3" strokeWidth={2} />
    ) : result === 'not_applicable' ? (
      <Ban className="h-3 w-3" strokeWidth={2} />
    ) : (
      <CircleDashed className="h-3 w-3" strokeWidth={2} />
    );
  return <Chip tone={tone} icon={icon} label={ITP_RESULT_LABELS[result].toLowerCase()} />;
}

function Chip({
  tone,
  icon,
  label,
}: {
  tone: 'cyan' | 'violet' | 'green' | 'amber' | 'red' | 'zinc';
  icon: React.ReactNode;
  label: string;
}) {
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    violet: 'border-violet/30 bg-violet/10 text-violet-glow',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    amber: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
