// ════════════════════════════════════════════════════════════════════════════
//  /engagements — where a customer or inspector reviews and accepts THEIR OWN
//  terms.
//
//  The page queries engagement_customer_view and engagement_inspector_view.
//  Each contains exactly one money column, so a customer physically cannot
//  receive the inspector's payout here and vice versa — not by UI omission,
//  but because the column is not in the result set.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { EngagementAcceptance } from '@/components/engagements/EngagementAcceptance';

export const dynamic = 'force-dynamic';

export default async function EngagementsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent('/engagements')}`);

  const [{ data: asCustomer }, { data: asInspector }, { data: obligations }] = await Promise.all([
    supabase.from('engagement_customer_view').select('*'),
    supabase.from('engagement_inspector_view').select('*'),
    supabase.from('settlement_obligations').select('*').eq('beneficiary_role', 'inspector'),
  ]);

  const customerRows = (asCustomer ?? []) as Record<string, unknown>[];
  const inspectorRows = (asInspector ?? []) as Record<string, unknown>[];

  if (customerRows.length === 0 && inspectorRows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="font-display text-2xl font-semibold text-white">Engagements</h1>
        <p className="mt-3 text-sm text-zinc-400">
          You have no commercial terms awaiting review.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <h1 className="font-display text-2xl font-semibold text-white">Engagements</h1>
      <EngagementAcceptance
        customerRows={customerRows as never}
        inspectorRows={inspectorRows as never}
        obligations={(obligations ?? []) as never}
      />
    </div>
  );
}
