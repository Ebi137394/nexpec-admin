// ════════════════════════════════════════════════════════════════════════════
//  /profile — the ONE stable place to send a user to their own profile.
//
//  WHY THIS EXISTS. Onboarding emails and notifications pointed at
//  /client/profile and /inspector/profile. Neither route has ever existed in
//  this web app — the real destinations are /client/settings and
//  /inspector/settings — so every one of those links returned 404 in
//  Production. Hard-coding another role path would just move the same trap.
//
//  So the role is resolved SERVER-SIDE from the authenticated session at click
//  time, never from the link. A link written today keeps working after a role
//  is changed, and after a role-specific route is renamed.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Role → the route that actually exists today. Verified against src/app. */
function profilePathForRole(role: string | null | undefined): string {
  const r = (role ?? '').trim().toLowerCase();
  if (r === 'inspector' || r === 'senior') return '/inspector/settings';
  if (r === 'supplier') return '/suppliers/profile';
  if (r === 'admin' || r === 'super_admin') return '/admin/dashboard';
  return '/client/settings'; // client, agency, enterprise
}

export default async function ProfileRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Preserve intent through sign-in, but only as a RELATIVE path.
    redirect(`/sign-in?next=${encodeURIComponent('/profile')}`);
  }

  // A caller-supplied `next` must stay on this origin. `startsWith('/')` alone
  // is not enough: '//evil.example.com' also starts with a slash and resolves
  // to another host — the same protocol-relative hole already closed in
  // /auth/callback.
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    redirect(next);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  redirect(profilePathForRole((profile as { role?: string } | null)?.role));
}
