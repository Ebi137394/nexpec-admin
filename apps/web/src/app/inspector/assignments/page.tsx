// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/assignments/page.tsx — Inspector's active work queue
//
//  Shows jobs where the inspector has been hired. Grouped by job state:
//     Work imminent | In progress | Completed | Disputed.
//
//  "Submit report" CTA surfaces on in-progress and assigned rows. It
//  routes to /inspector/jobs/[id]/submit-report which lands in Sprint 6.
//  Until then the link goes through but the destination is the standard
//  job detail page.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ClipboardList,
  ChevronRight,
  MapPin,
  CalendarDays,
  Wallet,
  Building2,
  PenLine,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { fetchInspectorAssignments } from '@/lib/data/inspectorAssignments';
import type {
  BucketedAssignments,
  InspectorAssignmentRow,
} from '@/lib/data/inspectorAssignments.types';
import type { JobStatus, JobUrgency } from '@/lib/data/clientJobs.types';

export const metadata: Metadata = {
  title: 'Active assignments',
};

export const dynamic = 'force-dynamic';

export default async function InspectorAssignmentsPage() {
  const assignments: BucketedAssignments = await fetchInspectorAssignments();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal · My work
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Active assignments
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Jobs you&apos;ve been hired on. Submit signed reports here; admin
          reviews each one before routing to the client. The payout
          releases once both sides sign off.
        </p>
      </header>

      {assignments.total === 0 ? (
        <EmptyState />
      ) : (
        <>
          {assignments.workImminent.length > 0 && (
            <Group
              title={`Work imminent · ${assignments.workImminent.length}`}
              subtitle="Assigned and contract generated. Begin when scheduled."
              tone="violet"
              icon={<Clock className="h-4 w-4" />}
            >
              {assignments.workImminent.map((a) => (
                <AssignmentCard key={a.applicationId} a={a} />
              ))}
            </Group>
          )}
          {assignments.inProgress.length > 0 && (
            <Group
              title={`In progress · ${assignments.inProgress.length}`}
              subtitle="Active work. Submit your signed report when complete."
              tone="cyan"
              icon={<PenLine className="h-4 w-4" />}
            >
              {assignments.inProgress.map((a) => (
                <AssignmentCard key={a.applicationId} a={a} primary />
              ))}
            </Group>
          )}
          {assignments.completed.length > 0 && (
            <Group
              title={`Completed · ${assignments.completed.length}`}
              subtitle="Report submitted. Payout follows admin review + client confirmation."
              tone="green"
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              {assignments.completed.map((a) => (
                <AssignmentCard key={a.applicationId} a={a} />
              ))}
            </Group>
          )}
          {assignments.disputed.length > 0 && (
            <Group
              title={`Disputed · ${assignments.disputed.length}`}
              subtitle="Admin is mediating. Payout is held until resolved."
              tone="red"
              icon={<AlertTriangle className="h-4 w-4" />}
            >
              {assignments.disputed.map((a) => (
                <AssignmentCard key={a.applicationId} a={a} />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}

/* ─── sections ───────────────────────────────────────────────────────── */

function Group({
  title,
  subtitle,
  tone,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  tone: 'violet' | 'cyan' | 'green' | 'red';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const accent = {
    violet: 'text-violet-glow',
    cyan: 'text-cyan-glow',
    green: 'text-accent-green',
    red: 'text-accent-red',
  }[tone];
  return (
    <section className="space-y-3">
      <header>
        <div className="flex items-center gap-2">
          <span className={accent}>{icon}</span>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="ml-6 mt-0.5 text-sm text-zinc-500">{subtitle}</p>
        )}
      </header>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <ClipboardList className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
        Nothing assigned yet.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
        Active assignments land here the moment our team confirms a hire.
        Until then, browse the open queue and apply to jobs that fit your
        specialty.
      </p>
      <Link
        href="/inspector/jobs"
        className="btn-primary mt-6 inline-flex items-center gap-2"
      >
        Browse open jobs
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      </Link>
    </section>
  );
}

function AssignmentCard({
  a,
  primary = false,
}: {
  a: InspectorAssignmentRow;
  primary?: boolean;
}) {
  const showSubmitReportCta =
    a.jobStatus === 'in_progress' || a.jobStatus === 'assigned';

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/inspector/jobs/${a.jobId}`}
            className="block truncate text-base font-semibold text-white transition-colors hover:text-violet-glow"
          >
            {a.jobTitle}
          </Link>
          {a.clientCompanyName && (
            <p className="mt-0.5 inline-flex items-center gap-1 truncate text-xs text-zinc-500">
              <Building2 className="h-3 w-3" strokeWidth={1.75} />
              {a.clientCompanyName}
            </p>
          )}
        </div>
        <JobStatusPill status={a.jobStatus} />
      </header>

      {/* Payout — only money column shown to inspector */}
      <div className="mt-4 flex items-baseline justify-between gap-2 border-y border-white/[0.04] py-3">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Inspector payout
        </p>
        <p
          className={`font-mono text-lg font-semibold tracking-tight ${
            primary ? 'text-cyan-glow' : 'text-violet-glow'
          }`}
        >
          {formatPayout(a.inspectorPayoutCents)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
        {a.jobLocationCity && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" strokeWidth={1.75} />
            {a.jobLocationCity}
          </span>
        )}
        {a.jobScheduledDate && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
            {new Date(a.jobScheduledDate).toLocaleDateString()}
          </span>
        )}
        {a.payoutStatus && a.payoutStatus !== 'unpaid' && (
          <PayoutStatusPill status={a.payoutStatus} />
        )}
        {a.jobUrgency && a.jobUrgency !== 'normal' && (
          <UrgencyPill urgency={a.jobUrgency} />
        )}
      </div>

      <footer className="mt-auto flex items-center justify-between gap-2 pt-5 text-[11px] text-zinc-500">
        <span className="font-mono uppercase tracking-industrial">
          {a.hiredAt
            ? `hired ${formatRelative(a.hiredAt)}`
            : `applied ${formatRelative(a.applicationCreatedAt)}`}
        </span>
        {showSubmitReportCta ? (
          <Link
            href={`/inspector/jobs/${a.jobId}/submit-report`}
            className="inline-flex items-center gap-1.5 rounded-full bg-cyan-glow/15 px-3 py-1.5 text-xs font-semibold text-cyan-glow ring-1 ring-inset ring-cyan-glow/30 transition-colors hover:bg-cyan-glow/25"
          >
            <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
            Submit report
          </Link>
        ) : (
          <Link
            href={`/inspector/jobs/${a.jobId}`}
            className="inline-flex items-center gap-1 text-zinc-400 transition-colors hover:text-violet-glow"
          >
            View details
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        )}
      </footer>
    </article>
  );
}

/* ─── pills ──────────────────────────────────────────────────────────── */

function JobStatusPill({ status }: { status: JobStatus }) {
  const tone =
    status === 'assigned'
      ? 'violet'
      : status === 'in_progress'
        ? 'cyan'
        : status === 'completed'
          ? 'green'
          : status === 'disputed'
            ? 'red'
            : 'zinc';
  return <Pill tone={tone} label={status.replace('_', ' ')} />;
}

function PayoutStatusPill({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'green'
      : status === 'processing'
        ? 'cyan'
        : status === 'disputed'
          ? 'red'
          : 'zinc';
  return <Pill tone={tone} label={`payout · ${status}`} />;
}

function UrgencyPill({ urgency }: { urgency: JobUrgency }) {
  const tone =
    urgency === 'critical'
      ? 'red'
      : urgency === 'high'
        ? 'amber'
        : 'violet';
  return <Pill tone={tone} label={`urgency · ${urgency}`} />;
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
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {label}
    </span>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

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
