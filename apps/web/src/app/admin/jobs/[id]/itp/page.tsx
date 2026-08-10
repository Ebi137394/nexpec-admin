// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/[id]/itp/page.tsx — Admin Inspection & Test Plan
//
//  The quality-control layer above the structured inspection surface: at which
//  stage does work stop, who must attend, what is the acceptance criterion, and
//  who signed. Extends the existing Admin job architecture and follows the
//  conventions of /admin/jobs/[id]/visits and /team — reached from /admin/jobs,
//  which is in the sidebar, so qa:admin-routes treats it as navigable rather
//  than orphaned.
//
//  ── BLOCKING IS BACKEND TRUTH, AND ONLY ADVISORY ───────────────────────────
//  The banner is driven by nx_job_itp_blocking_points and by the per-point
//  is_blocking_now flag. NOTHING on this page derives "blocked" from a point
//  type or a result — the database owns that rule.
//  It is also honestly labelled: the RPC's own comment says it REPORTS, it does
//  not veto a job transition. No job status is gated by it here, and the copy
//  must never imply that it is.
//
//  ── SIGN-OFF ≠ RELEASE ─────────────────────────────────────────────────────
//  Signing attests that a point was performed; releasing permits work to
//  continue past a hold. nx_itp_release_hold refuses the recording inspector
//  with 42501, so this page never draws a release control the viewer cannot
//  use — see canOfferHoldRelease below.
//
//  ── BOUNDARIES ─────────────────────────────────────────────────────────────
//   • Every mutation goes through a canonical RPC via lib/actions/jobItp.ts.
//     Nothing here writes itp_points or itp_point_results.
//   • No pricing, payout, margin or settlement figure is rendered — the reader
//     returns no money column. Recording, releasing or escalating a point has
//     no payment behaviour; settlement stays manual, as on the visits page.
//   • The visit list comes from lib/data/jobVisits.ts. This page does not query
//     job_visits itself.
//
//  Admin gating is enforced by app/admin/layout.tsx and re-checked here via
//  nx_is_admin (fail closed on any future routing slip); the RPCs check again
//  server-side.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  ClipboardList, ArrowLeft, OctagonAlert, ShieldCheck, LockOpen, FileWarning,
  CircleCheck, CircleDashed, Eye, FileText, UserCheck, Clock, Filter, History,
  Layers, Stamp,
} from 'lucide-react';
import {
  ITP_RESULTS, ITP_RESULT_LABELS, ITP_POINT_TYPE_LABELS, ITP_POINT_TYPE_MEANING,
  groupItpByStage, blockingItpPoints, itpProgress, canOfferHoldRelease,
  itpWitnessNameRequired, coerceItpResult,
  type ItpPoint, type ItpPointType, type ItpResult,
} from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchJobItp, fetchItpBlockingCount, fetchItpResultDetails,
  fetchItpEvidencePoints, fetchItpInspectorNames,
} from '@/lib/data/jobItp';
import { fetchJobVisits } from '@/lib/data/jobVisits';
import { recordItpResult, releaseItpHold, raiseNcrFromItpPoint } from '@/lib/actions/jobItp';

export const metadata: Metadata = { title: 'Admin, Job ITP' };
export const dynamic = 'force-dynamic';

/**
 * Recordable outcomes. 'pending' is a READ state — "no result row yet" — not a
 * decision anybody makes, so it is offered as a label and never as a choice.
 */
const RECORDABLE: ItpResult[] = ITP_RESULTS.filter((r) => r !== 'pending');

const NCR_SEVERITIES = ['minor', 'major', 'critical'];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const RESULT_TONE: Record<ItpResult, string> = {
  pending: 'bg-white/[0.04] text-zinc-400 ring-white/[0.08]',
  passed: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
  failed: 'bg-rose-500/10 text-rose-300 ring-rose-500/20',
  waived: 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
  not_applicable: 'bg-white/[0.04] text-zinc-400 ring-white/[0.08]',
};

const TYPE_TONE: Record<ItpPointType, string> = {
  normal: 'bg-white/[0.04] text-zinc-300 ring-white/[0.08]',
  hold: 'bg-rose-500/10 text-rose-300 ring-rose-500/20',
  witness: 'bg-violet-500/10 text-violet-300 ring-violet-500/20',
  review: 'bg-sky-500/10 text-sky-300 ring-sky-500/20',
  surveillance: 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/20',
};

const input =
  'rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600';

/** One labelled definition line; renders nothing when the field is empty. */
function Field({ label, value }: { label: string; value: string | null }) {
  if (!value || !value.trim()) return null;
  return (
    <p className="text-xs leading-relaxed text-zinc-400">
      <span className="text-zinc-600">{label}: </span>
      {value}
    </p>
  );
}

export default async function AdminJobItpPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ visit?: string }>;
}) {
  const { id: jobId } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/admin/jobs/${jobId}/itp`));

  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  // ── Visit context ────────────────────────────────────────────────────────
  // The reader is visit-aware, so the whole page has a scope. Visits come from
  // the canonical visit reader; this page does not query job_visits itself. The
  // synthetic schedule fallback has no database identity, so it cannot be a
  // filter value — only real visits can.
  const visits = await fetchJobVisits(jobId);
  const realVisits = visits.filter((v) => v.visitId !== null);
  const requested = typeof sp.visit === 'string' && sp.visit.trim() ? sp.visit.trim() : null;
  const matched = realVisits.find((v) => v.visitId === requested);
  const visitId: string | null = matched?.visitId ?? null;
  // Asked for a visit that is not on this job: say so rather than silently
  // showing job-level state under a visit heading.
  const unknownVisit = requested !== null && visitId === null;

  // fetchJobItp THROWS: an empty list here means "this job has no ITP", which
  // is a real and different answer from "we could not load it".
  const points = await fetchJobItp(jobId, visitId);

  const [blockingCount, details, evidencePoints, inspectorNames] = await Promise.all([
    fetchItpBlockingCount(jobId, visitId),
    fetchItpResultDetails(jobId, visitId),
    fetchItpEvidencePoints(points.map((p) => p.pointId)),
    fetchItpInspectorNames(
      points.map((p) => p.inspectorId).filter((v): v is string => typeof v === 'string'),
    ),
  ]);

  const stages = groupItpByStage(points);
  const progress = itpProgress(points);
  const blockers = blockingItpPoints(points);
  // Both numbers come from the backend flag — the count RPC is defined as a
  // count over is_blocking_now — so they agree unless one read failed. Say so
  // if they ever disagree rather than picking a winner silently.
  const blockingHeadline = blockingCount > 0 ? blockingCount : blockers.length;
  const blockingDisagrees = blockingCount !== blockers.length;

  /**
   * COSMETIC ONLY. nx_itp_release_hold re-decides server-side and is the sole
   * authority; this merely avoids drawing a control that would 42501 for the
   * viewer. This page is admin-only by the redirect above, so isAdmin is true
   * by construction — the buyer arms of the helper matter on the client and
   * agency surfaces, not here, and are passed as null rather than guessed at.
   */
  const canRelease = canOfferHoldRelease({
    isAdmin: true,
    viewerId: user?.id ?? null,
    clientId: null,
    agencyId: null,
  });

  async function recordAction(formData: FormData) {
    'use server';
    const pointId = String(formData.get('pointId') ?? '');
    if (!pointId) return;
    const result = coerceItpResult(formData.get('result'));
    const comments = String(formData.get('comments') ?? '');
    const witnessedBy = String(formData.get('witnessedBy') ?? '');
    await recordItpResult(
      jobId, pointId, result, visitId, comments || null, witnessedBy || null,
    );
  }

  const scopeLabel = matched
    ? `visit ${matched.visitNumber}${matched.title ? ` · ${matched.title}` : ''}`
    : 'job level';

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to jobs
        </Link>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Inspection &amp; Test Plan
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Where work stops, who must attend, what counts as acceptable, and who
          signed for it.
        </p>
        <p className="mt-3 max-w-3xl rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-zinc-500">
          The plan is <span className="text-zinc-300">quality control</span>, not
          commercial. Recording, releasing or escalating a point has no payout
          effect and triggers no refund — settlement stays manual. Points come
          from the job&apos;s scope template, so editing the plan itself belongs
          to the template, not to one job. Related:{' '}
          <Link href={`/admin/jobs/${jobId}/visits`} className="text-zinc-300 underline">
            site visits
          </Link>{' '}
          and{' '}
          <Link href={`/admin/jobs/${jobId}/team`} className="text-zinc-300 underline">
            the job team
          </Link>
          .
        </p>
      </header>

      {/* ── Visit scope ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Filter className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          Visit context
        </h2>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="visit" defaultValue={visitId ?? ''} className={input}>
            <option value="">Job level (no visit)</option>
            {realVisits.map((v) => (
              <option key={v.visitId ?? ''} value={v.visitId ?? ''}>
                Visit {v.visitNumber}
                {v.title ? ` · ${v.title}` : ''}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.06]"
          >
            Apply
          </button>
          {visitId && (
            <Link
              href={`/admin/jobs/${jobId}/itp`}
              className="text-xs text-zinc-400 underline hover:text-white"
            >
              clear
            </Link>
          )}
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
          Showing <span className="text-zinc-400">{scopeLabel}</span>. The filter
          does not change which points exist — the plan is the same — it changes
          which visit&apos;s results, sign-offs and releases are shown, because a
          result is recorded per point per visit. Job level means the result
          carries no visit, the same meaning pre-visit evidence has.
          {realVisits.length === 0 && ' This job has no explicit visits yet, so only job level is available.'}
        </p>
        {unknownVisit && (
          <p className="mt-2 text-[11px] text-amber-300">
            The requested visit is not on this job, so job-level state is shown
            instead.
          </p>
        )}
      </section>

      {/* ── Blocking banner — backend truth, advisory ───────────────────── */}
      {blockingHeadline > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-xs font-medium text-rose-200">
              {blockingHeadline} point{blockingHeadline === 1 ? '' : 's'} currently
              block{blockingHeadline === 1 ? 's' : ''} progress at {scopeLabel}.
            </p>
            <ul className="mt-2 space-y-1">
              {blockers.map((p) => (
                <li key={p.pointId} className="text-[11px] text-rose-200/80">
                  {p.stage} · #{p.sequenceNo} · {p.title} —{' '}
                  {ITP_POINT_TYPE_LABELS[p.pointType]}, {ITP_RESULT_LABELS[p.result].toLowerCase()}
                </li>
              ))}
            </ul>
            {blockingDisagrees && (
              <p className="mt-2 text-[11px] text-amber-300">
                The blocking count ({blockingCount}) and the flagged points (
                {blockers.length}) disagree, which means one of the two reads
                failed. Treat the larger number as the safer one and reload.
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-rose-200/70">
              This is the database&apos;s answer, from
              nx_job_itp_blocking_points and the per-point is_blocking_now flag —
              nothing on this page works it out from a point type or a result.
              It is <span className="font-medium">advisory at this layer</span>:
              it reports, it does not veto a job transition. The job can still be
              moved through its lifecycle; wiring the two together is a separate,
              explicit decision that has not been taken.
            </p>
          </div>
        </div>
      ) : points.length > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" strokeWidth={1.75} />
          <p className="text-xs leading-relaxed text-emerald-200/90">
            No point is blocking progress at {scopeLabel}, per
            nx_job_itp_blocking_points. That is a report on the plan, not a
            clearance to close the job — outstanding points may still be
            unrecorded below.
          </p>
        </div>
      ) : null}

      {/* ── Progress ───────────────────────────────────────────────────── */}
      {points.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Points', value: progress.total },
            { label: 'Recorded', value: progress.recorded },
            { label: 'Outstanding', value: progress.outstanding },
            { label: 'Passed', value: progress.passed },
            { label: 'Failed', value: progress.failed },
            { label: 'Blocking', value: progress.blocking },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
            >
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</p>
              <p className="mt-1 text-xl font-semibold text-white">{s.value}</p>
            </div>
          ))}
        </section>
      )}

      {/* ── The plan ───────────────────────────────────────────────────── */}
      {points.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <p className="text-sm text-zinc-400">This job has no ITP.</p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
            Points are defined on an inspection scope template, and the reader
            returns nothing when the job carries no template — so this is
            &ldquo;no plan attached&rdquo;, not &ldquo;failed to load&rdquo;
            (a load failure would have surfaced as an error, not as an empty
            page). Attach a scope template to the job and its points appear
            here. Opening this page wrote nothing.
          </p>
        </div>
      ) : (
        <section className="space-y-8">
          {stages.map((group) => (
            <div key={group.stage}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Layers className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
                {group.stage || 'Unstaged'}
                <span className="text-xs font-normal text-zinc-500">
                  ({group.points.length} point{group.points.length === 1 ? '' : 's'})
                </span>
              </h2>

              <ul className="space-y-4">
                {group.points.map((p: ItpPoint) => {
                  const detail = details.get(p.pointId) ?? null;
                  const resultId = detail?.resultId ?? null;
                  // COSMETIC ONLY, both of them. nx_itp_release_hold and the NCR
                  // path each re-decide server-side and remain the sole
                  // authority; these merely avoid drawing a control that would
                  // 42501 or 22023 for this viewer on this point. Both require a
                  // recorded result, because both act on the result row — which
                  // is also why resultId is narrowed to non-null here rather
                  // than asserted at the call sites.
                  const offerRelease =
                    canRelease &&
                    resultId !== null &&
                    p.blocksProgress &&
                    p.releasedAt === null;
                  const offerNcr = resultId !== null && p.result === 'failed';
                  const expectsEvidence = evidencePoints.has(p.pointId);
                  const inspectorName = p.inspectorId
                    ? inspectorNames.get(p.inspectorId) ?? null
                    : null;
                  // The DB demands a witness name when a WITNESS point passes or
                  // fails. The shared helper mirrors that rule so the field can
                  // be marked before the round trip; the DB still enforces it.
                  const witnessMatters =
                    itpWitnessNameRequired(p.pointType, 'passed') ||
                    itpWitnessNameRequired(p.pointType, 'failed');

                  return (
                    <li
                      key={p.pointId}
                      className={
                        'rounded-2xl border px-5 py-4 ' +
                        (p.isBlockingNow
                          ? 'border-rose-500/25 bg-rose-500/[0.04]'
                          : 'border-white/[0.06] bg-white/[0.02]')
                      }
                    >
                      {/* ── Identity and state ─────────────────────────── */}
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">
                              #{p.sequenceNo} · {p.title}
                            </span>
                            <span
                              className={
                                'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ' +
                                TYPE_TONE[p.pointType]
                              }
                            >
                              {ITP_POINT_TYPE_LABELS[p.pointType]}
                            </span>
                            <span
                              className={
                                'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ' +
                                RESULT_TONE[p.result]
                              }
                            >
                              {ITP_RESULT_LABELS[p.result]}
                            </span>
                            {p.isBlockingNow && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-300 ring-1 ring-inset ring-rose-500/20">
                                <OctagonAlert className="h-3 w-3" strokeWidth={1.75} />
                                blocking now
                              </span>
                            )}
                            {p.requiresSignoff && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-inset ring-white/[0.08]">
                                <Stamp className="h-3 w-3" strokeWidth={1.75} />
                                sign-off required
                              </span>
                            )}
                            {expectsEvidence && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300 ring-1 ring-inset ring-sky-500/20">
                                <Eye className="h-3 w-3" strokeWidth={1.75} />
                                evidence required
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {ITP_POINT_TYPE_MEANING[p.pointType]}
                          </p>
                        </div>
                      </div>

                      {/* ── Definition ─────────────────────────────────── */}
                      <div className="mt-3 space-y-1 border-t border-white/[0.05] pt-3">
                        <Field label="Requirement" value={p.requirement} />
                        <Field label="Acceptance criteria" value={p.acceptanceCriteria} />
                        <Field label="Responsible party" value={p.responsibleParty} />
                        <Field label="Reference document" value={p.referenceDocument} />
                        <p className="text-[11px] text-zinc-600">
                          {p.blocksProgress
                            ? 'Defined as blocking: work stops here until it is released.'
                            : 'Defined as non-blocking: recorded, then work continues.'}
                          {expectsEvidence
                            ? ' Expects evidence, drawn from the existing inspection evidence requirement — the plan does not re-declare what to capture.'
                            : ' No evidence requirement is attached to this point.'}
                        </p>
                      </div>

                      {/* ── Execution record ───────────────────────────── */}
                      <div className="mt-3 grid gap-1 border-t border-white/[0.05] pt-3 sm:grid-cols-2">
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <UserCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          Recorded by:{' '}
                          {p.recordedAt
                            ? (inspectorName ??
                               (p.inspectorId ? `inspector ${p.inspectorId.slice(0, 8)}` : 'unattributed'))
                            : 'not yet recorded'}
                        </p>
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          Recorded at: {fmt(p.recordedAt)}
                        </p>
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <Stamp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          Signed off: {p.signedOffAt ? fmt(p.signedOffAt) : 'not signed'}
                        </p>
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <LockOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          Released:{' '}
                          {p.releasedAt
                            ? fmt(p.releasedAt)
                            : p.blocksProgress
                              ? 'not released'
                              : 'nothing to release'}
                        </p>
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          Visit context: {scopeLabel}
                        </p>
                        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <FileWarning className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          NCR:{' '}
                          {p.flashReportId
                            ? `raised · flash report ${p.flashReportId.slice(0, 8)}`
                            : 'none raised'}
                        </p>
                        {detail?.createdAt && (
                          <p className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                            <History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                            Result row first written {fmt(detail.createdAt)}, last
                            changed {fmt(detail.updatedAt)}
                          </p>
                        )}
                      </div>

                      {(detail?.comments || detail?.witnessedBy || detail?.releaseNote) && (
                        <div className="mt-3 space-y-1 border-t border-white/[0.05] pt-3">
                          <Field label="Inspector comments" value={detail?.comments ?? null} />
                          <Field label="Witnessed by" value={detail?.witnessedBy ?? null} />
                          <Field label="Release note" value={detail?.releaseNote ?? null} />
                        </div>
                      )}

                      {p.flashReportId && (
                        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/80">
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          This failure was escalated to flash report{' '}
                          <span className="font-mono">{p.flashReportId}</span>. It is
                          an ordinary flash report — there is no second NCR system —
                          but admin web has no flash-report detail route to link to
                          yet, so the id is shown rather than a href that would 404.
                        </p>
                      )}

                      {/* ── Acts ───────────────────────────────────────── */}
                      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/[0.05] pt-4">
                        <form action={recordAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="pointId" value={p.pointId} />
                          <select name="result" defaultValue="passed" className={input}>
                            {RECORDABLE.map((r) => (
                              <option key={r} value={r}>{ITP_RESULT_LABELS[r]}</option>
                            ))}
                          </select>
                          <input
                            name="comments"
                            placeholder="comments (optional)"
                            className={`${input} w-56`}
                          />
                          {witnessMatters && (
                            <input
                              name="witnessedBy"
                              placeholder="who witnessed it (required)"
                              className={`${input} w-56`}
                            />
                          )}
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20"
                          >
                            <CircleCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {p.result === 'pending' ? 'Record' : 'Re-record'}
                          </button>
                        </form>

                        {offerRelease && (
                          <form
                            action={async (fd: FormData) => {
                              'use server';
                              const note = String(fd.get('note') ?? '');
                              await releaseItpHold(jobId, resultId, note || null);
                            }}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input
                              name="note"
                              placeholder="release note (optional)"
                              className={`${input} w-56`}
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/20"
                            >
                              <LockOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                              Release hold
                            </button>
                          </form>
                        )}

                        {offerNcr && (
                          <form
                            action={async (fd: FormData) => {
                              'use server';
                              const severity = String(fd.get('severity') ?? 'major');
                              const note = String(fd.get('note') ?? '');
                              await raiseNcrFromItpPoint(
                                jobId, resultId, severity, 'defect', note || null,
                              );
                            }}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <select name="severity" defaultValue="major" className={input}>
                              {NCR_SEVERITIES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                            <input
                              name="note"
                              placeholder="NCR note (optional)"
                              className={`${input} w-56`}
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-500/20 hover:bg-rose-500/20"
                            >
                              <FileWarning className="h-3.5 w-3.5" strokeWidth={1.75} />
                              Raise NCR
                            </button>
                          </form>
                        )}
                      </div>

                      {p.blocksProgress && p.releasedAt === null && resultId === null && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-600">
                          <CircleDashed className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          A hold cannot be released before it is recorded — release
                          acts on the execution row, and this point has none yet at{' '}
                          {scopeLabel}.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {points.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ClipboardList className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
            What these controls do, and do not do
          </h2>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Recording writes one result per point per visit through
            nx_itp_record_result; recording again updates that row rather than
            adding a rival one. Releasing a hold is an acceptance decision, not
            an inspection act: the database allows only an admin or the buyer to
            do it, and refuses the inspector who recorded the point — a release
            control is never drawn for someone the database would refuse. Raising
            an NCR delegates to the existing flash-report system and is
            idempotent per result, so a double submit cannot produce two reports.
          </p>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Sign-off is shown as recorded state only. The schema carries
            &ldquo;sign-off required&rdquo; and a signed-off timestamp, but no
            canonical RPC writes one yet, so no control here claims to sign —
            drawing a button that silently did nothing would be worse than the
            gap it hid.
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <History className="h-3.5 w-3.5" strokeWidth={1.75} />
            Nothing on this page moves money. A failed point raises a quality
            record, not a penalty; settlement stays manual and admin-initiated.
          </p>
        </section>
      )}
    </div>
  );
}
