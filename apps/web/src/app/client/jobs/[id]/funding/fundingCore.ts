'use client';
// ════════════════════════════════════════════════════════════════════════════
//  client/jobs/[id]/funding/fundingCore.ts
//
//  Binds @nexpec/shared-core to the browser Supabase client so this lane can
//  call the SANCTIONED accessors (fetchClientFunding / ensureFundingSchedule)
//  rather than writing its own `.from('job_funding_stages')` query.
//
//  ── WHY THE BROWSER AND NOT THE SERVER ─────────────────────────────────────
//  createCore() writes a MODULE-LEVEL singleton (client/createCore.ts:32). In a
//  Next.js server process that singleton is shared by every concurrent request,
//  so binding a per-request cookie-scoped client there is a cross-request auth
//  hazard: request A binds its client, request B re-binds, and A's next await
//  resumes against B's session. In the browser there is exactly one session per
//  process, so the singleton is the correct lifetime and the hazard cannot
//  arise. lib/supabase/browser.ts is itself a singleton, so the two agree.
//
//  Reading here is legitimate, not a privilege escape: RLS policy
//  job_funding_stages_client_read (20260801448000 §7) grants the owning client
//  SELECT on their own job's stages. Ownership is ALSO checked server-side in
//  page.tsx before this component is ever rendered.
// ════════════════════════════════════════════════════════════════════════════

// Subpath imports throughout this lane: the root barrel re-exports only
// domain/{jobStatus,money,audit,scheduledDate,itp} and net/supabaseRetry, so
// funding.ts and fundingReview.ts are reachable only via ./domain and ./net.
import { createCore } from '@nexpec/shared-core/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

let bound = false;

/** Idempotent. Safe to call from every funding component's effect. */
export function bindFundingCore(): void {
  if (bound) return;
  createCore({ supabase: createSupabaseBrowserClient() });
  bound = true;
}
