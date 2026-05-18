// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobsModeration.ts — superseded by ./jobModeration.ts
//
//  The canonical job-moderation server action lives in `./jobModeration.ts`
//  (singular Job — that's the path the JobModerationDrawer imports). This
//  file re-exports the same symbols so the plural import path still
//  resolves to one action — no duplicate server-action endpoint.
// ════════════════════════════════════════════════════════════════════════════

export * from './jobModeration';
