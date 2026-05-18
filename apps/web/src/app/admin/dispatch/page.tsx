// ════════════════════════════════════════════════════════════════════════════
//  app/admin/dispatch/page.tsx — Spread Editor (Confirm & Dispatch)
//
//  Server Component. Reads every job in `status='open'` that has at least
//  one application in `status='CLIENT_SELECTED'`. Clicking an applicant
//  opens a slide-out drawer with the price-setting form. The form fires
//  the SECURITY DEFINER `admin_dispatch_job` RPC via a Zod-validated
//  Server Action.
//
//  URL is the single source of truth: ?jobId=<uuid>&appId=<uuid> opens
//  the drawer for that application. Back-button works, the URL is
//  shareable, and the underlying queue stays server-rendered.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import {
  fetchDispatchQueue,
  fetchDispatchJob,
} from '@/lib/data/dispatchQueue';
import { DispatchTable } from '@/components/admin/dispatch/DispatchTable';
import { DispatchDrawer } from '@/components/admin/dispatch/DispatchDrawer';

export const metadata: Metadata = {
  title: 'Spread Editor',
  description: 'Confirm & Dispatch — admin sets the spread and fires admin_dispatch_job.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    jobId?: string;
    appId?: string;
  }>;
}

export default async function DispatchPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  // Run both fetches in parallel: full queue (for the table) and the
  // selected job (for the drawer). They overlap on the wire but
  // de-dupe in JS — the drawer always sees fresh fk-resolved profile
  // data even if it was just fetched for the queue.
  const [{ jobs, total }, selectedJob] = await Promise.all([
    fetchDispatchQueue(),
    sp.jobId ? fetchDispatchJob(sp.jobId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console · Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Spread Editor
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Every job in <span className="font-mono text-zinc-200">open</span> status with at
          least one <span className="font-mono text-violet-glow">CLIENT_SELECTED</span> applicant.
          Pick an inspector, set the client charge and inspector payout, and
          fire the atomic dispatch RPC.
        </p>
      </header>

      {/* Queue stat */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          {total === 0
            ? 'queue is clear'
            : `${total} job${total === 1 ? '' : 's'} awaiting dispatch`}
        </p>
      </div>

      {/* Queue */}
      <DispatchTable
        jobs={jobs}
        selectedId={sp.jobId ?? null}
        selectedAppId={sp.appId ?? null}
      />

      {/* Drawer */}
      <DispatchDrawer job={selectedJob} applicationId={sp.appId ?? null} />
    </div>
  );
}
