// ════════════════════════════════════════════════════════════════════════════
//  schemas/compliance.ts — superseded by ./credentials.ts
//
//  Canonical credential-review schemas live in `./credentials.ts`. This
//  file is kept only as a re-export so any earlier `compliance` imports
//  resolve to the same symbols (and the bundle dedupes them at build).
// ════════════════════════════════════════════════════════════════════════════

export * from './credentials';
