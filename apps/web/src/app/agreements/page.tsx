// /agreements — RETIRED. Consolidated into each portal's single "Contracts"
//   surface. This route now redirects the signed-in user to their role's
//   Contracts page so any stale link or bookmark lands correctly (no dead-end).
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ROLE_CONTRACTS: Record<string, string> = {
  supplier: '/suppliers/contracts',
  inspector: '/inspector/contracts',
  client: '/client/contracts',
  agency: '/client/contracts',
  enterprise: '/client/contracts',
  admin: '/admin/contracts',
  super_admin: '/admin/contracts',
};

export default async function AgreementsRedirect() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/client/contracts');
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (data?.role as string | undefined) ?? 'client';
  redirect(ROLE_CONTRACTS[role] ?? '/client/contracts');
}
