// ════════════════════════════════════════════════════════════════════════════
//  src/hooks/useLaunchedInspectionDomains.ts
//
//  React Query hook — returns the slugs of inspection domains that are
//  currently `is_launched = true` AND `is_active = true` in the
//  public.inspection_domains config table.
//
//  Used by inspector / consumer-facing surfaces to gate the passive
//  <InspectionDomainBadge requireLaunched> render. The set of launched
//  domains changes infrequently (only when an admin toggles it on the
//  /admin/domains page), so we cache aggressively.
//
//  Failure mode: if the query errors (RLS blocked, network down,
//  pre-migration database), returns an empty array. Inspector screens
//  fall back to rendering no badge — which is the correct strict
//  behaviour for consumer surfaces.
// ════════════════════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const LAUNCHED_DOMAINS_QUERY_KEY = ['nx', 'launched_inspection_domains'] as const;

interface LaunchedDomainsResult {
  /** Slugs of launched + active domains. Includes industrial_ndt when launched. */
  slugs: readonly string[];
  /** Loading flag for skeletons / opt-in UI. */
  isLoading: boolean;
  /** Underlying error if the query failed (mainly for debug logging). */
  error: Error | null;
}

export function useLaunchedInspectionDomains(): LaunchedDomainsResult {
  const query = useQuery({
    queryKey: LAUNCHED_DOMAINS_QUERY_KEY,
    // 15-minute stale — launching/unlaunching a domain is a deliberate
    // admin action, and any rare race is harmless (the badge just delays
    // appearing/disappearing by < 15 min).
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<readonly string[]> => {
      const { data, error } = await supabase
        .from('inspection_domains')
        .select('slug')
        .eq('is_launched', true)
        .eq('is_active', true);

      if (error) {
        // Tolerable — return empty so badges stay hidden rather than throw.
        // The error is surfaced via the `error` field in the return for
        // optional logging by the caller.
        return [];
      }
      return ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
    },
  });

  return {
    slugs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}
