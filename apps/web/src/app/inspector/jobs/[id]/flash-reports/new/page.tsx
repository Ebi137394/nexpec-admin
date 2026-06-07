// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/jobs/[id]/flash-reports/new/page.tsx — Raise a Flash Report
//
//  Web parity with the mobile NCR raise screen (app/jobs/[id]/flash-reports/new).
//  The form itself is the shared FlashReportRaiseForm (also used by admin), so
//  inspector and admin raise are byte-identical. Gating: hired inspector on an
//  active job only. Identity-escrow / price-blind rules are untouched (a flash
//  report carries no payout and no PII).
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, Siren } from 'lucide-react';
import { fetchInspectorJob } from '@/lib/data/inspectorJobDetail';
import { FlashReportRaiseForm } from '@/components/flash-reports/FlashReportRaiseForm';

export const metadata: Metadata = {
  title: 'Raise a flash report',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function NewFlashReportPage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;
  const job = await fetchInspectorJob(jobId);
  if (!job) notFound();

  // Authorisation mirror of the server action — hired inspector on active job.
  const isHired =
    job.myApplication?.status === 'hired' ||
    job.myApplication?.status === 'accepted';
  if (!isHired) {
    redirect(
      `/inspector/jobs/${jobId}?error=${encodeURIComponent('Only hired inspectors can raise a flash report.')}`,
    );
  }
  if (job.status !== 'assigned' && job.status !== 'in_progress') {
    redirect(
      `/inspector/jobs/${jobId}?error=${encodeURIComponent('Flash reports can only be raised on active jobs.')}`,
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <Link
          href={`/inspector/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          <Siren className="h-3.5 w-3.5" strokeWidth={2} />
          Flash report, NCR
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Raise a flash report
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Log a non-conformance or mid-job concern on{' '}
          <span className="text-zinc-300">{job.title}</span>. Admin and the client
          see it in the job&apos;s activity, and you can track it through to
          resolution. This does not replace your final inspection report.
        </p>
      </header>

      <FlashReportRaiseForm
        jobId={job.id}
        portal="inspector"
        backHref={`/inspector/jobs/${jobId}`}
        error={qp.error}
      />
    </div>
  );
}
