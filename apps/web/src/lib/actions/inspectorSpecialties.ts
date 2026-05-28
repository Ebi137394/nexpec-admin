// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/actions/inspectorSpecialties.ts
//
//  Server actions for the /admin/users/specialties-bulk admin tool.
//  Wraps the bulk_update_inspector_specialties Postgres RPC with the same
//  three-layer admin gate the rest of /admin actions use:
//
//    1. Server-action re-checks super_admin
//    2. RPC re-checks nx_is_admin (defense in depth)
//    3. profiles RLS write policy gates the underlying UPDATE
//
//  Single-slug-per-submit by design. A four-domain inspector-seeding
//  campaign is several batches of "filter by adjacent specialty → select
//  → add target slug → submit" — the UI rebuilds the filter and resubmits
//  for each pass. This is much simpler than a multi-slug picker and the
//  admin's mental model maps onto it directly.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface BulkAssignInput {
  /** UUIDs of inspector profiles to mutate. */
  inspectorIds: string[];
  /** A single kebab discipline slug. Validated server-side. */
  slug: string;
  /** Whether to add or remove the slug. */
  mode: 'add' | 'remove';
}

export interface BulkAssignResult {
  ok: boolean;
  /** Inspector rows whose specialty_slugs array was touched. */
  updated?: number;
  /** Human-readable error. Only present when ok=false. */
  error?: string;
}

// ─── Admin gate (server-action layer) ─────────────────────────────────
async function assertSuperAdmin(): Promise<{ ok: boolean; error?: string }> {
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

// ─── Server action ────────────────────────────────────────────────────
export async function bulkAssignSpecialties(
  input: BulkAssignInput,
): Promise<BulkAssignResult> {
  const guard = await assertSuperAdmin();
  if (!guard.ok) return guard;

  // ── Input validation (cheap and fast — reject before the RPC call) ──
  if (!Array.isArray(input?.inspectorIds) || input.inspectorIds.length === 0) {
    return { ok: false, error: 'No inspectors selected.' };
  }
  if (input.inspectorIds.length > 500) {
    return {
      ok: false,
      error: 'Batch size cap is 500 inspectors. Split the operation.',
    };
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of input.inspectorIds) {
    if (typeof id !== 'string' || !uuidRegex.test(id)) {
      return { ok: false, error: 'Invalid inspector id format.' };
    }
  }

  const slug = input?.slug?.trim();
  if (!slug || !/^[a-z][a-z0-9-]{0,79}$/.test(slug)) {
    return {
      ok: false,
      error:
        'Invalid slug format. Expected lowercase kebab-case (a-z, 0-9, hyphen), starting with a letter.',
    };
  }

  if (input.mode !== 'add' && input.mode !== 'remove') {
    return { ok: false, error: 'Mode must be "add" or "remove".' };
  }

  // ── RPC call ──────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    'bulk_update_inspector_specialties',
    {
      p_inspector_ids: input.inspectorIds,
      p_add_slugs: input.mode === 'add' ? [slug] : [],
      p_remove_slugs: input.mode === 'remove' ? [slug] : [],
    },
  );

  if (error) {
    console.error('[bulkAssignSpecialties] rpc error', error);
    return { ok: false, error: error.message };
  }

  // Revalidate the bulk page so the inspector list refreshes with the
  // new specialty state. Also revalidate the readiness pages so the
  // pool count + top-matches table reflect the change immediately.
  revalidatePath('/admin/users/specialties-bulk');
  revalidatePath('/admin/domains', 'layout');

  const result = (data ?? {}) as { updated?: number };
  return { ok: true, updated: result.updated ?? 0 };
}
