---
name: reference-offline-sync-hardening
description: "How the mobile offline outbox drain loop handles auth-expiry and conflicts (#56) — invariants that are easy to silently regress"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

The mobile offline outbox (`src/core/offline/*`) drain loop classifies every handler failure via `classifySyncError` from `@nexpec/shared-core/offline/syncErrors` (pure, unit-tested — same moat pattern as [[reference-nexpec-schema-gotchas]] / the scrubber). Four classes, four reactions:

- **auth** (401 / PGRST3xx / JWT msg): the op is INNOCENT. `requeueForAuth(id)` bounces it back to `pending` **without incrementing attempts**, then the loop forces a session refresh (default seam = `supabase.auth.refreshSession()`, injected in `index.ts`) and retries. At most one refresh per drain pass; on failure it sets `authPaused` + fires `onAuthExpired`. **INVARIANT: auth failures must NEVER count toward the 8-attempt abandonment ceiling** — the old code did, which burned the budget and abandoned good inspector field data over an expired token.
- **conflict**: handlers now `.select('id')` on `report_update` / photo-link updates and throw `SyncConflictError` on 0 rows (deleted / sealed / RLS-filtered / optimistic-lock miss). 0-row updates previously "succeeded" silently and **destroyed the edit**. Parked in terminal status `'conflict'`; surfaced via `useOutbox().conflicts` + `resolveConflict`/`discard`. Not auto-retried.
- **fatal** (constraint / RLS-deny 42501 / trigger P0001 / 4xx): `markFatal` → `abandoned` fast, preserved + surfaced.
- **transient**: original exponential-backoff path; exhaustion sets `failure_class='exhausted'`.

Unknown errors bias to **transient (retry)**, never fatal — never silently abandon. `OutboxRow` gained `failure_class` (db.ts user_version v2 migration); `OutboxCounts` gained `conflict`. `initializeOfflineSync()` stays zero-arg compatible (app/_layout.tsx call site untouched). All additive/logic-only — no UI/flow changes. Sandbox can't run vitest (npm 403); verify via `tsc --noEmit` on shared-core + the framework-free node harness.
