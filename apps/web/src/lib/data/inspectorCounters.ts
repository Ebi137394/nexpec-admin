// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorCounters.ts — fetch outstanding counter-offers
//  for the currently-signed-in inspector.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface CounterOffer {
  id: string;
  jobId: string;
  jobTitle: string | null;
  originalBidCents: number | null;
  adminCounterCents: number | null;
  adminComment: string | null;
  adminCounteredAt: string | null;
  negotiationStatus: string | null;
  inspectorDecision: string | null;
}

export async function fetchMyCounterOffers(): Promise<CounterOffer[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('applications')
      .select(
        'id, job_id, bid_amount_cents, admin_counter_cents, admin_comment, admin_countered_at, negotiation_status, inspector_decision',
      )
      .eq('applicant_id', user.id)
      .in('negotiation_status', ['admin_countered', 'counter_accepted', 'counter_rejected'])
      .order('admin_countered_at', { ascending: false })
      .limit(50);

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchMyCounterOffers] failed:', error.message);
      }
      return [];
    }

    const rows = data as Array<Record<string, unknown>>;

    // Hydrate job titles
    const jobIds = Array.from(
      new Set(rows.map((r) => String(r.job_id)).filter(Boolean)),
    );
    const titleMap = new Map<string, string | null>();
    if (jobIds.length > 0) {
      try {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, title')
          .in('id', jobIds);
        for (const j of (jobs ?? []) as Array<Record<string, unknown>>) {
          titleMap.set(String(j.id), (j.title as string | null) ?? null);
        }
      } catch {
        /* ignore */
      }
    }

    return rows.map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      jobTitle: titleMap.get(String(r.job_id)) ?? null,
      originalBidCents: (r.bid_amount_cents as number | null) ?? null,
      adminCounterCents: (r.admin_counter_cents as number | null) ?? null,
      adminComment: (r.admin_comment as string | null) ?? null,
      adminCounteredAt: (r.admin_countered_at as string | null) ?? null,
      negotiationStatus: (r.negotiation_status as string | null) ?? null,
      inspectorDecision: (r.inspector_decision as string | null) ?? null,
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMyCounterOffers] threw:', e);
    }
    return [];
  }
}
