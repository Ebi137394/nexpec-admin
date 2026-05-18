// ════════════════════════════════════════════════════════════════════════════
//  lib/imageDiagnostics.ts — LANE-A-PHASE-1 diagnostic retirement
//
//  Pre-strike: a `diagnoseImageUrl` utility for ad-hoc image-loading
//  troubleshooting. Phase-1 grep verification: the only reference is a
//  code example inside IMAGE_LOADING_TROUBLESHOOTING.md (a markdown
//  documentation file). No production TypeScript file imports it.
//
//  The real image upload + handling pipeline lives in lib/imageUpload.ts
//  (active, dlog-instrumented per CONSOLE-NOISE-001 Part B).
//
//  Verification (LANE-A audit + Phase-1 grep):
//      $ grep -r "diagnoseImageUrl|from.*imageDiagnostics" — only the
//        markdown doc reference; zero production imports.
//
//  Post-strike: preserved export-shape so the markdown doc snippet still
//  type-resolves if anyone copy-pastes it, but the function body is now
//  a deprecation throw — failures surface loudly if called at runtime.
// ════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated LANE-A-PHASE-1 — diagnostic-only utility retired. The
 * real image pipeline is lib/imageUpload.ts. This stub exists only to
 * keep stale documentation snippets type-resolving; calling it at
 * runtime throws.
 */
export async function diagnoseImageUrl(_imageUrl: string): Promise<never> {
  const msg =
    '[imageDiagnostics] deprecated: this utility was retired in LANE-A-PHASE-1. Use lib/imageUpload.ts.';
  // Surface loudly in dev; production callers should not exist.
  // eslint-disable-next-line no-console
  console.error(msg);
  throw new Error(msg);
}
