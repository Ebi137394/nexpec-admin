// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/jobs/page.tsx — Inspector's open-jobs feed
//
//  Visible columns are STRICTLY limited per Golden Rule #2:
//    • Title, location, urgency, specialties, scheduled date
//    • Inspector payout (admin-set) — the only money column shown
//    • Client COMPANY name only (Rule #4/7 — no personal info)
//    • "Applied" badge driven by applications table for this inspector
//
//  Hidden by design: client budget, client price, spread, OTHER inspectors'
//  bids, OTHER inspectors' identities.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ChevronRight,
  MapPin,
  Compass,
  Globe2,
  Plane,
  Briefcase,
  Tag,
} from 'lucide-react';
import { fetchOpenJobs } from '@/lib/data/openJobs';
import type {
  InspectorApplicationStatus,
  OpenJobRow,
} from '@/lib/data/openJobs.types';
import type { JobUrgency } from '@/lib/data/clientJobs.types';

export const metadata: Metadata = {
  title: 'Open jobs',
};

export const dynamic = 'force-dynamic';

export default async function InspectorOpenJobsPage() {
  const jobs = await fetchOpenJobs();
  const newOnes = jobs.filter((j) => !j.hasApplied);
  const applied = jobs.filter((j) => j.hasApplied);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal · Find work
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Open jobs
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Inspections cleared by our moderation team and ready for
          applications. Each listing shows the payout we&apos;ll release
          on a signed report — your wallet picks up after the job
          completes.
        </p>
      </header>

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {newOnes.length > 0 && (
            <Group title={`Available · ${newOnes.length}`}>
              {newOnes.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </Group>
          )}
          {applied.length > 0 && (
            <Group
              title={`You've applied · ${applied.length}`}
              subtitle="Tracking these on your end. Status updates appear here."
            >
              {applied.map((j) => (
                <JobCard key={j.id} job={j} />
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
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
        )}
      </header>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
        <Compass className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
        Nothing open right now.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
        New inspections post throughout the day. Check back shortly —
        push notifications light up the moment a job in your specialty
        clears moderation.
      </p>
    </section>
  );
}

function JobCard({ job }: { job: OpenJobRow }) {
  return (
    <Link
      href={`/inspector/jobs/${job.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 transition-all hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-[0_20px_40px_-20px_rgba(124,58,237,0.4)]"
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-white group-hover:text-violet-glow">
            {job.title}
          </h3>
          {job.clientCompanyName && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              for {job.clientCompanyName}
            </p>
          )}
        </div>
        {job.hasApplied && job.myApplicationStatus && (
          <AppliedPill status={job.myApplicationStatus} />
        )}
      </header>

      {/* Payout — the ONLY money line visible to inspector */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-y border-white/[0.04] py-3">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Inspector payout
        </p>
        <p className="font-mono text-lg font-semibold tracking-tight text-violet-glow">
          {formatPayout(job.inspectorPayoutCents)}
        </p>
      </div>

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
        {job.locationCity && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" strokeWidth={1.75} />
            {job.locationCity}
          </span>
        )}
        {job.jobType && (
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3 w-3" strokeWidth={1.75} />
            {job.jobType === 'on_site' ? 'On-site' : job.jobType === 'remote' ? 'Remote' : job.jobType}
          </span>
        )}
        {job.scheduledDate && (
          <span className="inline-flex items-center gap-1">
            scheduled · {new Date(job.scheduledDate).toLocaleDateString()}
          </span>
        )}
        {job.acceptsRemoteInspectors && (
          <span className="inline-flex items-center gap-1 text-cyan-glow">
            <Globe2 className="h-3 w-3" strokeWidth={1.75} />
            Remote inspectors OK
          </span>
        )}
        {job.sponsorshipOffered !== 'none' && (
          <span className="inline-flex items-center gap-1 text-accent-amber">
            <Plane className="h-3 w-3" strokeWidth={1.75} />
            {job.sponsorshipOffered === 'visa_assist' ? 'Visa assist' : 'Full sponsorship'}
          </span>
        )}
        {job.urgency && job.urgency !== 'normal' && (
          <UrgencyPill urgency={job.urgency} />
        )}
      </div>

      {/* Description preview */}
      {job.descriptionPreview && (
        <p className="mt-3 line-clamp-3 text-pretty text-sm leading-relaxed text-zinc-300">
          {job.descriptionPreview}
        </p>
      )}

      {/* Specialty tags */}
      {job.specialtySlugs.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {job.specialtySlugs.slice(0, 5).map((slug) => (
            <li
              key={slug}
              className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-medium text-violet-glow"
            >
              <Tag className="h-2.5 w-2.5" strokeWidth={2} />
              {slug.replace(/-/g, ' ')}
            </li>
          ))}
          {job.specialtySlugs.length > 5 && (
            <li className="inline-flex items-center rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-500">
              +{job.specialtySlugs.length - 5} more
            </li>
          )}
        </ul>
      )}

      {/* Footer affordance */}
      <footer className="mt-auto flex items-center justify-between gap-2 pt-5 text-[11px] text-zinc-500">
        <span className="font-mono uppercase tracking-industrial">
          posted {formatRelative(job.createdAt)}
        </span>
        <span className="inline-flex items-center gap-1 text-zinc-400 transition-colors group-hover:text-violet-glow">
          {job.hasApplied ? 'View status' : 'View & apply'}
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </footer>
    </Link>
  );
}

/* ─── pills ──────────────────────────────────────────────────────────── */

function AppliedPill({ status }: { status: InspectorApplicationStatus }) {
  // Tone reflects the inspector's perspective on the status.
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
      ? 'shortlisted'
      : status.replace('_', ' ');
  return <Pill tone={tone} label={label} />;
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
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {label}
    </span>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function formatPayout(cents: number | null): string {
  if (cents === null || cents === undefined || cents === 0) return 'Pending admin price';
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
