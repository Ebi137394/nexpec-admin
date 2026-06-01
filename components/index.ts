// ════════════════════════════════════════════════════════════════════════════
//  components/index.ts — LANE-A-PHASE-3 re-export stub
//
//  Pre-strike: canonical location. Post-strike: relocated to @/src/shared-ui/index;
//  this file is a transparent re-export so legacy imports keep working.
//  New code should import directly from the new location.
// ════════════════════════════════════════════════════════════════════════════
export * from '@/src/shared-ui/index';
// (removed a broken `export { default }` — the shared-ui barrel is all `export *`,
//  so it never had a default to re-export. #QA)
