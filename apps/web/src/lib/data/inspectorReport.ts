// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorReport.ts — fetch the inspector's existing report
//
//  Returns the report row this inspector has already submitted for the
//  given job, if any. Used by:
//    1. The submit-report page to detect "already submitted" → redirect.
//    2. The inspector job detail page (future Sprint 6.5) to render a
//       "view your report" panel with admin review state.
//
//  GOLDEN_RULE_6 — inspector reads their OWN report row only.
//  WHERE inspector_id = auth.uid() AND job_id = jobId.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  FinalReportDoc,
  InspectionReportStatus,
  InspectorReport,
} from './inspectorReport.types';

export type { InspectorReport, FinalReportDoc };

export async function fetchInspectorReport(
  jobId: string,
): Promise<InspectorReport | null> {
  if (!jobId) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('inspection_reports')
      .select(
        [
          'id',
          'job_id',
          'inspector_id',
          'status',
          'photo_url',
          'notes',
          'final_report_doc',
          'technical_approved',
          'technical_approved_at',
          'financial_approved',
          'financial_approved_at',
          'is_published',
          'is_client_approved',
          'created_at',
          'updated_at',
        ].join(', '),
      )
      .eq('job_id', jobId)
      .eq('inspector_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchInspectorReport] failed:', error.message);
      }
      return null;
    }

    const r = data as unknown as Record<string, unknown>;

    // final_report_doc is text — parse to FinalReportDoc if it's valid JSON.
    // Legacy text rows just surface as `null` and the page falls back to
    // showing `notes` as the plain-text body.
    let parsedDoc: FinalReportDoc | null = null;
    if (typeof r.final_report_doc === 'string' && r.final_report_doc.length > 0) {
      try {
        const candidate = JSON.parse(r.final_report_doc);
        if (candidate && typeof candidate === 'object' && 'version' in candidate) {
          parsedDoc = candidate as FinalReportDoc;
        }
      } catch {
        parsedDoc = null;
      }
    }

    return {
      id: String(r.id),
      jobId: String(r.job_id),
      inspectorId: String(r.inspector_id),
      status: (r.status as InspectionReportStatus) ?? 'pending',
      photoUrl: (r.photo_url as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      finalReportDoc: parsedDoc,
      technicalApproved: Boolean(r.technical_approved),
      technicalApprovedAt: (r.technical_approved_at as string | null) ?? null,
      financialApproved: Boolean(r.financial_approved),
      financialApprovedAt: (r.financial_approved_at as string | null) ?? null,
      isPublished: Boolean(r.is_published),
      isClientApproved: Boolean(r.is_client_approved),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorReport] threw:', e);
    }
    return null;
  }
}
