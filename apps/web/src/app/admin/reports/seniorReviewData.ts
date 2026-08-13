// ════════════════════════════════════════════════════════════════════════════
//  app/admin/reports/seniorReviewData.ts — server-side inputs for the Senior
//  Inspector review panel
//
//  ── THIS IS NOT A SECOND DATA-ACCESS LAYER FOR REVIEW STATE ────────────────
//  Review rounds and all three review writes come exclusively from the frozen
//  contract in @nexpec/shared-core/net/fundingReview — fetchReviewRounds,
//  assignSeniorReviewer, deliverReportToClient — and they are called from the
//  browser island (SeniorReviewPanel.tsx), not from here.
//
//  WHY THE BROWSER AND NOT THE SERVER. Those functions resolve their Supabase
//  client through shared-core's `createCore()`, which stores it in a MODULE
//  GLOBAL. In a Next.js server process that global is shared by every in-flight
//  request, so binding it to a per-request cookie-scoped client would let two
//  concurrent admins swap auth context across an await. In a browser tab the
//  global is exactly what it was designed to be: one shell, one session, bound
//  once. So the island binds it once and calls the contract directly; RLS on
//  report_senior_reviews already admits the admin (20260801450000 §7) and the
//  three RPCs are EXECUTE-granted to `authenticated` and re-check admin inside.
//
//  This file therefore fetches only the two things the contract does not carry.
//
//  ── 1. THE REVIEWER ROSTER ─────────────────────────────────────────────────
//  profiles.role = 'senior' is the platform's Senior Inspector authorisation
//  (profiles_role_allowed, baseline:17553). Suspended accounts are excluded.
//  canAssignReviewer() then removes the report's own author in the island,
//  mirroring trg_report_senior_reviews_no_self.
//
//  ── 2. THE REMAINING-FUNDING GATE, AS A BOOLEAN ────────────────────────────
//  canDeliverToClient() needs `deliveryFundingSatisfied`. The funding readers
//  that could derive it (fetchAdminFunding / fetchInspectorFunding) take the
//  client price and the inspector payout as inputs — the two figures that must
//  never meet on one surface. nx_funding_delivery_satisfied(job_id) is the SAME
//  gate nx_admin_deliver_report consults (20260801450000:344), returns a bare
//  boolean, and carries no amount. The UI therefore blocks for exactly the
//  reason the server would, and no money reaches this screen at all.
//
//  Nothing here writes anything. There is no funding write on this route.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  DeliveryFundingByJob,
  SeniorReviewerOption,
} from './seniorReviewTypes';

export type { DeliveryFundingByJob, SeniorReviewerOption };

/** Best-effort human label. Never invents a name it does not have. */
function displayName(
  id: string,
  fullName: string | null,
  email: string | null,
): string {
  const trimmed = fullName?.trim();
  if (trimmed) return trimmed;
  const local = email?.split('@')[0]?.trim();
  if (local) return local;
  return `Senior inspector ${id.slice(0, 8)}`;
}

/**
 * The Senior Inspectors an Admin may assign. Returns [] rather than throwing:
 * an unreadable roster must degrade to "no reviewers available", not blank the
 * whole review queue, which is the page's primary job.
 */
export async function fetchSeniorReviewerRoster(
  limit = 200,
): Promise<SeniorReviewerOption[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'senior')
    .is('suspended_at', null)
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error('[seniorReviewData] reviewer roster failed:', error.message);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const id = String(r.id);
    return {
      id,
      name: displayName(
        id,
        (r.full_name as string | null) ?? null,
        (r.email as string | null) ?? null,
      ),
    };
  });
}

/**
 * The remaining-funding gate for each job, deduplicated. A failed check maps to
 * `null` — "unknown", rendered as such and still blocking — never to `true`.
 */
export async function fetchDeliveryFundingByJob(
  jobIds: readonly string[],
): Promise<DeliveryFundingByJob> {
  const unique = Array.from(new Set(jobIds.filter((id) => id.length > 0)));
  if (unique.length === 0) return {};

  const supabase = await createSupabaseServerClient();

  const entries = await Promise.all(
    unique.map(async (jobId): Promise<[string, boolean | null]> => {
      try {
        const { data, error } = await supabase.rpc(
          'nx_funding_delivery_satisfied',
          { p_job_id: jobId },
        );
        if (error) {
          console.error(
            `[seniorReviewData] funding gate unreadable for job ${jobId}:`,
            error.message,
          );
          return [jobId, null];
        }
        return [jobId, data === true];
      } catch (e) {
        console.error(
          `[seniorReviewData] funding gate threw for job ${jobId}:`,
          e instanceof Error ? e.message : e,
        );
        return [jobId, null];
      }
    }),
  );

  return Object.fromEntries(entries);
}
