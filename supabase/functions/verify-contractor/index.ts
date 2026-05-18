// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/verify-contractor/index.ts
//  Deploy entrypoint (DEPLOY-VC-001).
//
//  Supabase CLI looks for `index.ts` as the function entrypoint by
//  default. This folder's historical source-of-truth file is `mod.ts`
//  (containing the full handler + serve() bootstrap). Without an
//  index.ts the deploy fails:
//      "Entrypoint path does not exist - .../verify-contractor/index.ts"
//
//  This file is a one-line re-import. Deno evaluates the imported
//  module on resolution, so `serve(...)` at mod.ts:395 fires
//  exactly the same way as if the entire handler lived here. No
//  logic duplication, no behavioural drift.
//
//  If you later move the handler into this file directly, you can
//  delete mod.ts in the same commit — but this thin shim works
//  indefinitely and keeps mod.ts as the canonical source.
// ════════════════════════════════════════════════════════════════════════════

import './mod.ts';
