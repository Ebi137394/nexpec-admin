// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/actions/inspectionDomains.ts
//
//  Server actions for the /admin/domains management surface. Both
//  actions are protected at THREE layers:
//
//    1. The page itself is mounted under /admin/* which the middleware
//       gates to super_admin only.
//    2. These actions explicitly re-check super_admin before issuing
//       any mutation (defense in depth).
//    3. The underlying inspection_domains_admin_write RLS policy
//       requires nx_is_admin() (defense in depth #2).
//
//  Even if every TS guard were bypassed, the database refuses the write.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function assertSuperAdmin(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: 'Not authenticated.' };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (profile?.role !== 'super_admin') {
    return { ok: false, error: 'Super admin only.' };
  }
  return { ok: true };
}

/** Toggle whether a domain is publicly visible / launched. */
export async function setInspectionDomainLaunched(
  slug: string,
  isLaunched: boolean,
): Promise<ActionResult> {
  const guard = await assertSuperAdmin();
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('inspection_domains')
    .update({ is_launched: isLaunched })
    .eq('slug', slug);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/domains');
  return { ok: true };
}

/** Admin kill-switch — flip a domain off entirely if needed. */
export async function setInspectionDomainActive(
  slug: string,
  isActive: boolean,
): Promise<ActionResult> {
  const guard = await assertSuperAdmin();
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('inspection_domains')
    .update({ is_active: isActive })
    .eq('slug', slug);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/domains');
  return { ok: true };
}
