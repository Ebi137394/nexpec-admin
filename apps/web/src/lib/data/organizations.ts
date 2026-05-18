// ════════════════════════════════════════════════════════════════════════════
//  lib/data/organizations.ts — orgs + member counts for /admin/orgs
//
//  Server-only module. Types live in ./organizations.types.ts so Client
//  Components can import the types without dragging next/headers into the
//  client bundle. Re-exports the types here for server-side caller
//  convenience.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AdminOrg, OrgsResult } from './organizations.types';

export type { AdminOrg, OrgsResult };

/**
 * Read every organization. Defensive against the table not existing yet
 * (returns `tableMissing: true` so the page can render the right empty
 * state explaining the migration needs to run).
 */
export async function fetchOrganizations(): Promise<OrgsResult> {
  const supabase = await createSupabaseServerClient();

  const { data: rawOrgs, error } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, kind, owner_id, logo_url, website_url, contact_email, is_active, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    // Supabase returns a specific code when the table is missing.
    const tableMissing = /relation .* does not exist/i.test(error.message ?? '');
    if (!tableMissing) {
      console.warn('[organizations] query failed:', error.message);
    }
    return { orgs: [], total: 0, tableMissing };
  }
  if (!rawOrgs || rawOrgs.length === 0) {
    return { orgs: [], total: 0, tableMissing: false };
  }

  // Hydrate owners + member counts in batch.
  const ownerIds = rawOrgs.map((o) => o.owner_id).filter(Boolean) as string[];
  const ownerMap = new Map<string, { name: string | null; email: string | null }>();
  if (ownerIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ownerIds);
    for (const p of profs ?? []) {
      ownerMap.set(p.id as string, {
        name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  const countMap = new Map<string, number>();
  try {
    // One range query per org would be slow; fetch member rows and bin them.
    const orgIds = rawOrgs.map((o) => o.id as string);
    const { data: members } = await supabase
      .from('org_members')
      .select('org_id')
      .in('org_id', orgIds);
    for (const m of members ?? []) {
      const k = m.org_id as string;
      countMap.set(k, (countMap.get(k) ?? 0) + 1);
    }
  } catch {
    /* org_members may not exist yet */
  }

  const orgs: AdminOrg[] = rawOrgs.map((o) => {
    const owner = o.owner_id ? ownerMap.get(o.owner_id as string) ?? null : null;
    return {
      id: o.id as string,
      name: (o.name as string) ?? '—',
      slug: (o.slug as string | null) ?? null,
      kind: (o.kind as string) ?? 'enterprise',
      owner_id: (o.owner_id as string | null) ?? null,
      owner_name: owner?.name ?? null,
      owner_email: owner?.email ?? null,
      logo_url: (o.logo_url as string | null) ?? null,
      website_url: (o.website_url as string | null) ?? null,
      contact_email: (o.contact_email as string | null) ?? null,
      is_active: (o.is_active as boolean | null) ?? true,
      created_at: (o.created_at as string | null) ?? null,
      member_count: countMap.get(o.id as string) ?? 0,
    };
  });

  return { orgs, total: orgs.length, tableMissing: false };
}
