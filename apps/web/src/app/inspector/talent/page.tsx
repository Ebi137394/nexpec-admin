// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/talent/page.tsx — the CANDIDATE's Talent surface
//
//  A candidate IS a profile (20260801476000) — there is no separate candidate
//  account — so this lives in the inspector portal rather than a new one.
//
//  Reads are scoped by RLS to the caller's own rows: talent_candidate_profiles
//  and talent_consents carry `profile_id = auth.uid()` policies, and
//  talent_submissions carries talent_submissions_candidate. A forged id
//  returns nothing rather than someone else's data.
//
//  This surface exists because nx_talent_disclose_identity and
//  nx_talent_revoke_disclosure are gated on auth.uid() = the submission's
//  profile_id — the candidate and nobody else — and had no caller at all.
//  Consent that cannot be given or withdrawn is not consent.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CandidateTalentPanel } from './CandidateTalentPanel';

export const metadata: Metadata = { title: 'Permanent roles · NEXPEC' };
export const dynamic = 'force-dynamic';

export interface CandidateProfile {
  is_open_to_work: boolean;
  headline: string | null;
  years_experience: number | null;
  region: string | null;
  desired_min_cents: number | null;
  desired_max_cents: number | null;
  notice_period_days: number | null;
}

export interface CandidateSubmission {
  id: string;
  status: string;
  match_score: number | null;
  created_at: string;
  opportunity_title: string | null;
  disclosed: boolean;
}

export default async function InspectorTalentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;

  if (!uid) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">Permanent roles</h1>
        <p role="alert" className="mt-4 text-sm text-zinc-400">
          Sign in to manage your permanent-role preferences.
        </p>
      </main>
    );
  }

  const [profileRes, consentRes, subsRes] = await Promise.all([
    supabase
      .from('talent_candidate_profiles')
      .select(
        'is_open_to_work, headline, years_experience, region, desired_min_cents, desired_max_cents, notice_period_days',
      )
      .eq('profile_id', uid)
      .maybeSingle(),
    supabase
      .from('talent_consents')
      .select('scope, revoked_at')
      .eq('profile_id', uid)
      .is('revoked_at', null),
    supabase
      .from('talent_submissions')
      .select('id, status, match_score, created_at, opportunity_id')
      .eq('profile_id', uid)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const readFailed = profileRes.error || consentRes.error || subsRes.error;
  if (readFailed) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-white">Permanent roles</h1>
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200"
        >
          Could not load your Talent preferences. Nothing has been changed.
          <span className="mt-2 block text-xs opacity-70">
            {readFailed.message}
          </span>
        </div>
      </main>
    );
  }

  const subs = (subsRes.data ?? []) as Array<{
    id: string;
    status: string;
    match_score: number | null;
    created_at: string;
    opportunity_id: string;
  }>;

  // Titles and live disclosures, fetched only for the caller's own submissions.
  const oppIds = [...new Set(subs.map((s) => s.opportunity_id))];
  const [titlesRes, discRes] = await Promise.all([
    oppIds.length
      ? supabase.from('talent_opportunities').select('id, title').in('id', oppIds)
      : Promise.resolve({ data: [], error: null }),
    subs.length
      ? supabase
          .from('talent_disclosures')
          .select('submission_id, revoked_at')
          .in(
            'submission_id',
            subs.map((s) => s.id),
          )
      : Promise.resolve({ data: [], error: null }),
  ]);

  const titleById = new Map(
    ((titlesRes.data ?? []) as Array<{ id: string; title: string }>).map((o) => [
      o.id,
      o.title,
    ]),
  );
  const live = new Set(
    ((discRes.data ?? []) as Array<{ submission_id: string; revoked_at: string | null }>)
      .filter((d) => d.revoked_at === null)
      .map((d) => d.submission_id),
  );

  const consents = new Set(
    ((consentRes.data ?? []) as Array<{ scope: string }>).map((c) => c.scope),
  );

  return (
    <CandidateTalentPanel
      profile={(profileRes.data ?? null) as CandidateProfile | null}
      discoverable={consents.has('discoverable')}
      submissionConsent={consents.has('submission')}
      submissions={subs.map((s) => ({
        id: s.id,
        status: s.status,
        match_score: s.match_score,
        created_at: s.created_at,
        opportunity_title: titleById.get(s.opportunity_id) ?? null,
        disclosed: live.has(s.id),
      }))}
    />
  );
}
