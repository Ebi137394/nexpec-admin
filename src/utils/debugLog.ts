// ════════════════════════════════════════════════════════════════════════════
//  src/utils/debugLog.ts
//  NEXPEC — CONSOLE-NOISE-001 Part B
//
//  Conditional debug logger. Fires only when React Native's __DEV__
//  global is true (Metro / dev client / Expo Go in development), and
//  is a no-op in production bundles.
//
//  Why?
//    • Dev debug logs add measurable JS overhead on hot paths.
//    • They surface in Console.app / device logs in production where
//      anyone with physical access can read them.
//    • console.error / console.warn are deliberately NOT covered here
//      — those should still fire in production so Sentry-grade error
//      pipelines can ingest them.
//
//  Usage
//  ─────
//    import { dlog } from '@/src/utils/debugLog';
//    dlog('upload start', { mime, sizeBytes });
//
//  Compared to writing `if (__DEV__) console.log(...)` inline, the
//  helper:
//    • survives bundler dead-code elimination — Metro strips the call
//      site to an unreachable branch in __DEV__=false builds,
//    • keeps the call-site terse,
//    • centralises the no-op contract so a future migration to a
//      structured logger (Sentry breadcrumbs, Reactotron, etc.) is a
//      one-file change.
// ════════════════════════════════════════════════════════════════════════════

// React Native and Expo expose __DEV__ as a true/false global at build
// time. Declared here as a fallback for environments that don't surface
// it on the global type (e.g., bare TS tooling).
declare const __DEV__: boolean | undefined;

/** Dev-only console.log replacement. No-op in production bundles. */
export function dlog(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

/** Dev-only console.info replacement. No-op in production bundles. */
export function dinfo(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.info(...args);
  }
}
