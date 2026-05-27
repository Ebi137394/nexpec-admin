// ════════════════════════════════════════════════════════════════════════════
//  src/components/orgs/useOrgMemberships.ts
//
//  Mobile hook that powers the workspace switcher. Consumes the exact
//  same RPCs that the web app uses:
//
//    public.fetch_my_org_memberships()   — returns rich rows for the list
//    public.set_active_org(p_org_id)     — pins the new active org
//
//  Cross-platform schemas live in @nexpec/shared-core. Both web and mobile
//  validate against `orgMembershipEntrySchema` / `setActiveOrgInput`, so
//  there's no risk of the two surfaces drifting on shape.
//
//  Strict UI rules: this hook is presentation-agnostic. It does not touch
//  colors, layout, or component structure — those decisions live in the
//  consuming UI (OrgSwitcherSheet + OrgSwitcherTrigger).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  orgMembershipEntrySchema,
  setActiveOrgInput,
  type OrgMembershipEntry,
} from '@nexpec/shared-core';
import { supabase } from '@/lib/supabase';

/** Aggregate state surfaced to the UI. */
export interface UseOrgMembershipsState {
  /** Whether the initial fetch is still in flight. */
  loading: boolean;
  /** Most recent error from a fetch or switch — string for easy display. */
  error: string | null;
  /** Every org the caller belongs to, active one first. */
  memberships: OrgMembershipEntry[];
  /** The currently-active membership, or null when the user has none. */
  active: OrgMembershipEntry | null;
  /** True while a `setActiveOrg` round-trip is in flight. */
  switching: boolean;
  /** The org id we're optimistically switching to (for per-row spinners). */
  pendingOrgId: string | null;
}

export interface UseOrgMembershipsApi extends UseOrgMembershipsState {
  /** Pin a new active org. Optimistically updates state, then re-fetches. */
  setActiveOrg: (orgId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Force a re-fetch of the memberships list. */
  refresh: () => Promise<void>;
}

const listSchema = z.array(orgMembershipEntrySchema);

export function useOrgMemberships(): UseOrgMembershipsApi {
  const [memberships, setMemberships] = useState<OrgMembershipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      'fetch_my_org_memberships',
    );
    if (rpcError) {
      setMemberships([]);
      setError(rpcError.message);
      return;
    }
    const parsed = listSchema.safeParse(data ?? []);
    if (!parsed.success) {
      // The RPC payload is trusted but we still validate — if shapes ever
      // drift we'd rather see an explicit zod error than render garbage.
      setMemberships([]);
      setError('Could not parse workspace list.');
      return;
    }
    setMemberships(parsed.data);
  }, []);

  // Initial load.
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

  const active = useMemo(
    () => memberships.find((m) => m.is_active_org) ?? memberships[0] ?? null,
    [memberships],
  );

  const setActiveOrg = useCallback<UseOrgMembershipsApi['setActiveOrg']>(
    async (orgId) => {
      // Validate the input shape against the shared-core schema so we
      // never round-trip an obviously-bad value (matches web behaviour).
      const inputResult = setActiveOrgInput.safeParse({ p_org_id: orgId });
      if (!inputResult.success) {
        const msg =
          inputResult.error.issues[0]?.message ?? 'Invalid organization id.';
        setError(msg);
        return { ok: false, error: msg };
      }

      setError(null);
      setSwitching(true);
      setPendingOrgId(orgId);

      // Optimistic update — flip is_active_org locally so the UI feels
      // instantaneous. We reconcile against the authoritative re-fetch.
      setMemberships((prev) =>
        prev.map((m) => ({ ...m, is_active_org: m.org_id === orgId })),
      );

      const { data, error: rpcError } = await supabase.rpc('set_active_org', {
        p_org_id: orgId,
      });

      if (rpcError) {
        // Roll back the optimistic flip by re-fetching the truth.
        await fetchOnce();
        setSwitching(false);
        setPendingOrgId(null);
        setError(rpcError.message);
        return { ok: false, error: rpcError.message };
      }

      const result = (data ?? {}) as { ok?: boolean };
      if (!result.ok) {
        await fetchOnce();
        setSwitching(false);
        setPendingOrgId(null);
        const msg = 'Could not switch workspace.';
        setError(msg);
        return { ok: false, error: msg };
      }

      // Re-fetch so order (active-first) and any server-side changes are
      // reflected; this is cheap and keeps the list authoritative.
      await fetchOnce();
      setSwitching(false);
      setPendingOrgId(null);
      return { ok: true };
    },
    [fetchOnce],
  );

  return {
    loading,
    error,
    memberships,
    active,
    switching,
    pendingOrgId,
    setActiveOrg,
    refresh: fetchOnce,
  };
}
