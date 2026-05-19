// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/page.tsx — Jobs Moderation
//
//  Defensive on every wire: invalid inspect ids never reach the drawer,
//  the drawer is conditionally mounted (instead of always-mounted-with-null),
//  and every fetcher is wrapped in try/catch at the data layer.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import {
  fetchJobsModerationPage,
  fetchModerationJob,
  fetchModerationTimeline,
  isJobStatus,
} from '@/lib/data/jobsModeration';
import { JobsModerationTable } from '@/components/admin/jobs/JobsModerationTable';
import { JobsStatusFilter } from '@/components/admin/jobs/JobsStatusFilter';
import { JobModerationDrawer } from '@/components/admin/jobs/JobModerationDrawer';
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

      {/* Only mount the drawer when we have a real job to inspect. Mounting
          it with job=null forced the client component to evaluate hooks +
          effects against null, which (depending on imported helpers like
          formatCents) could throw during SSR. Conditional mount = zero
          risk of null-prop SSR errors. */}
      {inspected && (
        <JobModerationDrawer job={inspected} timeline={timeline} />
      )}
    </div>
  );
}
