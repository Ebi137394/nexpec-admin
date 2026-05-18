// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/applications/page.tsx — Application review surface
//
//  Card-grid of every application for the job. Each card shows inspector
//  identity, rating, bid, and cover note, with two server-action buttons:
//
//    Select  → status='CLIENT_SELECTED' (admin /admin/dispatch picks up
//              from there)
//    Reject  → status='rejected'
//
//  Banners surface the outcome of the most recent action via search params
//  (?selected=..., ?rejected=..., ?error=...).
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Star,
  Briefcase,
  MapPin,
  CalendarClock,
  Users,
} from 'lucide-react';
import {
  fetchClientJob,
  fetchJobApplications,
} from '@/lib/data/jobApplications';
import type {
  ApplicationStatus,
  JobApplicationRow,
} from '@/lib/data/jobApplications.types';
import {
  selectApplication,
  rejectApplication,
} from '@/lib/actions/applications';

export const metadata: Metadata = {
  title: 'Applications',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    selected?: string;
    rejected?: string;
    error?: string;
  }>;
}

export default async function ClientJobApplicationsPage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;
  const job = await fetchClientJob(jobId);
  if (!job) notFound();

  const applications = await fetchJobApplications(jobId);

  // Bucket by status for readable layout: client-selected first, then
  // pending, then closed-out (rejected / withdrawn / accepted).
  const grouped = bucket(applications);

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header>
        <Link
          href={`/client/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Applications
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {job.title}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              {applications.length} application
              {applications.length === 1 ? '' : 's'}. Selecting an
              inspector routes the application into admin dispatch — they
              confirm credentials and finalise the hire.
            </p>
          </div>
        </div>
      </header>

      {/* Action banners */}
      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.selected && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Inspector selected. The application is queued for admin dispatch.
        </Banner>
      )}
      {qp.rejected && (
        <Banner tone="zinc" icon={<XCircle className="h-5 w-5" />}>
          Application rejected. The inspector is notified automatically.
        </Banner>
      )}

      {/* Empty state */}
      {applications.length === 0 && (
        <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
            <Users className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
            No applications yet.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
            Vetted inspectors usually start applying within minutes of
            posting. Check back shortly or refresh.
          </p>
        </section>
      )}

      {/* Grouped lists */}
      {grouped.selected.length > 0 && (
        <Group
          title="Your pick — pending admin dispatch"
          subtitle="Already routed to admin. They confirm the inspector's credentials and finalise."
        >
          {grouped.selected.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
        </Group>
      )}
      {grouped.pending.length > 0 && (
        <Group
          title={`Pending review · ${grouped.pending.length}`}
          subtitle="Open applications awaiting your decision."
        >
          {grouped.pending.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
        </Group>
      )}
      {grouped.closed.length > 0 && (
        <Group
          title={`Closed · ${grouped.closed.length}`}
          subtitle="Already rejected, withdrawn, or accepted."
          collapsible
        >
          {grouped.closed.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
        </Group>
      )}
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function Group({
  title,
  subtitle,
  collapsible = false,
  children,
}: {
  title: string;
  subtitle?: string;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500">
            {subtitle}
            {collapsible && ' (Always visible — collapse arrives later.)'}
          </p>
        )}
      </header>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Card({
  app,
  jobId,
}: {
  app: JobApplicationRow;
  jobId: string;
}) {
  const insp = app.inspector;
  const initials = makeInitials(
    insp?.fullName ?? insp?.email ?? 'Inspector',
  );
  const isClosed =
    app.status === 'rejected' ||
    app.status === 'withdrawn' ||
    app.status === 'accepted';
  const isSelected = app.status === 'CLIENT_SELECTED';

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-cyan-glow text-[12px] font-semibold text-white"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {insp?.fullName || insp?.email?.split('@')[0] || 'Inspector'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            {insp?.ratingAverage !== null && insp?.ratingAverage !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Star
                  className="h-3 w-3 text-accent-amber"
                  strokeWidth={2}
                  fill="currentColor"
                />
                {insp.ratingAverage.toFixed(1)}
              </span>
            )}
            {(insp?.completedJobsCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3 w-3" strokeWidth={1.75} />
                {insp?.completedJobsCount} completed
              </span>
            )}
            {insp?.locationCity && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" strokeWidth={1.75} />
                {insp.locationCity}
              </span>
            )}
            {insp?.yearsOfExperience && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" strokeWidth={1.75} />
                {insp.yearsOfExperience} yrs
              </span>
            )}
          </div>
        </div>
        <StatusChip status={app.status} />
      </header>

      {/* GOLDEN_RULE_2 — bid_amount_cents intentionally hidden from
          client view. The inspector's bid is admin-only data. The client
          evaluates the inspector on profile signal (rating, experience,
          completed jobs) not on price. */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/[0.04] py-3">
        <ProfileSignal
          label="Rating"
          value={
            insp?.ratingAverage !== null && insp?.ratingAverage !== undefined
              ? insp.ratingAverage.toFixed(1)
              : '—'
          }
        />
        <ProfileSignal
          label="Completed"
          value={String(insp?.completedJobsCount ?? 0)}
        />
        <ProfileSignal
          label="Experience"
          value={insp?.yearsOfExperience ? `${insp.yearsOfExperience}y` : '—'}
        />
      </div>

      {app.coverNote && (
        <p className="mt-3 whitespace-pre-line text-pretty text-sm leading-relaxed text-zinc-300">
          {app.coverNote}
        </p>
      )}

      {/* Action row — hidden once the application is closed-out. */}
      {!isClosed && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {!isSelected && (
            <form action={selectApplication} className="contents">
              <input type="hidden" name="applicationId" value={app.id} />
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                Accept inspector
              </button>
            </form>
          )}
          <form action={rejectApplication} className="contents">
            <input type="hidden" name="applicationId" value={app.id} />
            <input type="hidden" name="jobId" value={jobId} />
            <button
              type="submit"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
            >
              <XCircle className="h-4 w-4" strokeWidth={2} />
              Reject
            </button>
          </form>
        </div>
      )}

      <p className="mt-4 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        Applied {formatRelative(app.createdAt)}
      </p>
    </article>
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

function StatusChip({ status }: { status: ApplicationStatus }) {
  const tone =
    status === 'CLIENT_SELECTED'
      ? 'cyan'
      : status === 'accepted'
        ? 'green'
        : status === 'rejected'
          ? 'red'
          : status === 'withdrawn'
            ? 'zinc'
            : 'violet';
  const label =
    status === 'CLIENT_SELECTED' ? 'your pick' : status.replace('_', ' ');
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
        {
          cyan: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
          green: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
          red: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
          zinc: 'border-white/[0.08] bg-white/[0.04] text-zinc-400',
          violet: 'border-violet/40 bg-violet/10 text-violet-glow',
        }[tone]
      }`}
    >
      {label}
    </span>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function bucket(apps: JobApplicationRow[]) {
  const selected: JobApplicationRow[] = [];
  const pending: JobApplicationRow[] = [];
  const closed: JobApplicationRow[] = [];
  for (const a of apps) {
    if (a.status === 'CLIENT_SELECTED') selected.push(a);
    else if (a.status === 'pending') pending.push(a);
    else closed.push(a);
  }
  return { selected, pending, closed };
}

function ProfileSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return (
    (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')
  ).toUpperCase();
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
