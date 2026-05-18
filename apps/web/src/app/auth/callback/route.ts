// ════════════════════════════════════════════════════════════════════════════
//  app/auth/callback/route.ts — OAuth + email-confirm landing
//
//  Supabase redirects back here after Google / Apple / email-link auth.
//  We exchange the `code` for a session, set cookies, then bounce the user
//  to a role-aware destination.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (!code) {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('error', 'Missing OAuth code.');
    return NextResponse.redirect(url);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('error', error.message);
    return NextResponse.redirect(url);
  }

  // Resolve role to decide destination.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let dest = '/';
  if (next && next.startsWith('/')) {
    dest = next;
  } else if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    dest = profile?.role === 'super_admin' ? '/admin/dashboard' : '/';
  }

  return NextResponse.redirect(new URL(dest, origin));
}
