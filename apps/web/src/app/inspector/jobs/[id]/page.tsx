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
} from 'lucide-react';
import { fetchInspectorJob } from '@/lib/data/inspectorJobDetail';
import type {
  InspectorJobDetail,
  InspectorOwnApplication,
} from '@/lib/data/inspectorJobDetail.types';
import type { InspectorApplicationStatus } from '@/lib/data/openJobs.types';
import type { JobUrgency } from '@/lib/data/clientJobs.types';
import { withdrawApplication } from '@/lib/actions/inspectorApply';

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
  }>;
}

export default async function InspectorJobDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const qp = await searchParams;
  const job = await fetchInspectorJob(id);
  if (!job) notFound();

  return (
    <div className="space-y-8">
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
              Inspector Portal · Job
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

          {/* Primary CTA — context-aware */}
          <PrimaryAction job={job} />
        </div>
      </header>

      {/* Action banners */}
      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.applied && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Application submitted. The client will review your profile and
          mark a preferred candidate — admin finalises the hire.
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
        Posted {formatRelative(job.createdAt)} · ID {job.id.slice(0, 8)}
      </p>
    </div>
  );
}

/* ─── primary CTA — context-aware ────────────────────────────────────── */

function PrimaryAction({ job }: { job: InspectorJobDetail }) {
  // Already applied — link to status panel below (anchor).
  if (job.myApplication) {
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
            Submitted {formatRelative(application.createdAt)} · ID{' '}
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
