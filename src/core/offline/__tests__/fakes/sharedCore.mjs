// ─────────────────────────────────────────────────────────────────
//  Fake `@nexpec/shared-core` — NOT a fake of the logic.
//
//  It re-exports the REAL sources for the two slices the offline modules
//  import, so nothing under test is simulated:
//
//    offline/syncErrors.ts  the failure classifier the drain loop reacts to
//    domain/itp.ts          the frozen ITP contract (ITP_RPC, ItpResult, …)
//
//  The package's own src/index.ts is not used because it pulls zod and
//  @supabase/supabase-js, which the platform boundaries here deliberately do
//  not provide. Add a line when a module under test needs another slice —
//  never a hand-written stand-in.
// ─────────────────────────────────────────────────────────────────

export * from '../../../../../packages/shared-core/src/offline/syncErrors.ts';
export * from '../../../../../packages/shared-core/src/domain/itp.ts';
