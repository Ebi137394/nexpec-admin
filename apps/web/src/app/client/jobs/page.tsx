// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/page.tsx — Client's job inbox
//
//  Lists every job the current client owns, newest first. Empty state
//  routes them to the new-job form. Status + moderation_status badges
//  mirror the admin/jobs visual treatment so support knows what a client
//  is looking at.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import { PlusCircle, CheckCircle2, Briefcase, ChevronRight } from 'lucide-react';
import { fetchClientJobs } from '@/lib/data/clientJobs';
import type {
  ClientJobRow,
  JobStatus,
  JobModerationStatus,
} from '@/lib/data/clientJobs.types';
import { PipelineSection } from '@/components/jobs/PipelineSection';

export const metadata: Metadata = {
  title: 'My jobs',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    created?: string;
  }>;
}

export default async function ClientJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const justCreatedId = params.created;
  const jobs = await fetchClientJobs();

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Client Portal
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            My jobs
          </h1>
          <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
            Every inspection you&apos;ve posted. Newest first. Click a row
            for the full job timeline + applications.
          </p>
        </div>
        <Link
          href="/client/jobs/new"
          className="btn-primary inline-flex items-center gap-2 self-start sm:self-end"
        >
          <PlusCircle className="h-4 w-4" strokeWidth={2} />
          Post a job
        </Link>
      </header>

      {/*
        Pipeline — surfaces limbo-state jobs (pending_approval, assigned-
        but-unsigned) + contracts waiting on the client's signature.
        Self-suppresses when nothing is pending. Strictly additive, no
        sidebar/nav changes (2026-05-20 UX directive).
      */}
      <PipelineSection tone="buyer" />

      {/* Success ribbon after a fresh post */}
      {justCreatedId && (
        <div className="flex items-start gap-3 rounded-2xl border border-cyan-glow/30 bg-cyan-glow/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
          <div>
            <p className="text-sm font-medium text-white">
              Job posted, pending moderation.
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Our team reviews every new post within one business day.
              You&apos;ll be notified the moment inspectors can see it.
            </p>
          </div>
        </div>
      )}

      {/* List or empty state */}
      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
          <table className="w-full text-left">
            <thead className="border-b border-white/[0.06] bg-white/[0.02]">
              <tr>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Moderation</Th>
                <Th>Applications</Th>
                <Th className="text-right">Budget</Th>
                <Th>Posted</Th>
                <th className="sr-only">Open</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Row key={j.id} job={j} highlight={j.id === justCreatedId} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <Briefcase className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
        No jobs yet.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
        Post your first inspection. Define the scope, pick a budget,
        fund the payment hold, vetted inspectors apply within minutes.
      </p>
      <Link
        href="/client/jobs/new"
        className="btn-primary mt-6 inline-flex items-center gap-2"
      >
        <PlusCircle className="h-4 w-4" strokeWidth={2} />
        Post your first job
      </Link>
    </section>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-5 py-3 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500 ${className ?? ''}`}
      scope="col"
    >
      {children}
    </th>
  );
}

function Row({ job, highlight }: { job: ClientJobRow; highlight: boolean }) {
  return (
    <tr
      className={`group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.02] ${
        highlight ? 'bg-violet/[0.04]' : ''
      }`}
    >
      <td className="px-5 py-4">
        <Link
          href={`/client/jobs/${job.id}`}
          className="block text-sm font-medium text-white transition-colors hover:text-violet-glow"
        >
          {job.title}
        </Link>
        {job.locationCity && (
          <p className="mt-0.5 text-xs text-zinc-500">{job.locationCity}</p>
        )}
      </td>
      <td className="px-5 py-4">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-5 py-4">
        <ModerationBadge status={job.moderationStatus} />
      </td>
      <td className="px-5 py-4 text-sm text-zinc-300">
        {job.applicationsCount}
      </td>
      <td className="px-5 py-4 text-right font-mono text-sm text-zinc-300">
        {formatBudget(job.budgetCents)}
      </td>
      <td className="px-5 py-4 text-xs text-zinc-500">
        {formatRelative(job.createdAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <Link
          href={`/client/jobs/${job.id}`}
          aria-label={`Open ${job.title}`}
          className="inline-flex text-zinc-600 transition-colors group-hover:text-violet-glow"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </td>
    </tr>
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

  return <Pill tone={tone} label={status.replace('_', ' ')} />;
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

function formatBudget(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
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
