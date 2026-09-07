// ════════════════════════════════════════════════════════════════════════════
//  /partner/opportunities — what a partner agency sees.
//
//  Access is a CAPABILITY (public.partner_agencies, status approved) plus a
//  per-job invitation, never profiles.role. That is why this route sits outside
//  the role-gated portal prefixes: an agency keeps its buyer portal and gains
//  this surface without any role change.
//
//  A partner sees its OWN commission and nothing else. The customer's price and
//  the inspector's payout are not merely hidden here — they are absent from
//  engagement_partner_view, so no template mistake can reveal them.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PartnerOpportunityList } from '@/components/partner/PartnerOpportunityList';

export const dynamic = 'force-dynamic';

export default async function PartnerOpportunitiesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent('/partner/opportunities')}`);

  const { data: standing } = await supabase
    .from('partner_agencies')
    .select('status, display_name')
    .eq('partner_id', user.id)
    .maybeSingle();

  if (!standing || standing.status !== 'approved') {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="font-display text-2xl font-semibold text-white">Partner opportunities</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Your account is not an approved NEXPEC partner agency
          {standing?.status ? ` (current standing: ${standing.status})` : ''}. Partner standing is
          granted by NEXPEC and is separate from your buyer account, which is unaffected.
        </p>
      </div>
    );
  }

  // RLS restricts these to this partner's own rows.
  const [{ data: opportunities }, { data: offers }, { data: nominations }, { data: obligations }] =
    await Promise.all([
      supabase
        .from('partner_opportunities')
        .select('id, job_id, status, invited_at')
        .order('invited_at', { ascending: false }),
      supabase.from('engagement_partner_view').select('*'),
      supabase.from('partner_nominations').select('id, job_id, inspector_id, status'),
      supabase.from('settlement_obligations').select('*').eq('beneficiary_role', 'partner'),
    ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Partner opportunities</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {standing.display_name ?? 'Approved partner agency'}. You see only engagements NEXPEC has
          invited you to, and only your own commission.
        </p>
      </div>
      <PartnerOpportunityList
        opportunities={(opportunities ?? []) as never}
        offers={(offers ?? []) as never}
        nominations={(nominations ?? []) as never}
        obligations={(obligations ?? []) as never}
      />
    </div>
  );
}
