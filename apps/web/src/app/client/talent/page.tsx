// ════════════════════════════════════════════════════════════════════════════
//  app/client/talent/page.tsx — the EMPLOYER's Talent surface
//
//  ── THE ONE RULE THIS SCREEN EXISTS TO HONOUR ──────────────────────────────
//  The employer reads submissions through talent_submission_employer_view and
//  NOTHING ELSE. That view NULLs candidate_name and candidate_email until a
//  live per-submission talent_disclosures row exists, and it is guarded on the
//  reader's organization_id. Querying talent_submissions directly here would
//  walk straight around the veil, so this file never touches that table.
//
//  Anti-circumvention is the commercial reason: an employer who learns a
//  candidate's name for free can hire them directly and pay no placement fee.
//  The veil is why the marketplace has revenue at all.
//
//  The employer also cannot submit candidates — nx_talent_submit_candidate
//  refuses an employer caller outright, because submissions are brokered by
//  NEXPEC. So this surface reads, shortlists and progresses; it does not source.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { EmployerTalentPanel } from './EmployerTalentPanel';

export const metadata: Metadata = { title: 'Talent · NEXPEC' };
export const dynamic = 'force-dynamic';

export interface EmployerOpportunity {
  id: string;
  title: string;
  status: string;
  region: string | null;
  comp_min_cents: number | null;
  comp_max_cents: number | null;
  created_at: string;
}

/** Exactly the shape talent_submission_employer_view exposes. */
export interface EmployerSubmission {
  submission_id: string;
  opportunity_id: string;
  status: string;
  match_score: number | null;
  created_at: string;
  headline: string | null;
  years_experience: number | null;
  region: string | null;
  identity_disclosed: boolean;
  candidate_name: string | null;
  candidate_email: string | null;
}

export interface EmployerInterview {
  id: string;
  submission_id: string;
  scheduled_at: string;
  mode: string;
  outcome: string | null;
}

export interface EmployerOffer {
  id: string;
  submission_id: string;
  comp_cents: number;
  status: string;
  start_date: string | null;
}

export default async function ClientTalentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">Talent</h1>
        <p role="alert" className="mt-4 text-sm text-zinc-400">
          Sign in to view your permanent-hire pipeline.
        </p>
      </main>
    );
  }

  // NOTE the source: the VIEW for submissions, never the base table.
  // comp columns are the employer's own figures; placement_fee_bps is
  // deliberately not selected — the platform's margin is not this surface's
  // business and the view does not carry it either.
  const [oppRes, subRes] = await Promise.all([
    supabase
      .from('talent_opportunities')
      .select('id, title, status, region, comp_min_cents, comp_max_cents, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('talent_submission_employer_view')
      .select(
        'submission_id, opportunity_id, status, match_score, created_at, headline, years_experience, region, identity_disclosed, candidate_name, candidate_email',
      )
      .order('created_at', { ascending: false })
      .limit(300),
  ]);

  if (oppRes.error || subRes.error) {
    const e = oppRes.error ?? subRes.error;
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">Talent</h1>
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200"
        >
          Could not load your pipeline. This is a read failure, not an empty
          pipeline — nothing has changed.
          <span className="mt-2 block text-xs opacity-70">{e?.message}</span>
        </div>
      </main>
    );
  }

  const subs = (subRes.data ?? []) as unknown as EmployerSubmission[];
  const ids = subs.map((s) => s.submission_id);

  const [ivRes, ofRes] = await Promise.all([
    ids.length
      ? supabase
          .from('talent_interviews')
          .select('id, submission_id, scheduled_at, mode, outcome')
          .in('submission_id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from('talent_offers')
          .select('id, submission_id, comp_cents, status, start_date')
          .in('submission_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  return (
    <EmployerTalentPanel
      opportunities={(oppRes.data ?? []) as unknown as EmployerOpportunity[]}
      submissions={subs}
      interviews={(ivRes.data ?? []) as unknown as EmployerInterview[]}
      offers={(ofRes.data ?? []) as unknown as EmployerOffer[]}
    />
  );
}
