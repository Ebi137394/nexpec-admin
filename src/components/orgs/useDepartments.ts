// ════════════════════════════════════════════════════════════════════════════
//  src/components/orgs/useDepartments.ts
//
//  Mobile hook — fetches the active org's department tree via the
//  existing `fetch_department_tree` RPC. Pairs with DepartmentPickerSheet
//  so mobile forms (post-new-job, invoice reassign) consume the same
//  authoritative dept list the web does.
//
//  Strict cross-platform: the RPC, the auth model, the response shape
//  are all identical to what the web reads. No mobile-specific drift.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** One row from fetch_department_tree — depth-annotated for indented display. */
export interface MobileDepartment {
  id: string;
  org_id: string;
  parent_department_id: string | null;
  name: string;
  cost_center: string | null;
  depth: number;
  member_count: number;
}

export interface UseDepartmentsApi {
  loading: boolean;
  error: string | null;
  departments: MobileDepartment[];
  refresh: () => Promise<void>;
}

/**
 * Read the department tree for an org. Returns the flat depth-annotated
 * list (the RPC already orders by depth + name). Pass the active org id
 * — usually resolved via useOrgMemberships hook's active membership.
 */
export function useDepartments(orgId: string | null): UseDepartmentsApi {
  const [departments, setDepartments] = useState<MobileDepartment[]>([]);
  const [loading, setLoading] = useState<boolean>(!!orgId);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!orgId) {
      setDepartments([]);
      return;
    }
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      'fetch_department_tree',
      { p_org_id: orgId },
    );
    if (rpcError) {
      setDepartments([]);
      setError(rpcError.message);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as Array<
      Record<string, unknown>
    >;
    setDepartments(
      rows.map((r) => ({
        id: String(r.id),
        org_id: String(r.org_id),
        parent_department_id:
          (r.parent_department_id as string | null) ?? null,
        name: String(r.name ?? ''),
        cost_center: (r.cost_center as string | null) ?? null,
        depth: Number(r.depth ?? 0),
        member_count: Number(r.member_count ?? 0),
      })),
    );
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchOnce();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOnce]);

  return { loading, error, departments, refresh: fetchOnce };
}
