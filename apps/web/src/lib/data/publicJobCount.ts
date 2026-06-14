// ════════════════════════════════════════════════════════════════════════════
//  lib/data/publicJobCount.ts — real total job count for the landing page.
//
//  The marketing surface is anon (RLS-gated), so the count comes from the
//  SECURITY DEFINER public_total_jobs() RPC (aggregate only — no rows, no PII).
//  Returns null on any failure so the social-proof CTA degrades to "render
//  nothing" instead of 500-ing the landing page.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function fetchTotalJobCount(): Promise<number | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('public_total_jobs');
    if (error || data === null || data === undefined) {
      if (typeof console !== 'undefined') {
        console.warn('[publicJobCount] RPC failed:', error?.message);
      }
      return null;
    }
    // bigint comes back as number or (for very large values) string.
    const n = typeof data === 'string' ? Number(data) : (data as number);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[publicJobCount] threw:', e);
    }
    return null;
  }
}
