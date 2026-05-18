// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/compliance.ts — superseded by ./credentials.ts
//
//  The canonical credential-review server action lives in `./credentials.ts`
//  (that's the path the ComplianceDrawer imports). This file re-exports the
//  same symbols so any straggling import to `@/lib/actions/compliance`
//  resolves to the same action — no duplicate server-action endpoint.
// ════════════════════════════════════════════════════════════════════════════

export * from './credentials';
