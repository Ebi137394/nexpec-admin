// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reportReview.ts — admin inspection-report review queue
//
//  Reads nx_admin_report_review_queue (20260801364000), which is admin-gated in
//  its own body. Nothing here re-checks authorization — the page and the RPC
//  both do, and adding a third check would only create somewhere for the layers
//  to drift apart.
//
//  Returns NO pricing column of any kind. Report review is a quality gate, not
//  a commercial one; the queue RPC does not select a money column and this type
//  has nowhere to put one.
//
//  ── VISIT CONTEXT (20260801390000) ─────────────────────────────────────────
//  The queue now carries a per-report visit rollup so a reviewer can tell
//  whether the work a consolidated report describes has actually finished
//  ("3 of 5 visits done") before signing it off. It arrives INSIDE the existing
//  queue RPC on purpose: fetching it per row would be one round trip per report.
//
//  ── QCP GOVERNANCE CONTEXT (20260801410000) ────────────────────────────────
//  The queue also carries a per-report quality-control-plan rollup, appended for
//  the same reason and mapped here: "a mandatory document is still missing and
//  one hold point is open" is exactly the decision this screen exists to make.
//  Two disciplines apply and both live in reportQcp.ts, not in a component:
//    • hasQcp = false means the job is governed by NO plan — render nothing, not
//      an empty plan.
//    • the plan is matched through the shared scope-template spine because this
//      schema has no jobs.project_id, so an AMBIGUOUS match must be declined.
//      Use shouldRenderQcp(), never `if (row.qcpRollup)`.
//
//  The queue RPC also returns itp_rollup (20260801400000). It is not mapped here
//  yet — that gap belongs to the ITP lane, and inventing a shape for it in this
//  file would create a second definition of it.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseVisitRollup, type ReportVisitRollup } from './reportVisits';
import { parseQcpRollup, type ReportQcpRollup } from './reportQcp';

export type { ReportVisitRollup, ReportQcpRollup };

export interface ReportReviewRow {
  reportId: string;
  jobId: string;
  jobTitle: string | null;
  inspectorId: string;
  inspectorName: string | null;
  status: string | null;
  submittedAt: string | null;
  /** Admin quality gate. */
  technicalApproved: boolean;
  /** Admin cost-sanity gate. Authorises NO payment — settlement stays manual. */
  financialApproved: boolean;
  /** Owned by the CLIENT path (approve_inspection_report), shown here read-only. */
  isPublished: boolean;
  isClientApproved: boolean;
  pdfUrl: string | null;
  /**
   * The visit programme this report consolidates. NULL when the rollup could
   * not be shaped; fromFallback = true means the job is a classic single-date
   * job with no explicit visits, which must NOT be rendered as a programme.
   */
  visitRollup: ReportVisitRollup | null;
  /**
   * The quality control plan governing this report's job, with its effective
   * revision, derived progress, outstanding hold points, required-document
   * completion and open NCR summary. NULL when the rollup could not be shaped;
   * hasQcp = false means the job is governed by no plan the caller may read and
   * NOTHING should be rendered. Carries no pricing column and no name.
   */
  qcpRollup: ReportQcpRollup | null;
}

export async function fetchReportReviewQueue(
  limit = 50,
  onlyUnreviewed = true,
): Promise<ReportReviewRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_admin_report_review_queue', {
    p_limit: limit,
    p_only_unreviewed: onlyUnreviewed,
  });
  if (error) {
    // Surfacing an empty queue on error would look like "nothing to review",
    // which is exactly the wrong impression for a review surface.
    console.error('[reportReview] queue failed:', error.message);
    throw new Error(`Could not load the report review queue: ${error.message}`);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    reportId: String(r.report_id),
    jobId: String(r.job_id),
    jobTitle: (r.job_title as string | null) ?? null,
    inspectorId: String(r.inspector_id),
    inspectorName: (r.inspector_name as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    submittedAt: (r.submitted_at as string | null) ?? null,
    technicalApproved: Boolean(r.technical_approved),
    financialApproved: Boolean(r.financial_approved),
    isPublished: Boolean(r.is_published),
    isClientApproved: Boolean(r.is_client_approved),
    pdfUrl: (r.pdf_url as string | null) ?? null,
    visitRollup: parseVisitRollup(r.visit_rollup),
    qcpRollup: parseQcpRollup(r.qcp_rollup),
  }));
}
