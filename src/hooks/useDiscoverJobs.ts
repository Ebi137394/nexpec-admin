// ───────────────────────────────────────────────────────────────────
//  src/hooks/useDiscoverJobs.ts
//  Phase 5 — Inspector Job Feed / Discovery Engine (Step 2)
//
//  Single seam between the Discover tab UI and the discover_jobs RPC.
//
//  Responsibilities:
//    1. Load the inspector's persisted preferences from profiles
//       (home_base_lat/lng/label + travel_radius_km).
//    2. Manage a session-only radius override (in-feed pill changes
//       the radius for the current session WITHOUT touching the
//       profile — that's the in-feed UX contract from the blueprint).
//    3. Debounce the city/region search query so we don't hammer the
//       RPC on every keystroke.
//    4. Call the RPC and flatten the (job, distance_km, has_applied)
//       row shape into a single object per job, ready for the UI.
//    5. Expose refresh() for pull-to-refresh.
//
//  Locked design rules (per blueprint):
//    • home_base coords NULL ⇒ skip proximity; RPC falls back to
//      created_at DESC. Hook still calls the RPC so search & has_applied
//      keep working — we just pass p_lat/p_lng as null.
//    • effectiveRadiusKm = override (if user changed it this session)
//      else persisted (from profile).
//    • A radius of `null` means UNLIMITED. A radius of 0 is invalid
//      (the DB CHECK constraint forbids it).
//    • Applied jobs are NOT filtered out — has_applied flag drives the
//      "Applied" pill state on the card.
// ───────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * A flattened discover_jobs row. The jobs.* columns come from the
 * jsonb `job` field returned by the RPC — we accept anything the jobs
 * table exposes (schema-flexible), and surface the two RPC extras as
 * top-level fields.
 */
export interface DiscoverJob {
  id: string;
  title: string | null;
  status: string;
  created_at: string;

  city?: string | null;
  state?: string | null;
  country?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;

  contractor_id?: string | null;
  client_id?: string | null;

  payout_amount_cents?: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
  job_type?: string | null;
  inspection_type?: string | null;

  // RPC extras (always present)
  distance_km: number | null;
  has_applied: boolean;

  // Anything else jobs.* exposes
  [key: string]: any;
}

export interface HomeBase {
  lat: number;
  lng: number;
  label: string | null;
}

export interface UseDiscoverJobsResult {
  // Data
  jobs: DiscoverJob[];
  loading: boolean;        // true during the initial load
  refreshing: boolean;     // true during a pull-to-refresh
  error: string | null;

  // Imperative
  refresh: () => Promise<void>;

  // Inspector preferences (read-only here; profile screen mutates them)
  homeBase: HomeBase | null;
  persistedRadiusKm: number | null;    // from profile (NULL = unlimited)

  // Session-only radius override (the in-feed pill)
  radiusOverrideKm: number | null | undefined;
  //   undefined ⇒ no override (use persisted)
  //   null      ⇒ override to Unlimited
  //   number    ⇒ override to that finite radius
  setRadiusOverride: (km: number | null | undefined) => void;

  // The radius the RPC is actually being called with.
  effectiveRadiusKm: number | null;    // NULL = Unlimited

  // City / region / title search (debounced before hitting the RPC)
  cityQuery: string;
  setCityQuery: (q: string) => void;
}

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const PAGE_LIMIT = 50;            // matches the RPC default; one page is enough for v1
const CITY_DEBOUNCE_MS = 250;     // server-side ILIKE deserves a short pause

// ═══════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════
export function useDiscoverJobs(): UseDiscoverJobsResult {
  const { user } = useAuth();
  const inspectorId = user?.id ?? null;

  // ─ Persisted preferences (from profiles) ─────────────────────────
  const [homeBase, setHomeBase] = useState<HomeBase | null>(null);
  const [persistedRadiusKm, setPersistedRadiusKm] = useState<number | null>(null);

  // ─ Session-only override ─────────────────────────────────────────
  //   undefined ⇒ "use persisted preference"
  //   null      ⇒ "Unlimited for this session"
  //   number    ⇒ "this many km for this session"
  const [radiusOverrideKm, setRadiusOverrideKm] =
    useState<number | null | undefined>(undefined);

  // ─ Search query (immediate state + debounced derivative) ──────────
  const [cityQuery, setCityQueryRaw] = useState('');
  const [debouncedCityQuery, setDebouncedCityQuery] = useState('');

  // ─ Data state ─────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<DiscoverJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard against stale RPC responses after rapid input changes.
  const requestIdRef = useRef(0);

  // ─ Effective radius (override wins over persisted) ───────────────
  const effectiveRadiusKm: number | null = useMemo(() => {
    if (radiusOverrideKm !== undefined) return radiusOverrideKm;
    return persistedRadiusKm;
  }, [radiusOverrideKm, persistedRadiusKm]);

  // ─ Debounce city query ───────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCityQuery(cityQuery), CITY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [cityQuery]);

  // ─ Load profile preferences on mount AND on every screen focus ───
  //   ★ Hotfix #3: previously this was a useEffect([inspectorId]), which
  //     fires once when the hook mounts. If the inspector edited their
  //     Home Base / Travel Radius on the Profile screen and returned to
  //     Jobs, the hook still had stale state from mount, so the RPC was
  //     called with the old (often null) values. Switching to
  //     useFocusEffect makes the loader fire every time the host screen
  //     becomes focused — picks up profile edits without remounting.
  useFocusEffect(
    useCallback(() => {
      if (!inspectorId) {
        setHomeBase(null);
        setPersistedRadiusKm(null);
        return;
      }

      let cancelled = false;
      (async () => {
        try {
          const { data, error: pErr } = await supabase
            .from('profiles')
            .select('home_base_lat, home_base_lng, home_base_label, travel_radius_km')
            .eq('id', inspectorId)
            .maybeSingle();

          if (cancelled) return;
          if (pErr) {
            console.warn('[useDiscoverJobs] profile fetch error:', pErr.message);
            return;
          }

          if (data?.home_base_lat != null && data?.home_base_lng != null) {
            setHomeBase({
              lat: Number(data.home_base_lat),
              lng: Number(data.home_base_lng),
              label: data.home_base_label ?? null,
            });
          } else {
            setHomeBase(null);
          }
          setPersistedRadiusKm(
            data?.travel_radius_km != null ? Number(data.travel_radius_km) : null,
          );
        } catch (e: any) {
          if (!cancelled) console.warn('[useDiscoverJobs] profile load failed:', e?.message);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [inspectorId]),
  );

  // ─ Core fetch — calls the discover_jobs RPC ───────────────────────
  const fetchJobs = useCallback(
    async ({ isRefresh }: { isRefresh: boolean }) => {
      if (!inspectorId) {
        setJobs([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Bump the request id so older in-flight responses get dropped.
      const myReq = ++requestIdRef.current;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const { data, error: rpcErr } = await supabase.rpc('discover_jobs', {
          p_inspector_id: inspectorId,
          p_lat: homeBase?.lat ?? null,
          p_lng: homeBase?.lng ?? null,
          p_radius_km: effectiveRadiusKm,         // NULL = unlimited
          p_city_query: debouncedCityQuery.trim() || null,
          p_limit: PAGE_LIMIT,
          p_offset: 0,
        });

        // A newer request started while we were waiting — abandon.
        if (myReq !== requestIdRef.current) return;

        if (rpcErr) throw rpcErr;

        const flat: DiscoverJob[] = (data ?? []).map((row: any) => {
          const j = row.job ?? {};
          return {
            ...j,
            distance_km:
              row.distance_km != null ? Number(row.distance_km) : null,
            has_applied: !!row.has_applied,
          };
        });

        setJobs(flat);
      } catch (e: any) {
        if (myReq !== requestIdRef.current) return;
        console.error('[useDiscoverJobs] RPC error:', e?.message ?? e);
        setError(e?.message ?? 'Failed to load jobs');
        setJobs([]);
      } finally {
        if (myReq === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [inspectorId, homeBase, effectiveRadiusKm, debouncedCityQuery],
  );

  // ─ Run fetch whenever inputs change ──────────────────────────────
  useEffect(() => {
    fetchJobs({ isRefresh: false });
  }, [fetchJobs]);

  // ─ Public refresh (pull-to-refresh) ──────────────────────────────
  const refresh = useCallback(async () => {
    await fetchJobs({ isRefresh: true });
  }, [fetchJobs]);

  // ─ Stable setters ────────────────────────────────────────────────
  const setRadiusOverride = useCallback(
    (km: number | null | undefined) => setRadiusOverrideKm(km),
    [],
  );
  const setCityQuery = useCallback((q: string) => setCityQueryRaw(q), []);

  return {
    jobs,
    loading,
    refreshing,
    error,
    refresh,

    homeBase,
    persistedRadiusKm,

    radiusOverrideKm,
    setRadiusOverride,
    effectiveRadiusKm,

    cityQuery,
    setCityQuery,
  };
}
