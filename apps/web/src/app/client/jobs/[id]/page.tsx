// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/page.tsx — Single job detail surface
//
//  Renders the job's key facts + a primary CTA into the applications
//  review surface. Heavy lifting (accept / reject) lives at
//  /applications — this page is a calm overview, not an action surface.
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
  Users,
} from 'lucide-react';
import { fetchClientJob } from '@/lib/data/jobApplications';
import type {
  JobModerationStatus,
  JobStatus,
  JobUrgency,
} from '@/lib/data/clientJobs.types';
import { PendingReviewCallout } from '@/components/reviews/PendingReviewCallout';
import { EvidencePackButton } from '@/components/compliance/EvidencePackButton';
// Layer 1+4 — passive, launch-state-gated inspection-domain badge.
import { InspectionDomainBadge } from '@/components/inspection-domain/InspectionDomainBadge';
import { fetchLaunchedDomainSlugs } from '@/lib/data/inspectionDomains';

export const metadata: Metadata = {
  title: 'Job detail',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientJobDetailPage({ params }: PageProps) {
  const { id } = await params;
  // fetchLaunchedDomainSlugs hits a 4-row table; effectively free.
  const [job, launchedDomains] = await Promise.all([
    fetchClientJob(id),
    fetchLaunchedDomainSlugs(),
  ]);
  if (!job) notFound();

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header>
        <Link
          href="/client/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to my jobs
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Client Portal · Job
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {job.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={job.status} />
              <ModerationBadge status={job.moderationStatus} />
              {/* Layer 1+4 — invisible while every job is industrial_ndt
                  AND launchedDomains is the platform default. Renders the
                  moment an admin launches civil / electrical / mechanical. */}
              <InspectionDomainBadge
                domain={job.domain}
                requireLaunched
                launchedDomains={launchedDomains}
              />
              {job.urgency && job.urgency !== 'normal' && (
                <UrgencyBadge urgency={job.urgency} />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 self-start sm:flex-row sm:items-center sm:self-auto">
            <Link
              href={`/client/jobs/${job.id}/applications`}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
            >
              <Users className="h-4 w-4" strokeWidth={2} />
              Review {job.applicationsCount} application
              {job.applicationsCount === 1 ? '' : 's'}
              <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <Link
              href={`/client/jobs/${job.id}/release`}
              className="btn-primary inline-flex items-center gap-2"
            >
              Report &amp; payout
              <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
            </Link>
          </div>
        </div>

        {/* Sprint 9 — Compliance Evidence Locker. The RPC enforces the
            permission predicate (`can_assemble_evidence_for`); we can
            safely render the button to anyone, and the dialog will
            surface a clean error to non-eligible callers. */}
        <div className="mt-4 flex items-center justify-end">
          <EvidencePackButton jobId={job.id} jobTitle={job.title} />
        </div>
      </header>

      {/*
        Pending-review CTA — only renders when the job is completed AND
        the caller hasn't submitted a review for it yet. Calmly confirms
        with a green pill once the review is in. Closes the user-facing
        review loop on the web (mobile already prompts via push).
      */}
      <PendingReviewCallout
        jobId={job.id}
        jobStatus={job.status}
        tone="client"
      />

      {/* Key facts */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FactTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label="Budget"
          value={formatBudget(job.budgetCents)}
          tone="violet"
        />
        <FactTile
          icon={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
          label="Location"
          value={job.locationCity ?? job.locationLabel ?? '—'}
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
            job.scheduledDate
              ? new Date(job.scheduledDate).toLocaleDateString()
              : 'TBD'
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
              Specialties
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

      {/* Status timeline */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Status
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {timelineCopy(job.status, job.moderationStatus, job.applicationsCount)}
        </p>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          Posted {formatRelative(job.createdAt)} · ID {job.id.slice(0, 8)}
        </p>
      </section>
    </div>
  );
}

/* ─── small helpers (visual treatment matches the rest of /client) ─── */

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

function StatusBadge({ status }: { status: JobStatus }) {
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

function ModerationBadge({ status }: { status: JobModerationStatus }) {
  const tone =
    status === 'approved'
      ? 'green'
      : status === 'rejected'
        ? 'red'
        : status === 'edits_requested'
          ? 'amber'
          : 'violet';
  return <Pill tone={tone} label={'moderation · ' + status.replace('_', ' ')} />;
}

function UrgencyBadge({ urgency }: { urgency: JobUrgency }) {
  const tone =
    urgency === 'critical'
      ? 'red'
      : urgency === 'high'
        ? 'amber'
        : urgency === 'low'
          ? 'zinc'
          : 'violet';
  return <Pill tone={tone} label={'urgency · ' + urgency} />;
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

function timelineCopy(
  status: JobStatus,
  moderation: JobModerationStatus,
  apps: number,
): string {
  if (moderation === 'pending_review') {
    return 'Awaiting moderation. Inspectors will see your post once it clears.';
  }
  if (moderation === 'edits_requested') {
    return 'Our moderation team has asked for edits. Check your notifications for specifics.';
  }
  if (moderation === 'rejected') {
    return 'This post did not pass moderation and is hidden from inspectors.';
  }
  // moderation = approved
  if (status === 'open') {
    return apps > 0
      ? `Live. ${apps} application${apps === 1 ? '' : 's'} so far — review and pick a candidate when you're ready.`
      : 'Live. No applications yet — vetted inspectors typically apply within hours.';
  }
  if (status === 'assigned') return 'Inspector assigned. Work is queued to begin.';
  if (status === 'in_progress') return 'Work in progress. Report is incoming.';
  if (status === 'completed') return 'Job complete. Final signed report should be in deliverables.';
  if (status === 'disputed') return 'Dispute opened. Our team is mediating.';
  if (status === 'cancelled') return 'This job was cancelled.';
  return '';
}

function formatBudget(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
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
