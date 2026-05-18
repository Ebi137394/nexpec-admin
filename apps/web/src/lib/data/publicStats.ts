// ════════════════════════════════════════════════════════════════════════════
//  lib/data/publicStats.ts — read-only access to the public_stats RPC
//
//  Used by the landing page LiveTicker (Server Component). Defensive — if
//  the RPC fails for any reason, returns a typed `null`-stat object so the
//  marketing surface degrades gracefully instead of 500-ing.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { PublicStats } from './publicStats.types';

export type { PublicStats };

const EMPTY: PublicStats = {
  jobs30d: null,
  escrowCents: null,
  avgRating: null,
  asOf: null,
};

export async function fetchPublicStats(): Promise<PublicStats> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('public_stats');

    if (error || !data) {
      if (typeof console !== 'undefined') {
        console.warn('[publicStats] RPC failed:', error?.message);
      }
      return EMPTY;
    }

    const row = data as {
      jobs_30d?: unknown;
      escrow_cents?: unknown;
      avg_rating?: unknown;
      as_of?: unknown;
    };

    const num = (v: unknown): number | null => {
      const n = typeof v === 'string' ? Number(v) : (v as number);
      return Number.isFinite(n) ? (n as number) : null;
    };

    return {
      jobs30d: num(row.jobs_30d),
      escrowCents: num(row.escrow_cents),
      avgRating: num(row.avg_rating),
      asOf: typeof row.as_of === 'string' ? row.as_of : null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[publicStats] threw:', e);
    }
    return EMPTY;
  }
}
