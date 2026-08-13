// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/_lib/core.ts — binding @nexpec/shared-core per request
//
//  The shared funding accessors reach their Supabase client through a
//  MODULE-LEVEL singleton (shared-core client/createCore.ts). lib/supabase/
//  server.ts documents the pairing — "Pair with createCore({ supabase }) from
//  @nexpec/shared-core when you want to use the shared RPC wrappers in server
//  code" — but the web shell has no boot hook that calls it, so every server
//  entry point that consumes a shared-core reader must bind the request's own
//  cookie-scoped client itself.
//
//  ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ───────────────────────────────
//  A process-wide singleton holding a REQUEST-SCOPED client is only safe when
//  no `await` separates the bind from the shared-core call that consumes it.
//  Node runs one request at a time between awaits, so a bind followed by a
//  SYNCHRONOUS entry into the reader cannot be interleaved by another request.
//
//  Both readers cooperate with that discipline, by construction:
//    • fetchAdminFunding() runs synchronously into readStages(), whose FIRST
//      statement is _requireCore().
//    • rpcWithRetry() (behind setFundingTerms) calls _requireCore() as its
//      first statement too.
//  So `createCore(); reader(...)` with nothing between them always captures
//  this request's client.
//
//  withFundingCore() is the only sanctioned shape here: it awaits the client
//  FIRST, binds, then hands control straight to the caller's synchronous
//  invocation. NEVER put an `await` inside the callback ahead of the
//  shared-core call — do the shared-core call first, then anything else.
//
//  Blast radius if the rule were ever broken: the reader would run against
//  another session's client. Every other binder in this codebase binds a
//  client- or inspector-scoped session, i.e. a NARROWER RLS scope, so the
//  failure mode is missing rows, never leaked ones. The rule keeps even that
//  from happening.
//
//  createCore() logs "[shared-core] core re-initialized" on every rebind. That
//  is expected here: one line per admin funding request, not a defect.
// ════════════════════════════════════════════════════════════════════════════

import { createCore } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Bind the request's Supabase client into shared-core, then run `invoke`.
 *
 * `invoke` MUST call the shared-core function synchronously as its first act.
 * It receives no arguments precisely so there is nothing to await inside it.
 */
export async function withFundingCore<T>(invoke: () => T): Promise<T> {
  const supabase = await createSupabaseServerClient();
  // NOTE: no eslint-disable here on purpose. This file's flat config
  // (eslint.config.mjs) takes the TypeScript *parser* from Next's
  // core-web-vitals base but does NOT load the @typescript-eslint *rules*, so
  // `@typescript-eslint/no-explicit-any` is not a defined rule — and a
  // disable directive naming an undefined rule is itself an ESLint *error*,
  // which failed `next build`. The cast is not flagged by any active rule.
  //
  // The cast is still needed: @supabase/ssr returns the same runtime client as
  // @supabase/supabase-js, but the two packages resolve their own copies of the
  // generic SupabaseClient type, so they are structurally incompatible at the
  // type level only.
  createCore({ supabase: supabase as unknown as Parameters<typeof createCore>[0]['supabase'] });
  return invoke();
}
