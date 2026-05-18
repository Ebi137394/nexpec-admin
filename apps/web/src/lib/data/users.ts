// ════════════════════════════════════════════════════════════════════════════
//  lib/data/users.ts — platform-wide user reads for the admin console
//
//  Server-only module. Types + pure constants live in ./users.types.ts so
//  Client Components can import them without dragging next/headers into the
//  client bundle. Server-side callers can keep importing from here — the
//  types + KNOWN_ROLES are re-exported below.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  AdminUser,
  UsersPageResult,
  UsersQuery,
} from './users.types';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  KNOWN_ROLES,
} from './users.types';

export type { AdminUser, UsersPageResult, UsersQuery };
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, KNOWN_ROLES };

export async function fetchUsersPage(
  query: UsersQuery = {},
): Promise<UsersPageResult> {
  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from('profiles')
    .select(
      'id, full_name, email, role, avatar_url, created_at, updated_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.role) q = q.eq('role', query.role);
  if (query.search?.trim()) {
    const s = query.search.trim();
    // ilike on full_name OR email — wrap in `or` filter.
    q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%`);
  }

  const { data: rawProfiles, count, error } = await q;
  if (error || !rawProfiles) {
    if (error) console.warn('[users] page query failed:', error.message);
    return { users: [], total: 0, page, pageSize, totalPages: 1 };
  }

  // Hydrate CCI credential status in batch (defensive — fails to false).
  const credMap = new Map<string, { active: boolean; tier: string | null }>();
  const inspectorIds = rawProfiles
    .filter((p) => p.role === 'inspector' || p.role === 'contractor')
    .map((p) => p.id as string);

  if (inspectorIds.length > 0) {
    try {
      const { data: creds } = await supabase
        .from('inspector_credentials')
        .select('inspector_id, tier, status')
        .in('inspector_id', inspectorIds)
        .eq('status', 'approved');
      for (const c of creds ?? []) {
        credMap.set(c.inspector_id as string, {
          active: true,
          tier: (c.tier as string | null) ?? null,
        });
      }
    } catch {
      /* table may not exist on every deployment — fall through */
    }
  }

  const users: AdminUser[] = rawProfiles.map((p) => {
    const cred = credMap.get(p.id as string);
    return {
      id: p.id as string,
      full_name: (p.full_name as string | null) ?? null,
      email: (p.email as string | null) ?? null,
      role: (p.role as string | null) ?? null,
      avatar_url: (p.avatar_url as string | null) ?? null,
      created_at: (p.created_at as string | null) ?? null,
      updated_at: (p.updated_at as string | null) ?? null,
      cci_active: cred?.active ?? false,
      cci_tier: cred?.tier ?? null,
    };
  });

  const total = count ?? users.length;
  return {
    users,
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

// KNOWN_ROLES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE now live in ./users.types.ts
// and are re-exported above. Removing the duplicate declaration here.
