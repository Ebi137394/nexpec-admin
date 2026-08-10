// ════════════════════════════════════════════════════════════════════════════
//  app/admin/reports/page.tsx — Admin inspection-report review
//
//  WHY THIS PAGE EXISTS
//  inspection_reports has carried technical_approved / financial_approved (each
//  with a *_by FK to auth.users) since the baseline. submitReport.ts explicitly
//  declines to set them; inspectorReport.ts reads and DISPLAYS them. Nothing in
//  the product ever wrote them — admin web had 32 routes and none reviewed a
//  report. Inspectors were shown an approval state that could not become true.
//
//  This is the missing surface, not a new subsystem: it drives the columns that
//  were always there, via nx_admin_review_inspection_report (20260801364000).
//
//  ── BOUNDARIES THIS PAGE RESPECTS ──────────────────────────────────────────
//   • Publishing is the CLIENT's decision (approve_inspection_report). Publish
//     state is shown here READ-ONLY; there is no admin publish button.
//   • 'Financial' review is a cost-sanity check that authorises NO payment.
//     Settlement stays manual. Nothing on this page moves money.
//   • No pricing is displayed — the queue RPC returns no money column.
//
//  ── VISIT CONTEXT (Phase 2G) ───────────────────────────────────────────────
//  A multi-visit job produces ONE consolidated report, so "is this reviewable
//  yet?" is now a real question: signing off a surveillance report with two of
//  five visits still outstanding is a different act from signing off a finished
//  one. The rollup rides inside the existing queue RPC — one round trip, not
//  one per report — and a job with no explicit visits shows nothing, because a
//  single scheduled date is not a programme.
//
//  Admin gating is enforced by app/admin/layout.tsx and re-checked here via
//  nx_is_admin (fail closed on any future routing slip); the RPCs check again
//  server-side.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  ClipboardCheck,
  FileText,
  ShieldCheck,
  Wallet,
  CheckCircle2,
  CircleDashed,
  Eye,
  ExternalLink,
  CalendarDays,
  Repeat,
  AlertCircle,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchReportReviewQueue, type ReportReviewRow } from '@/lib/data/reportReview';
import { reviewInspectionReport } from '@/lib/actions/reportReview';
import { isRealProgramme, type ReportVisitRollup } from '@/lib/data/reportVisits';

export const metadata: Metadata = { title: 'Admin, Report review' };
export const dynamic = 'force-dynamic';

function StatePill({ on, label, Icon }: { on: boolean; label: string; Icon: typeof ShieldCheck }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ' +
        (on
          ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/20'
          : 'bg-white/[0.03] text-zinc-500 ring-1 ring-inset ring-white/[0.06]')
      }
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
    </span>
  );
}

/**
 * Programme context for ONE report. Renders nothing for a job with no explicit
 * visits: nx_report_visit_rollup marks that case fromFallback, and dressing a
 * single scheduled date up as a one-visit "programme" would be noise on every
 * legacy report in the queue.
 */
function VisitContext({ rollup }: { rollup: ReportVisitRollup | null }) {
  if (!isRealProgramme(rollup) || !rollup) return null;

  const chip =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset';

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className={chip + ' bg-violet/10 text-violet-glow ring-violet/25'}>
        <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
        {rollup.completed} of {rollup.visitCount} visits completed
      </span>
      {rollup.isRecurring && (
        <span className={chip + ' bg-white/[0.03] text-zinc-400 ring-white/[0.06]'}>
          <Repeat className="h-3.5 w-3.5" strokeWidth={1.75} />
          Recurring
        </span>
      )}
      {rollup.outstanding > 0 && (
        <span className={chip + ' bg-amber-500/10 text-amber-300 ring-amber-500/20'}>
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {rollup.outstanding} visit{rollup.outstanding === 1 ? '' : 's'} still
          outstanding
        </span>
      )}
      {rollup.lastCompletedAt && (
        <span className="text-[11px] text-zinc-600">
          last worked {new Date(rollup.lastCompletedAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function ReviewButtons({ row }: { row: ReportReviewRow }) {
  // Server Actions bound per row. Each is a distinct closure so the form posts
  // exactly one decision.
  async function passTechnical() {
    'use server';
    await reviewInspectionReport(row.reportId, 'technical', true);
  }
  async function failTechnical() {
    'use server';
    await reviewInspectionReport(row.reportId, 'technical', false);
  }
  async function passFinancial() {
    'use server';
    await reviewInspectionReport(row.reportId, 'financial', true);
  }
  async function failFinancial() {
    'use server';
    await reviewInspectionReport(row.reportId, 'financial', false);
  }

  const btn =
    'rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-40';
  const pass = btn + ' bg-emerald-500/10 text-emerald-300 ring-emerald-500/20 hover:bg-emerald-500/20';
  const fail = btn + ' bg-amber-500/10 text-amber-300 ring-amber-500/20 hover:bg-amber-500/20';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={passTechnical}>
        <button type="submit" className={pass} disabled={row.technicalApproved}>
          Pass technical
        </button>
      </form>
      <form action={failTechnical}>
        <button type="submit" className={fail}>
          Technical needs changes
        </button>
      </form>
      <form action={passFinancial}>
        <button type="submit" className={pass} disabled={row.financialApproved}>
          Pass financial
        </button>
      </form>
      <form action={failFinancial}>
        <button type="submit" className={fail}>
          Financial needs changes
        </button>
      </form>
    </div>
  );
}

export default async function AdminReportReviewPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/reports'));

  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const rows = await fetchReportReviewQueue(100, false);
  const awaiting = rows.filter((r) => !r.technicalApproved || !r.financialApproved);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Admin, Report review
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Inspection report review
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Technical and financial sign-off on submitted inspection reports.{' '}
          {awaiting.length} of {rows.length} awaiting a decision.
        </p>
        <p className="mt-3 max-w-3xl rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-zinc-500">
          Review is a quality gate, not a commercial one. Passing financial review
          records a cost-sanity check and{' '}
          <span className="text-zinc-300">releases no payment</span> — settlement
          stays manual. Publishing a report to the client remains the{' '}
          <span className="text-zinc-300">client&rsquo;s</span> decision; publish
          state below is read-only.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-400">No inspection reports submitted yet.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li
              key={r.reportId}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
                    <Link
                      href={`/admin/jobs/${r.jobId}`}
                      className="truncate font-medium text-white hover:text-violet-glow"
                    >
                      {r.jobTitle ?? 'Untitled job'}
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {r.inspectorName ?? 'Unknown inspector'}
                    {r.submittedAt
                      ? ` · submitted ${new Date(r.submittedAt).toLocaleDateString()}`
                      : ''}
                    {r.status ? ` · ${r.status}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatePill on={r.technicalApproved} label="Technical" Icon={ShieldCheck} />
                  <StatePill on={r.financialApproved} label="Financial" Icon={Wallet} />
                  <StatePill
                    on={r.isPublished}
                    label={r.isPublished ? 'Published' : 'Not published'}
                    Icon={r.isPublished ? CheckCircle2 : CircleDashed}
                  />
                  <StatePill on={r.isClientApproved} label="Client approved" Icon={Eye} />
                </div>
              </div>

              <VisitContext rollup={r.visitRollup} />

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
                <ReviewButtons row={r} />
                {r.pdfUrl ? (
                  <a
                    href={r.pdfUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Open PDF
                  </a>
                ) : (
                  <span className="text-xs text-zinc-600">No PDF attached</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
