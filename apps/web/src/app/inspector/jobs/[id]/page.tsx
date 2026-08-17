// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/jobs/[id]/page.tsx — Inspector single-job detail
//
//  GOLDEN_RULE_2 — payout column only. No client budget anywhere.
//  GOLDEN_RULE_4/7 — client COMPANY name; no personal info.
//
//  Three primary states:
//    • No application yet, job is open  → big "Apply now" CTA
//    • Application exists               → "Your application" panel + withdraw
//    • Job no longer open + no app      → fetch returns null, 404 (handled
//                                          by visibility gate in fetcher)
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft,
  ArrowUpRight,
  MapPin,
  CalendarDays,
  Wallet,
  Briefcase,
  Tag,
  Globe2,
  Plane,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  PenLine,
  ShieldAlert,
  ClipboardCheck,
  Hourglass,
  Eye,
} from 'lucide-react';
import { fetchInspectorJob } from '@/lib/data/inspectorJobDetail';
import { fetchInspectorReport } from '@/lib/data/inspectorReport';
// Layer 1+4 — passive, launch-state-gated domain badge.
import { InspectionDomainBadge } from '@/components/inspection-domain/InspectionDomainBadge';
import { fetchLaunchedDomainSlugs } from '@/lib/data/inspectionDomains';
import type { InspectorReport } from '@/lib/data/inspectorReport.types';
import { PendingReviewCallout } from '@/components/reviews/PendingReviewCallout';
import JobChatActions from '@/components/messaging/JobChatActions';
import type {
  InspectorJobDetail,
  InspectorOwnApplication,
} from '@/lib/data/inspectorJobDetail.types';
import type { InspectorApplicationStatus } from '@/lib/data/openJobs.types';
import type { JobUrgency } from '@/lib/data/clientJobs.types';
import { withdrawApplication } from '@/lib/actions/inspectorApply';
import { FlashReportSection } from '@/components/flash-reports/FlashReportSection';
import JobVisitsPanel from '@/components/visits/JobVisitsPanel';
import JobItpPanel from '@/components/jobs/JobItpPanel';
import { formatScheduledDate } from '@nexpec/shared-core';

export const metadata: Metadata = {
  title: 'Job detail',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    applied?: string;
    already?: string;
    withdrawn?: string;
    error?: string;
    already_reported?: string;
    report_submitted?: string;
    flash_raised?: string;
    flash_updated?: string;
    flash_error?: string;
  }>;
}

export default async function InspectorJobDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const qp = await searchParams;

  // Fetch job + report + launched domains in parallel. fetchInspectorReport
  // returns null cheaply when nothing is there yet, so this is free.
  // fetchLaunchedDomainSlugs hits a 4-row table; effectively free.
  const [job, report, launchedDomains] = await Promise.all([
    fetchInspectorJob(id),
    fetchInspectorReport(id),
    fetchLaunchedDomainSlugs(),
  ]);
  if (!job) notFound();

  // Flash Reports (NCRs) can be raised by a hired inspector on an active job.
  // The list itself renders for any state that has reports (e.g. after the job
  // moves on), but the "Raise report" CTA is gated to the active window.
  const isHiredActive =
    (job.myApplication?.status === 'hired' ||
      job.myApplication?.status === 'accepted') &&
    (job.status === 'assigned' || job.status === 'in_progress');
  const flashRaiseHref = isHiredActive
    ? `/inspector/jobs/${id}/flash-reports/new`
    : null;

  return (
    <div className="space-y-8">
      {/* SLA Sentinel — report overdue banner (scheduled date passed, no report) */}
      {/* isHiredActive is required: the old condition keyed only off the JOB
          status, so on an awaiting-replacement job (which stays 'in_progress')
          a mere APPLICANT — status 'pending', never assigned — was shown the
          overdue flag and a link straight to /submit-report. Report actions
          belong to the assigned inspector alone. */}
      {isHiredActive &&
        job.scheduledDate &&
        new Date(job.scheduledDate).getTime() < Date.now() &&
        !report && (
          <Link
            href={`/inspector/jobs/${id}/submit-report`}
            className="group flex items-center justify-between gap-4 rounded-xl border border-accent-red/50 bg-accent-red/10 px-4 py-3 transition-colors hover:bg-accent-red/15"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-accent-red" />
              <p className="text-sm font-medium text-accent-red">
                Report overdue, this inspection is past its scheduled date. Submit your report to clear the flag.
              </p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-industrial text-accent-red/80 group-hover:text-accent-red">
              submit →
            </span>
          </Link>
        )}

      <header>
        <Link
          href="/inspector/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to open jobs
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Inspector Portal, Job
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {job.title}
            </h1>
            {job.clientCompanyName && (
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-zinc-400">
                <Building2 className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
                for <span className="text-zinc-300">{job.clientCompanyName}</span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusPill status={job.status} />
              {/* Layer 1+4, invisible while every job is industrial_ndt
                  AND launchedDomains stays at ['industrial_ndt']. Renders
                  the moment an admin launches civil / electrical / mechanical. */}
              <InspectionDomainBadge
                domain={job.domain}
                requireLaunched
                launchedDomains={launchedDomains}
              />
              {job.urgency && job.urgency !== 'normal' && (
                <UrgencyPill urgency={job.urgency} />
              )}
              {job.acceptsRemoteInspectors && (
                <ChipMeta
                  icon={<Globe2 className="h-3 w-3" />}
                  label="Remote OK"
                  tone="cyan"
                />
              )}
              {job.sponsorshipOffered !== 'none' && (
                <ChipMeta
                  icon={<Plane className="h-3 w-3" />}
                  label={
                    job.sponsorshipOffered === 'visa_assist'
                      ? 'Visa assist'
                      : 'Full sponsorship'
                  }
                  tone="amber"
                />
              )}
            </div>
          </div>

          {/* Primary CTA — context-aware (apply / withdraw / submit report) */}
          <PrimaryAction job={job} report={report} />

          {/* ★ Two-party channels for the inspector side. Self-resolving via
              nx_job_chat_counterparts, so "Message Supplier" appears only when
              a supplier is genuinely attached to THIS inspection. */}
          <JobChatActions jobId={job.id} returnTo={`/inspector/jobs/${job.id}`} />
        </div>
      </header>

      {/*
        Workflow panel — surfaces the inspector's CURRENT action on this job.
        Hidden by default; renders only when the inspector is hired and the
        job is in an active state. This is the fix for the UX black hole
        where a hired inspector landed here and had no path to submit their
        report from the job detail page (the only CTA lived on the
        assignments dashboard card, which the user often bypassed).
      */}
      <InspectorWorkflowPanel job={job} report={report} />

      {/*
        Multi-visit schedule (Phase 2D). Read-only: nx_job_visits is the only
        RPC it touches, and the management RPCs are admin-gated in the database,
        so an inspector cannot reschedule, cancel or crew a visit from here.
        The panel hides itself for anyone nx_job_visits refuses (an applicant
        browsing an open job) and for a legacy job whose only "visit" is the
        synthetic jobs.scheduled_date fallback already shown as Scheduled above.
        Entry points are handed in rather than recomputed, so the buttons here
        cannot disagree with the workflow panel directly above.
      */}
      <JobVisitsPanel
        jobId={job.id}
        viewer="inspector"
        inspection={
          isHiredActive || report
            ? {
                reportHref: isHiredActive && !report
                  ? `/inspector/jobs/${job.id}/submit-report`
                  : null,
                flashHref: flashRaiseHref,
                reportSubmitted: report != null,
                adminMessagesHref: '/inspector/messages',
              }
            : null
        }
      />

      {/* Flash Reports (NCRs) — raise + track mid-job non-conformances. */}
      <FlashReportSection
        jobId={job.id}
        viewerRole="inspector"
        portal="inspector"
        raiseHref={flashRaiseHref}
      />

      {/*
        Pending-review CTA — renders only when the job is completed AND the
        inspector hasn't reviewed the client yet. Calmly confirms once submitted.
        Closes the user-facing review loop on the web for inspectors.
      */}
      <PendingReviewCallout
        jobId={job.id}
        jobStatus={job.status}
        tone="inspector"
        counterpartyLabel={job.clientCompanyName ?? null}
      />

      {/* Action banners */}
      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.applied && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Application submitted. The client will review your profile and
          mark a preferred candidate, admin finalises the hire.
        </Banner>
      )}
      {qp.already && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          You&apos;ve already applied to this job. Track the status below.
        </Banner>
      )}
      {qp.withdrawn && (
        <Banner tone="zinc" icon={<XCircle className="h-5 w-5" />}>
          Application withdrawn. You can re-apply if the job is still open.
        </Banner>
      )}
      {qp.already_reported && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          You&apos;ve already submitted a report for this inspection. Admin
          will review it and route it back to the client. Payout is recorded by a
          NEXPEC admin after approval and delivery; it is not automatic.
        </Banner>
      )}
      {qp.report_submitted && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Report submitted. You&apos;ll receive a notification once admin
          completes the review.
        </Banner>
      )}
      {qp.flash_raised && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Flash report raised. Admin has been notified and you can track it
          below.
        </Banner>
      )}
      {qp.flash_updated && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Flash report updated.
        </Banner>
      )}
      {qp.flash_error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.flash_error}
        </Banner>
      )}

      {/* Your application panel — only when one exists */}
      {job.myApplication && (
        <YourApplicationPanel
          application={job.myApplication}
          jobId={job.id}
          jobStillOpen={job.isOpenForApplications}
        />
      )}

      {/* Key facts */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FactTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label="Inspector payout"
          value={formatPayout(job.inspectorPayoutCents)}
          tone="violet"
        />
        <FactTile
          icon={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
          label="Location"
          value={job.locationLabel ?? job.locationCity ?? '—'}
        />
        <FactTile
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          label="Job type"
          value={formatJobType(job.jobType)}
        />
        <FactTile
          icon={<CalendarDays className="h-4 w-4" strokeWidth={1.75} />}
          label="Scheduled"
          value={
            formatScheduledDate(job.scheduledDate, { fallback: 'TBD' })
          }
        />
      </section>

      {/* Description */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Scope
        </h2>
        {job.description ? (
          <p className="mt-3 whitespace-pre-line text-pretty text-sm leading-relaxed text-zinc-300">
            {job.description}
          </p>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No description provided.
          </p>
        )}
      </section>

      {/* Specialties */}
      {job.specialtySlugs.length > 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Specialties required
            </h2>
          </div>
          <ul className="mt-4 flex flex-wrap gap-2">
            {job.specialtySlugs.map((slug) => (
              <li
                key={slug}
                className="inline-flex rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs font-medium text-violet-glow"
              >
                {slug.replace(/-/g, ' ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Footer microcopy + posted timestamp */}
      <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
        Posted {formatRelative(job.createdAt)}, ID {job.id.slice(0, 8)}
      </p>
    </div>
  );
}

/* ─── primary CTA — context-aware ────────────────────────────────────── */

function PrimaryAction({
  job,
  report,
}: {
  job: InspectorJobDetail;
  report: InspectorReport | null;
}) {
  const myApp = job.myApplication;
  const isHired =
    myApp?.status === 'hired' || myApp?.status === 'accepted';
  const isActive =
    job.status === 'in_progress' || job.status === 'assigned';

  // HIGHEST PRIORITY — hired + active job + no report = "Submit Report" CTA.
  // This is the case where the user lands after signing the contract and
  // needs to actually do the work. Before this fix, it rendered a useless
  // "Application status below ↓" pill and left the user stranded.
  if (isHired && isActive && !report) {
    return (
      <div className="flex flex-col gap-2 self-start sm:flex-row sm:self-auto">
        <Link
          href={`/inspector/jobs/${job.id}/submit-report`}
          className="inline-flex items-center gap-2 rounded-xl bg-cyan-glow px-5 py-2.5 text-sm font-bold uppercase tracking-industrial text-ink-900 transition hover:bg-cyan-glow/90"
        >
          <PenLine className="h-4 w-4" strokeWidth={2} />
          Submit Inspection Report
        </Link>
        <Link
          href={`/inspector/coordination-bridge?job_id=${job.id}`}
          className="inline-flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-5 py-2.5 text-sm font-bold uppercase tracking-industrial text-violet-300 transition hover:bg-violet-500/20"
        >
          Coordinate with vendor
        </Link>
      </div>
    );
  }

  // Hired + active + report already submitted = badge, no button (no edits
  // until Sprint 6.5 ships revision support).
  if (isHired && isActive && report) {
    return (
      <div className="inline-flex items-center gap-2 self-start rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-industrial text-cyan-glow sm:self-auto">
        <Hourglass className="h-3.5 w-3.5" strokeWidth={2} />
        Report submitted, awaiting admin review
      </div>
    );
  }

  // Hired + completed = inspection done; review CTA is on the
  // PendingReviewCallout below the header.
  if (isHired && job.status === 'completed') {
    return (
      <div className="inline-flex items-center gap-2 self-start rounded-full border border-accent-green/30 bg-accent-green/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-industrial text-accent-green sm:self-auto">
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
        Inspection complete
      </div>
    );
  }

  // Hired + disputed = escalation. Link to the disputes board.
  if (isHired && job.status === 'disputed') {
    return (
      <Link
        href="/inspector/disputes"
        className="inline-flex items-center gap-2 self-start rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-2.5 text-sm font-semibold text-accent-red transition hover:bg-accent-red/15 sm:self-auto"
      >
        <ShieldAlert className="h-4 w-4" strokeWidth={2} />
        Dispute open, view
      </Link>
    );
  }

  // Pre-hire application — link to status panel below.
  if (myApp) {
    return (
      <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-zinc-400">
        Application status below ↓
      </div>
    );
  }

  // Job closed to new applications.
  if (!job.isOpenForApplications) {
    return (
      <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-zinc-500">
        Not accepting applications
      </div>
    );
  }

  // Open + no application yet.
  return (
    <Link
      href={`/inspector/jobs/${job.id}/apply`}
      className="btn-primary inline-flex items-center gap-2 self-start sm:self-auto"
    >
      Apply now
      <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
    </Link>
  );
}

/* ─── workflow panel — current-action guidance + Submit Report CTA ───── */

function InspectorWorkflowPanel({
  job,
  report,
}: {
  job: InspectorJobDetail;
  report: InspectorReport | null;
}) {
  const myApp = job.myApplication;
  const isHired = myApp?.status === 'hired' || myApp?.status === 'accepted';

  // Only render when the inspector is engaged on the job. Pre-hire and
  // non-applicant views get nothing — the application panel + apply CTA
  // are the right surfaces for those.
  if (!isHired) return null;

  // ── State 1: Hired, job active, NOT submitted yet ──────────────────
  if (
    (job.status === 'in_progress' || job.status === 'assigned') &&
    !report
  ) {
    return (
      <section className="rounded-3xl border border-cyan-glow/30 bg-gradient-to-b from-cyan-glow/[0.08] to-cyan-glow/[0.02] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow">
              <ClipboardCheck className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                Your Action, Cleared to begin work
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-white">
                Complete the inspection, then submit your signed report.
              </h2>
              <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-300">
                The contract is fully executed. There&apos;s no separate
                &quot;start&quot; step, head to the site, complete the work
                described in the Scope below, and come back here to submit
                your signed report. Admin reviews your report and routes it
                to the client; your{' '}
                <span className="font-semibold text-cyan-glow">
                  {formatPayout(job.inspectorPayoutCents)}
                </span>{' '}
                payout, recorded by a NEXPEC admin after approval and delivery. Not automatic.
              </p>
            </div>
          </div>
          <Link
            href={`/inspector/jobs/${job.id}/submit-report`}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-cyan-glow px-5 py-3 text-sm font-bold uppercase tracking-industrial text-ink-900 transition hover:bg-cyan-glow/90"
          >
            <PenLine className="h-4 w-4" strokeWidth={2} />
            Submit Report
          </Link>
        </div>

        {/* Lightweight 3-step explainer */}
        <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StepTile
            n={1}
            title="On-site work"
            body="Carry out the inspection per the Scope below."
            done
          />
          <StepTile
            n={2}
            title="Submit report"
            body="Upload photos, write the summary, attest with your name."
            active
          />
          <StepTile
            n={3}
            title="Admin review"
            body="Admin verifies and routes to the client. Payout released."
          />
        </ol>
      </section>
    );
  }

  // ── State 2: Hired, job active, report ALREADY submitted ───────────
  if (
    (job.status === 'in_progress' || job.status === 'assigned') &&
    report
  ) {
    return (
      <section className="rounded-3xl border border-violet/30 bg-gradient-to-b from-violet/[0.07] to-violet/[0.02] p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-violet/40 bg-violet/10 text-violet-glow">
              <Hourglass className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                Report submitted, awaiting admin review
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-white">
                Sit tight, admin is reviewing your submission.
              </h2>
              <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-300">
                Submitted{' '}
                <span className="font-mono text-zinc-200">
                  {formatRelative(report.createdAt)}
                </span>
                . Once admin signs off and the client confirms, your{' '}
                <span className="font-semibold text-violet-glow">
                  {formatPayout(job.inspectorPayoutCents)}
                </span>{' '}
                payout, recorded by a NEXPEC admin after approval and delivery. It is not
                automatic. You&apos;ll receive a notification at every state change.
              </p>
            </div>
          </div>
          <Link
            href={`/inspector/jobs/${job.id}/submit-report`}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-zinc-300 transition hover:border-violet/40 hover:text-white"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={2} />
            View submission
          </Link>
        </div>

        <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StepTile n={1} title="On-site work" body="Done." done />
          <StepTile n={2} title="Submit report" body="Submitted." done />
          <StepTile
            n={3}
            title="Admin review"
            body="In progress, typically within 48 hours."
            active
          />
        </ol>
      </section>
    );
  }

  // ── State 3: completed — quiet success line. The PendingReviewCallout
  // handles the next action (leave review for the client).
  if (job.status === 'completed') {
    return (
      <section className="rounded-3xl border border-accent-green/30 bg-gradient-to-b from-accent-green/[0.08] to-accent-green/[0.02] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent-green/40 bg-accent-green/10 text-accent-green">
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
              Inspection complete
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              Report approved and delivered to the client. Payout is on
              track. Leave a review below to close the loop.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return null;
}

function StepTile({
  n,
  title,
  body,
  done,
  active,
}: {
  n: number;
  title: string;
  body: string;
  done?: boolean;
  active?: boolean;
}) {
  const ring = done
    ? 'border-accent-green/40 bg-accent-green/[0.06]'
    : active
      ? 'border-cyan-glow/40 bg-cyan-glow/[0.06]'
      : 'border-white/[0.06] bg-white/[0.02]';
  const numCls = done
    ? 'border-accent-green/50 bg-accent-green/15 text-accent-green'
    : active
      ? 'border-cyan-glow/50 bg-cyan-glow/15 text-cyan-glow'
      : 'border-white/10 bg-white/[0.04] text-zinc-500';
  return (
    <div className={`rounded-2xl border p-4 ${ring}`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${numCls}`}
        >
          {done ? '✓' : n}
        </span>
        <p className="text-xs font-semibold uppercase tracking-industrial text-white">
          {title}
        </p>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

/* ─── your application panel ─────────────────────────────────────────── */

function YourApplicationPanel({
  application,
  jobId,
  jobStillOpen,
}: {
  application: InspectorOwnApplication;
  jobId: string;
  jobStillOpen: boolean;
}) {
  const canWithdraw =
    application.status === 'pending' ||
    application.status === 'shortlisted' ||
    application.status === 'offered';

  return (
    <section className="rounded-3xl border border-violet/30 bg-gradient-to-b from-violet/[0.06] to-violet/[0.02] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Your application
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Submitted {formatRelative(application.createdAt)}, ID{' '}
            <span className="font-mono">{application.id.slice(0, 8)}</span>
          </p>
        </div>
        <ApplicationStatusBadge status={application.status} />
      </div>

      {application.coverNote && (
        <details className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-zinc-200 hover:text-white">
            Your cover note
          </summary>
          <p className="whitespace-pre-line border-t border-white/[0.04] px-4 py-4 text-sm leading-relaxed text-zinc-300">
            {application.coverNote}
          </p>
        </details>
      )}

      {application.bidCents !== null && (
        <p className="mt-4 text-xs text-zinc-500">
          You proposed{' '}
          <span className="font-mono text-zinc-300">
            {formatPayout(application.bidCents)}
          </span>
          . Admin may adjust before final assignment.
        </p>
      )}

      {/* Withdraw form — only for pre-hired states */}
      {canWithdraw && jobStillOpen && (
        <form action={withdrawApplication} className="mt-6 flex justify-end">
          <input type="hidden" name="applicationId" value={application.id} />
          <input type="hidden" name="jobId" value={jobId} />
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
          >
            <XCircle className="h-4 w-4" strokeWidth={2} />
            Withdraw application
          </button>
        </form>
      )}
    </section>
  );
}

/* ─── pills + helpers ────────────────────────────────────────────────── */

function ApplicationStatusBadge({
  status,
}: {
  status: InspectorApplicationStatus;
}) {
  const tone =
    status === 'hired' || status === 'accepted'
      ? 'green'
      : status === 'rejected' || status === 'withdrawn'
        ? 'zinc'
        : status === 'shortlisted' || status === 'offered' || status === 'CLIENT_SELECTED'
          ? 'cyan'
          : 'violet';
  const label =
    status === 'CLIENT_SELECTED'
      ? 'client picked you'
      : status.replace('_', ' ');
  return <Pill tone={tone} label={label} />;
}

function StatusPill({ status }: { status: InspectorJobDetail['status'] }) {
  const tone =
    status === 'open'
      ? 'cyan'
      : status === 'in_progress' || status === 'assigned'
        ? 'violet'
        : status === 'completed'
          ? 'green'
          : status === 'disputed'
            ? 'red'
            : 'zinc';
  return <Pill tone={tone} label={status.replace('_', ' ')} />;
}

function UrgencyPill({ urgency }: { urgency: JobUrgency }) {
  const tone =
    urgency === 'critical'
      ? 'red'
      : urgency === 'high'
        ? 'amber'
        : urgency === 'low'
          ? 'zinc'
          : 'violet';
  return <Pill tone={tone} label={'urgency, ' + urgency} />;
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: 'cyan' | 'violet' | 'green' | 'amber' | 'red' | 'zinc';
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
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {label}
    </span>
  );
}

function ChipMeta({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'cyan' | 'amber';
}) {
  const classes =
    tone === 'cyan'
      ? 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow'
      : 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {icon}
      {label}
    </span>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'cyan' | 'red' | 'zinc';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    zinc: 'border-white/[0.08] bg-white/[0.03] text-zinc-300',
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function FactTile({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'violet' | 'cyan';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p className={`mt-2 font-mono text-xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}

function formatPayout(cents: number | null): string {
  if (cents === null || cents === undefined || cents === 0)
    return 'Pending admin price';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}

function formatJobType(t: string | null): string {
  if (!t) return '—';
  if (t === 'on_site') return 'On-site';
  if (t === 'remote') return 'Remote';
  return t.replace(/_/g, ' ');
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
