// ════════════════════════════════════════════════════════════════════════════
//  app/client/finance/fundingRailData.ts
//
//  Server read for the finance page's funding rail. This is NOT a new data
//  layer: it introduces no domain type and reads no funding row. It resolves
//  only the job scalars that fetchClientFunding() and the two gate predicates
//  take as INPUTS — the schedule itself is read exclusively through the
//  audience-scoped accessor, from the client island.
//
//  ── GOLDEN_RULE_2 ──────────────────────────────────────────────────────────
//  Explicit column list, never select('*'), and every column is the buyer's own
//  commercial fact. No inspector payout, no platform spread. jobs_secure_view
//  additionally NULLs seller-payout columns for non-admins (20260801318000).
//
//  ── SCOPE ──────────────────────────────────────────────────────────────────
//  client_id only. The funding RLS policy (20260801448000 §7) matches
//  j.client_id = auth.uid(), so an agency-billed job could not have its stages
//  read from this session; including it would render a funding position we
//  cannot see. Cancelled and disputed jobs are excluded — funding a tranche on
//  them is not an action we want to invite from a dashboard.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { FundingJobFacts } from '../jobs/[id]/funding/fundingView';

/** Bounded on purpose: the rail fans out one funding read per job. */
export const FUNDING_RAIL_LIMIT = 12;

const RAIL_STATUSES = [
  'pending_approval',
  'approved',
  'open',
  'assigned',
  'in_progress',
  'completed',
];

function parseCents(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function fetchFundingRailJobs(): Promise<FundingJobFacts[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('jobs_secure_view')
      .select(
        [
          'id',
          'title',
          'status',
          'client_price_cents',
          'client_settled_at',
          'admin_confirmed_at',
          'payment_mode',
          'updated_at',
        ].join(', '),
      )
      .eq('client_id', user.id)
      .in('status', RAIL_STATUSES)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(FUNDING_RAIL_LIMIT);

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fundingRail] job lookup failed:', error.message);
      }
      return [];
    }

    return data
      .map((row): FundingJobFacts => {
        const j = row as unknown as Record<string, unknown>;
        return {
          jobId: String(j.id),
          title: String(j.title ?? '(untitled job)'),
          status: String(j.status ?? ''),
          clientPriceCents: parseCents(j.client_price_cents),
          legacyClientSettledAt:
            typeof j.client_settled_at === 'string'
              ? j.client_settled_at
              : null,
          adminConfirmedAt:
            typeof j.admin_confirmed_at === 'string'
              ? j.admin_confirmed_at
              : null,
          paymentMode: String(j.payment_mode ?? 'prepay'),
          // Scoped to client_id above, so the schedule is readable by
          // construction for every row this returns.
          scheduleReadable: true,
        };
      })
      // net_terms jobs draw on a credit line; they have no prepaid tranches to
      // chase, and the credit panel above already speaks to them.
      .filter((j) => j.paymentMode !== 'net_terms' && j.clientPriceCents > 0);
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[fundingRail] unexpected failure:', err);
    }
    return [];
  }
}
