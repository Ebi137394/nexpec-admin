// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/page.tsx — Jobs Moderation
//
//  Defensive on every wire: invalid inspect ids never reach the drawer,
//  the drawer is conditionally mounted (instead of always-mounted-with-null),
//  and every fetcher is wrapped in try/catch at the data layer.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  fetchJobsModerationPage,
  fetchModerationJob,
  fetchModerationTimeline,
  fetchModerationApplicants,
  isJobStatus,
  type ModerationApplicant,
} from '@/lib/data/jobsModeration';
import {
  fetchAdminJobContractForJob,
  type AdminJobContractRow,
} from '@/lib/data/jobContracts';
import { JobsModerationTable } from '@/components/admin/jobs/JobsModerationTable';
import { JobsStatusFilter } from '@/components/admin/jobs/JobsStatusFilter';
import { JobModerationPanel } from '@/components/admin/jobs/JobModerationPanel';
import { Pagination } from '@/components/admin/audit/Pagination';
import type {
  ModerationJobDetail,
  ModerationTimelineEvent,
} from '@/lib/data/jobsModeration.types';

export const metadata: Metadata = { title: 'Jobs Moderation' };
export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  searchParams: Promise<{
    status?: string;
    page?: string;
    inspect?: string;
    error?: string;
    ok?: string;
  }>;
}

export default async function JobsModerationPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const page = parseInt(sp.page ?? '1', 10) || 1;
  const status = isJobStatus(sp.status) ? sp.status : undefined;

  // Validate inspect param before passing it to the fetchers. If it isn't a
  // UUID, ignore it entirely — Postgres throws on malformed UUIDs and we
  // don't want that surfacing as a 500.
  const inspectId =
    sp.inspect && UUID_RE.test(sp.inspect) ? sp.inspect : null;

  // Fetch each piece independently and tolerate any failure. We wrap the
  // Promise.all so even a thrown rejection from a poorly-typed RPC can't
  // collapse the whole page.
  let jobs: Awaited<ReturnType<typeof fetchJobsModerationPage>>['jobs'] = [];
  let total = 0;
  let totalPages = 1;
  let pageSize = 25;
  let inspected: ModerationJobDetail | null = null;
  let timeline: ModerationTimelineEvent[] = [];
  let applicants: ModerationApplicant[] = [];
  let jobContract: AdminJobContractRow | null = null;

  try {
    const result = await fetchJobsModerationPage({ page, status });
    jobs = result.jobs;
    total = result.total;
    totalPages = result.totalPages;
    pageSize = result.pageSize;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.error('[admin/jobs] fetchJobsModerationPage threw:', e);
    }
  }

  if (inspectId) {
    try {
      inspected = await fetchModerationJob(inspectId);
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('[admin/jobs] fetchModerationJob threw:', e);
      }
    }
    try {
      timeline = await fetchModerationTimeline(inspectId);
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('[admin/jobs] fetchModerationTimeline threw:', e);
      }
    }
    try {
      applicants = await fetchModerationApplicants(inspectId);
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('[admin/jobs] fetchModerationApplicants threw:', e);
      }
    }
    try {
      jobContract = await fetchAdminJobContractForJob(inspectId);
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('[admin/jobs] fetchAdminJobContractForJob threw:', e);
      }
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console · Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Jobs Moderation
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Platform-wide job queue. Click any row to open the moderation
          drawer — approve, request edits, or reject. Rejection cascades
          through <span className="font-mono text-zinc-200">admin_cancel_job</span>
          ; every decision is correlation-stamped in the Audit Trail.
        </p>
      </header>

      {sp.ok && (
        <div className="rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 text-sm text-accent-green">
          Decision recorded: <span className="font-mono">{sp.ok}</span>
        </div>
      )}

      {/* Moderation panel renders ABOVE the table when ?inspect=… is set.
          Anchor id="moderation" so the click-from-table navigation can
          jump to it. Pure server component — zero hydration risk. */}
      {inspected ? (
        <div id="moderation" className="scroll-mt-24">
          <JobModerationPanel
            job={inspected}
            timeline={timeline}
            applicants={applicants}
            jobContract={jobContract}
            errorMessage={sp.error}
          />
        </div>
      ) : inspectId ? (
        <div className="rounded-2xl border border-accent-amber/30 bg-accent-amber/10 p-6">
          <p className="font-semibold text-accent-amber">
            Couldn&rsquo;t load that job (id: <span className="font-mono text-xs">{inspectId}</span>)
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            The row might have been deleted or your session lost SELECT
            permission. <Link href="/admin/jobs" className="underline">Clear inspect param</Link>.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <JobsStatusFilter />
        <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          {status ?? 'all statuses'} · {total.toLocaleString()} rows
        </p>
      </div>

      <JobsModerationTable jobs={jobs} selectedId={inspectId} />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
      />
    </div>
  );
}
