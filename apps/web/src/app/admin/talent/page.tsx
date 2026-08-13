// ════════════════════════════════════════════════════════════════════════════
//  app/admin/talent/page.tsx — NEXPEC Talent operations console
//
//  20260801476000 shipped the Talent spine as DATABASE ONLY: nx_talent_*
//  had zero callers anywhere outside the migration and its own tests, and no
//  route reached any of it. A migration is not a completed product phase until
//  its workflow is reachable, so this is that surface.
//
//  ── WHY ADMIN FIRST ────────────────────────────────────────────────────────
//  Talent is BROKERED. nx_talent_submit_candidate refuses an employer caller
//  outright — submissions are made by NEXPEC, not by the hiring org — so the
//  operator console is the workflow's actual entry point, not a convenience.
//
//  ── WHAT THIS SURFACE MUST NOT DO ──────────────────────────────────────────
//  It renders the ADMIN view, which legitimately sees both sides. It must
//  never become the employer's view: the employer reads
//  talent_submission_employer_view, where candidate identity is NULL until a
//  live per-submission disclosure exists. Nothing here is reused by an
//  employer surface, and the disclosure state is displayed so an operator can
//  SEE the veil rather than having to remember it.
//
//  No settlement happens here. fee_status is advanced through
//  nx_talent_admin_set_fee_status, which records an Admin decision — it moves
//  no money, consistent with 432000/444000/458000.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { TalentConsole } from './TalentConsole';

export const metadata: Metadata = { title: 'Talent · NEXPEC Admin' };
export const dynamic = 'force-dynamic';

export interface OpportunityRow {
  id: string;
  title: string;
  status: string;
  region: string | null;
  comp_min_cents: number | null;
  comp_max_cents: number | null;
  placement_fee_bps: number;
  organization_id: string;
  created_at: string;
}

export interface SubmissionRow {
  id: string;
  opportunity_id: string;
  profile_id: string;
  status: string;
  match_score: number | null;
  created_at: string;
}

export interface PlacementRow {
  id: string;
  submission_id: string;
  comp_cents: number;
  fee_bps: number;
  fee_cents: number;
  fee_status: string;
  placed_at: string;
}

export default async function AdminTalentPage() {
  const supabase = await createSupabaseServerClient();

  // Explicit column lists, never select('*') — the house rule since the
  // privacy work. Admin may see fee columns; an employer surface may not.
  const [opps, subs, placements, disclosures] = await Promise.all([
    supabase
      .from('talent_opportunities')
      .select(
        'id, title, status, region, comp_min_cents, comp_max_cents, placement_fee_bps, organization_id, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('talent_submissions')
      .select('id, opportunity_id, profile_id, status, match_score, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('talent_placements')
      .select('id, submission_id, comp_cents, fee_bps, fee_cents, fee_status, placed_at')
      .order('placed_at', { ascending: false })
      .limit(100),
    supabase
      .from('talent_disclosures')
      .select('submission_id, disclosed_at, revoked_at'),
  ]);

  // A failed read renders an explicit error, never an empty console that looks
  // like "no work to do" — that distinction matters for an operator queue.
  const failed =
    opps.error || subs.error || placements.error || disclosures.error;

  if (failed) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">Talent</h1>
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200"
        >
          Could not load the Talent console. This is a read failure, not an
          empty pipeline — nothing has been changed.
          <span className="mt-2 block text-xs opacity-70">
            {failed.message}
          </span>
        </div>
      </main>
    );
  }

  const liveDisclosures = new Set(
    (disclosures.data ?? [])
      .filter((d) => (d as { revoked_at: string | null }).revoked_at === null)
      .map((d) => (d as { submission_id: string }).submission_id),
  );

  return (
    <TalentConsole
      opportunities={(opps.data ?? []) as unknown as OpportunityRow[]}
      submissions={(subs.data ?? []) as unknown as SubmissionRow[]}
      placements={(placements.data ?? []) as unknown as PlacementRow[]}
      disclosedSubmissionIds={[...liveDisclosures]}
    />
  );
}
