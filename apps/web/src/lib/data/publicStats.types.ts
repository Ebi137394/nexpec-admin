// ════════════════════════════════════════════════════════════════════════════
//  lib/data/publicStats.types.ts — type-only. Safe for Client Components.
// ════════════════════════════════════════════════════════════════════════════

export interface PublicStats {
  jobs30d: number | null;
  escrowCents: number | null;
  avgRating: number | null;
  asOf: string | null;
}
