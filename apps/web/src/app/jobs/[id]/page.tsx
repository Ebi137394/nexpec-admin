// ════════════════════════════════════════════════════════════════════════════
//  app/jobs/[id]/page.tsx — role-aware job resolver
//
//  The web has no shared /jobs/[id] surface — job detail is role-scoped
//  (/admin, /client, /inspector). Notifications, the mobile app and copied links
//  may still point at the canonical /jobs/[id]; without this they 404. This stub
//  forwards each viewer to their own job detail (RLS still enforces access).
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function JobResolverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/jobs/${id}`));

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (profile?.role ?? '').toString().trim().toLowerCase();

  if (role === 'admin' || role === 'super_admin') redirect(`/admin/jobs/${id}`);
  if (role === 'inspector') redirect(`/inspector/jobs/${id}`);
  if (role === 'client' || role === 'agency' || role === 'enterprise') {
    redirect(`/client/jobs/${id}`);
  }
  // Suppliers don't own the inspection job (it's admin-brokered between the
  // assigned inspector and the buyer) — send them to where they track outcomes.
  if (role === 'supplier') redirect('/suppliers/bids');

  redirect('/');
}
