// /agreements/[id]/sign — RETIRED. The brokered Review & Sign now lives inside
//   each portal's Contracts surface (full sidebar + back + breadcrumb). This
//   route redirects by the agreement's kind so any stale link lands on the
//   correct portal-hosted sign page — never a chrome-less dead-end.
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AgreementSignRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const { data } = await supabase
    .from('agreements')
    .select('kind, deal_id')
    .eq('id', id)
    .maybeSingle();
  const kind = data?.kind as string | undefined;
  if (kind === 'supplier_supply') redirect(`/suppliers/contracts/agreement/${id}`);
  if (kind === 'inspector_engagement') redirect(`/inspector/contracts/agreement/${id}`);
  if (kind === 'client_supply' && data?.deal_id) redirect(`/deals/${data.deal_id}/sign`);
  redirect('/client/contracts');
}
