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
import { fetchOpenJobs, type OpenJobFilters } from '@/lib/data/openJobs';
import type {
  InspectorApplicationStatus,
  OpenJobRow,
} from '@/lib/data/openJobs.types';
import type { JobUrgency } from '@/lib/data/clientJobs.types';

export const metadata: Metadata = {
  title: 'Open jobs',
};

export const dynamic = 'force-dynamic';

const COMMON_SPECIALTY_OPTIONS = [
  { slug: 'ndt',         label: 'NDT' },
  { slug: 'api-510',     label: 'API 510 (Pressure Vessels)' },
  { slug: 'api-570',     label: 'API 570 (Piping)' },
  { slug: 'api-653',     label: 'API 653 (Tanks)' },
  { slug: 'cwi',         label: 'CWI (Welding)' },
  { slug: 'welding',     label: 'Welding' },
  { slug: 'cathodic',    label: 'Cathodic protection' },
  { slug: 'electrical',  label: 'Electrical' },
  { slug: 'mechanical',  label: 'Mechanical' },
  { slug: 'structural',  label: 'Structural' },
  { slug: 'lifting',     label: 'Lifting / rigging' },
  { slug: 'environmental', label: 'Environmental' },
];

type ParamValue = string | string[] | undefined;

interface PageProps {
  searchParams?: Promise<Record<string, ParamValue>>;
}

function asString(v: ParamValue): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function asArray(v: ParamValue): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  // Allow comma-separated as a backup format
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export default async function InspectorOpenJobsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const specs = asArray(sp.specialties);
  const urgencyRaw = asString(sp.urgency);
  const filters: OpenJobFilters = {
    specialties: specs.length > 0 ? specs : undefined,
    city: asString(sp.city) || undefined,
    urgency:
      urgencyRaw && ['low', 'normal', 'high', 'critical'].includes(urgencyRaw)
        ? (urgencyRaw as 'low' | 'normal' | 'high' | 'critical')
        : undefined,
    remoteOnly: asString(sp.remote) === '1',
    sponsorshipOnly: asString(sp.sponsorship) === '1',
    jobType: asString(sp.jobType) || undefined,
    scheduledFrom: asString(sp.from) || undefined,
    scheduledTo: asString(sp.to) || undefined,
    q: asString(sp.q) || undefined,
  };
  const activeFilterCount = countActive(filters);

  const jobs = await fetchOpenJobs({ filters });
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

      <FilterBar filters={filters} activeCount={activeFilterCount} />

      {jobs.length === 0 ? (
        activeFilterCount > 0 ? <NoMatchState /> : <EmptyState />
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

/* ─── filter bar ─────────────────────────────────────────────────────── */

function countActive(f: OpenJobFilters): number {
  let n = 0;
  if (f.specialties && f.specialties.length > 0) n += f.specialties.length;
  if (f.city) n += 1;
  if (f.urgency) n += 1;
  if (f.remoteOnly) n += 1;
  if (f.sponsorshipOnly) n += 1;
  if (f.jobType) n += 1;
  if (f.scheduledFrom) n += 1;
  if (f.scheduledTo) n += 1;
  if (f.q) n += 1;
  return n;
}

function FilterBar({
  filters,
  activeCount,
}: {
  filters: OpenJobFilters;
  activeCount: number;
}) {
  const selectedSpecialties = new Set(filters.specialties ?? []);
  return (
    <form
      method="GET"
      action="/inspector/jobs"
      className="space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Search
          </span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Keywords (title or description)"
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet/40 focus:outline-none focus:ring-2 focus:ring-violet/20"
          />
        </label>
        <label className="sm:w-48">
          <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            City
          </span>
          <input
            type="text"
            name="city"
            defaultValue={filters.city ?? ''}
            placeholder="e.g. Riyadh"
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet/40 focus:outline-none focus:ring-2 focus:ring-violet/20"
          />
        </label>
        <label className="sm:w-40">
          <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Urgency
          </span>
          <select
            name="urgency"
            defaultValue={filters.urgency ?? ''}
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white focus:border-violet/40 focus:outline-none"
          >
            <option value="" className="bg-ink-900">Any</option>
            <option value="low" className="bg-ink-900">Low</option>
            <option value="normal" className="bg-ink-900">Normal</option>
            <option value="high" className="bg-ink-900">High</option>
            <option value="critical" className="bg-ink-900">Critical</option>
          </select>
        </label>
        <label className="sm:w-40">
          <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Job type
          </span>
          <select
            name="jobType"
            defaultValue={filters.jobType ?? ''}
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white focus:border-violet/40 focus:outline-none"
          >
            <option value="" className="bg-ink-900">Any</option>
            <option value="on_site" className="bg-ink-900">On-site</option>
            <option value="remote" className="bg-ink-900">Remote</option>
            <option value="hybrid" className="bg-ink-900">Hybrid</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="sm:w-48">
          <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Scheduled from
          </span>
          <input
            type="date"
            name="from"
            defaultValue={filters.scheduledFrom ?? ''}
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white focus:border-violet/40 focus:outline-none"
          />
        </label>
        <label className="sm:w-48">
          <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Scheduled to
          </span>
          <input
            type="date"
            name="to"
            defaultValue={filters.scheduledTo ?? ''}
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white focus:border-violet/40 focus:outline-none"
          />
        </label>
        <label className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            name="remote"
            value="1"
            defaultChecked={filters.remoteOnly === true}
            className="h-3.5 w-3.5 accent-violet"
          />
          Remote inspectors OK
        </label>
        <label className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            name="sponsorship"
            value="1"
            defaultChecked={filters.sponsorshipOnly === true}
            className="h-3.5 w-3.5 accent-violet"
          />
          Sponsorship offered
        </label>
      </div>

      <fieldset>
        <legend className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Specialties — match any
        </legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {COMMON_SPECIALTY_OPTIONS.map((opt) => {
            const checked = selectedSpecialties.has(opt.slug);
            return (
              <label
                key={opt.slug}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                  checked
                    ? 'border-violet/40 bg-violet/15 text-violet-glow'
                    : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-violet/30 hover:text-white'
                }`}
              >
                <input
                  type="checkbox"
                  name="specialties"
                  value={opt.slug}
                  defaultChecked={checked}
                  className="sr-only"
                />
                {opt.label}
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-zinc-600">
          A job matches if it has at least one of the selected specialties.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3">
        <p className="text-[11px] text-zinc-500">
          {activeCount > 0 ? `${activeCount} filter${activeCount > 1 ? 's' : ''} active` : 'No filters'}
        </p>
        <div className="flex gap-2">
          {activeCount > 0 && (
            <Link
              href="/inspector/jobs"
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs font-semibold text-zinc-300 hover:border-violet/30 hover:text-white"
            >
              Clear
            </Link>
          )}
          <button
            type="submit"
            className="rounded-full bg-violet px-5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet/90"
          >
            Apply filters
          </button>
        </div>
      </div>
    </form>
  );
}

function NoMatchState() {
  return (
    <section className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
      <p className="text-sm text-zinc-400">
        No jobs match your filters.
      </p>
      <Link
        href="/inspector/jobs"
        className="mt-3 inline-block text-xs font-semibold text-violet-glow hover:text-white"
      >
        Clear filters →
      </Link>
    </section>
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
