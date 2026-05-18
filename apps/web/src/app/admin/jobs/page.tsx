// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/page.tsx — Jobs Moderation (Sprint 4: drawer live)
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

export const metadata: Metadata = { title: 'Jobs Moderation' };
export const dynamic = 'force-dynamic';

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

  const [{ jobs, total, totalPages, pageSize }, inspected, timeline] =
    await Promise.all([
      fetchJobsModerationPage({ page, status }),
      sp.inspect ? fetchModerationJob(sp.inspect) : Promise.resolve(null),
      sp.inspect ? fetchModerationTimeline(sp.inspect) : Promise.resolve([]),
    ]);

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

      <JobsModerationTable jobs={jobs} selectedId={sp.inspect ?? null} />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
      />

      <JobModerationDrawer job={inspected} timeline={timeline} />
    </div>
  );
}
