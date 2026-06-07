// ════════════════════════════════════════════════════════════════════════════
//  components/flash-reports/FlashReportSection.tsx — drop-in NCR surface.
//
//  Self-fetching async server component so any portal page (inspector / admin /
//  client) can mount it with one line, without rethreading its data flow. It
//  reuses the existing section shells:
//    • variant="page"  → rounded-3xl section (inspector / client job pages)
//    • variant="panel" → rounded-xl section (admin JobModerationPanel aside)
//
//  Tokens only: ink/violet/cyan-glow/accent-*. No new design patterns.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { Siren, Plus } from 'lucide-react';
import { fetchFlashReportsForJob } from '@/lib/data/flashReports';
import type { FlashReportViewerRole } from '@/lib/data/flashReports';
import { FlashReportCard } from './FlashReportCard';

export async function FlashReportSection({
  jobId,
  viewerRole,
  portal,
  raiseHref = null,
  variant = 'page',
}: {
  jobId: string;
  viewerRole: FlashReportViewerRole;
  portal: 'inspector' | 'admin' | 'client';
  /** When set, renders a "Raise report" CTA (inspector hired+active only). */
  raiseHref?: string | null;
  variant?: 'page' | 'panel';
}) {
  const { viewerId, reports } = await fetchFlashReportsForJob(jobId);

  // Nothing to raise and nothing to show → render nothing (keeps non-engaged
  // surfaces clean, matching mobile where the tool only appears in-context).
  if (reports.length === 0 && !raiseHref) return null;

  const isPanel = variant === 'panel';
  const shell = isPanel
    ? 'rounded-xl border border-white/[0.06] bg-white/[0.02] p-4'
    : 'rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8';

  return (
    <section className={shell}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Siren
            className={isPanel ? 'h-4 w-4 text-violet-glow' : 'h-5 w-5 text-violet-glow'}
            strokeWidth={1.75}
          />
          <div>
            <h2
              className={
                isPanel
                  ? 'text-[10px] font-semibold uppercase tracking-industrial text-violet-glow'
                  : 'font-display text-lg font-semibold tracking-tight text-white'
              }
            >
              Flash Reports
            </h2>
            {!isPanel && (
              <p className="mt-0.5 text-xs text-zinc-500">
                Non-conformance reports raised mid-job (NCRs).
              </p>
            )}
          </div>
        </div>

        {raiseHref && (
          <Link
            href={raiseHref}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-xs font-bold uppercase tracking-industrial text-violet-300 transition hover:bg-violet-500/20"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Raise report
          </Link>
        )}
      </div>

      {reports.length === 0 ? (
        <p
          className={
            (isPanel ? 'mt-3' : 'mt-4') +
            ' rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-500'
          }
        >
          No flash reports on this job yet.
        </p>
      ) : (
        <div className={(isPanel ? 'mt-3' : 'mt-5') + ' space-y-3'}>
          {reports.map((r) => (
            <FlashReportCard
              key={r.id}
              report={r}
              viewerId={viewerId}
              viewerRole={viewerRole}
              portal={portal}
              jobId={jobId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
