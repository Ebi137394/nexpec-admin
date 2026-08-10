'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/reportReview.ts — record an admin review on an inspection report
//
//  Thin wrapper over nx_admin_review_inspection_report (20260801364000), which
//  is admin-gated in its own body. No authorization here, deliberately.
//
//  ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
//  It does not publish the report and it does not release money.
//    • Publishing belongs to the CLIENT (approve_inspection_report). Admin
//      review is recorded ALONGSIDE that decision, never in place of it.
//    • 'financial' review is a cost-sanity check. It authorises no settlement,
//      writes no transaction, and does not set admin_confirmed_at (the column
//      that actually fires the payout trigger). Payouts stay manual and
//      admin-initiated. A migration self-test fails the deploy if the RPC ever
//      references a money surface.
// ════════════════════════════════════════════════════════════════════════════
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ReviewKind = 'technical' | 'financial';
export type ReviewResult = { ok: true } | { ok: false; error: string };

export async function reviewInspectionReport(
  reportId: string,
  kind: ReviewKind,
  approved: boolean,
  note?: string,
): Promise<ReviewResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('nx_admin_review_inspection_report', {
      p_report_id: reportId,
      p_kind: kind,
      p_approved: approved,
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  // revalidate AFTER the try/catch: it must not be swallowed, and a redirect or
  // revalidation signal thrown inside a try block is the exact bug that made
  // admin approval fail with NEXT_REDIRECT earlier in this project.
  revalidatePath('/admin/reports');
  return { ok: true };
}
