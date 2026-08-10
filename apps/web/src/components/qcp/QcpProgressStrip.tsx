// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpProgressStrip.tsx — derived progress, or an honest blank
//
//  §2 forbids storing a progress column: progress is derived at read time from
//  itp_point_results through qcp_stage_templates → itp_points, and only
//  nx_project_qcp derives it. This component RENDERS that answer and never
//  computes one. If the reader projected no progress columns, it says so
//  instead of showing zeros — a zero and "we were not told" look identical on a
//  dashboard and mean opposite things on a quality plan.
// ════════════════════════════════════════════════════════════════════════════

import { Activity, CircleHelp } from 'lucide-react';
import type { QcpProgress } from '@/lib/data/qcp';

function Cell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">
        {value === null ? '—' : value}
      </p>
    </div>
  );
}

export function QcpProgressStrip({
  progress,
  effectiveRevisionNo,
}: {
  progress: QcpProgress;
  effectiveRevisionNo: number | null;
}) {
  if (!progress.reported) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Execution progress</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            nx_project_qcp returned no progress figures for this project, so
            none are shown. Progress is derived at read time from recorded ITP
            results through the plan&apos;s template links — it is never stored
            on the plan and is never recomputed on this page, so an absent
            answer is reported as absent rather than rendered as zero.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Activity className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
        Execution progress
        {effectiveRevisionNo !== null && (
          <span className="text-xs font-normal text-zinc-500">
            against revision {effectiveRevisionNo}
          </span>
        )}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Cell label="Points" value={progress.totalPoints} />
        <Cell label="Recorded" value={progress.recordedPoints} />
        <Cell label="Outstanding" value={progress.outstandingPoints} />
        <Cell label="Passed" value={progress.passedPoints} />
        <Cell label="Failed" value={progress.failedPoints} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
        Derived by the database at read time from recorded ITP results, reached
        through this plan&apos;s stage → template links. The QCP stores no
        progress of its own and this page computes none; the points themselves
        live on the scope templates and are executed on jobs, not here.
      </p>
    </section>
  );
}
