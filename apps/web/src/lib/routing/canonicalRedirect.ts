// ════════════════════════════════════════════════════════════════════════════
//  canonicalRedirect — shared body for every /<family> and /<family>/[id]
//  redirect route.
//
//  Each canonical route is a three-line file that calls one of these. Repeating
//  the session lookup and the role table in ten page files is exactly the
//  duplication that produced the two link incidents this change exists to fix.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { baseFor, itemPathFor, type RouteFamily } from './roleRoutes';

async function resolveRole(selfPath: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Preserve intent through sign-in, but only ever as a relative path.
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(selfPath)}`);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return (profile as { role?: string } | null)?.role ?? null;
}

/** /<family> — send the signed-in user to their role's version of this page. */
export async function redirectToFamily(family: RouteFamily, selfPath: string): Promise<never> {
  redirect(baseFor(family, await resolveRole(selfPath)));
}

/** /<family>/[id] — same, preserving the record id only where that role
 *  actually has a detail route (see roleRoutes). Blindly appending the id would
 *  turn one broken link into a different broken link.
 *
 *  `id` is our own URL segment rather than a caller-supplied `next`, so it
 *  cannot introduce another origin; itemPathFor percent-encodes it regardless. */
export async function redirectToFamilyItem(
  family: RouteFamily,
  id: string,
  selfPath: string,
): Promise<never> {
  redirect(itemPathFor(family, await resolveRole(selfPath), id));
}
