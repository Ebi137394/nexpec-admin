// Compatibility shim for certification-expiry notifications.
//
// nx_certification_expiry_scan emits '/profile/certifications'. That is a real
// MOBILE route (app/profile/certifications.tsx) but has never existed on web,
// so an inspector who opened an expiry alert in a browser got a 404 — on a
// credential-compliance alert, which is exactly when they need to act.
//
// Notification links are a single string consumed by both clients, so the fix
// is to make the path resolve on web too rather than to fork the link.
// Inspector credentials live on the inspector settings page; anyone else is
// sent through the canonical /profile role resolver.
//
// No user input is forwarded, so this cannot become an open redirect.
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LegacyCertificationsRedirect() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/profile/certifications'));

  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = (data?.role ?? '').trim().toLowerCase();
  if (role === 'inspector' || role === 'senior' || role === 'contractor') {
    redirect('/inspector/settings');
  }
  redirect('/profile');
}
