# NEXPEC 1.0 — Pre-Launch QA & Stress-Test Plan

_Lead-QA plan grounded in the actual codebase (RN app + Next.js web). Goal: hunt
edge cases, unhandled rejections, hydration mismatches, silent failures, and
leaks before a 1.0 launch. Includes real findings from the first static sweep._

---

## 0. Instrument first — you can't hunt what you can't see

Stand up observability before stress-testing, so every failure leaves a trace:

- **Sentry** is already wired on both surfaces (PII-scrubbed). Set the DSN in a
  **staging** build so every unhandled rejection / render crash is captured with
  breadcrumbs. This is the single highest-leverage QA enabler you already own.
- **Global rejection traps (temporary, staging only):**
  - Web: `window.addEventListener('unhandledrejection', …)` + `window.onerror`.
  - RN: `ErrorUtils.setGlobalHandler(…)` + a `Promise` rejection tracker; watch
    `LogBox` for "Possible unhandled promise rejection".
- **Mobile:** React Native DevTools (the new Hermes debugger), the Network tab,
  and the Memory profiler. iOS **Network Link Conditioner** is mandatory for the
  offline/intermittent tests.
- **Web:** Chrome DevTools — Console (hydration warnings), **Memory → heap
  snapshots** (leak diffing), **Network → throttle/Offline**, React Profiler.

---

## 1. Where to start — the sweep order (cheap+broad → deep+risky)

1. **Static silent-failure sweep** — empty catches, missing realtime cleanup,
   `fetch` without timeout, unawaited promises, swallowed `{data,error}`. Cheap,
   high yield. _(Done — seed findings in §2.)_
2. **Offline-sync outbox (deep dive #1 — START THE DEEP TESTS HERE).** It is the
   most stateful, most concurrent path, and the **only** place where a bug means
   *permanent loss of an inspector's field evidence*. Everything else fails safe
   (reject/skip); the outbox is where a subtle bug silently drops data. Highest
   risk × hardest to catch in prod → hunt it first.
3. **Real-time leaks** — pervasive, both surfaces, silent accumulation.
4. **OTS anchoring** — background robustness (the timeout finding).
5. **Provable-AI fail-closed** — security-critical, but it fails *safe*; the test
   is proving it actually rejects.

---

## 2. Seed findings (already surfaced by the static sweep)

| # | Sev | Area | Finding |
|---|-----|------|---------|
| **F1** | **High** | OTS (#3) | `anchor-inspection-seals` and `confirm-inspection-anchors` call `fetch()` against the OpenTimestamps calendar with **no `AbortController`/timeout**. A slow/hung calendar stalls the whole batch until the Edge runtime wall-clock kills the function (your exact concern). Fix: per-request `AbortController` (~8–10s) + the existing per-anchor `try/catch` so one hang can't abort the other 99. |
| **F4** | **Med** | Offline (#1) | **Stuck-`in_flight` outbox rows.** `nextPending()` flips a row to `in_flight`; if the app is killed/crashes between that and `markSuccess/markFailure`, the row is stranded — `nextPending` only selects `status='pending'`, so it is **never retried and never surfaced**. That op's data is silently lost. Fix: on `initializeOfflineSync()` boot, reset stale `in_flight` rows back to `pending` (recovery sweep). |
| **F2** | Audit | Realtime (#4) | `src/core/chat/messages.ts → subscribeToMessages()` is a factory that **returns** the channel for the caller to clean up (correct by design). The leak risk is in the **consumers**: every caller must `supabase.removeChannel(ch)` in its effect cleanup, with correct deps. Audit each call site. |
| **F3** | Good | Silent fail | Only 2 empty-catch blocks repo-wide. The dominant pattern is `{ data, error }` returns — good. Residual risk: **callers that ignore the returned `error`** (a silent failure one layer up). Spot-audit high-value callers. |
| **F5** | Perf | Stress | `getConversations()` does an **N+1**: one `profiles` fetch per conversation via `Promise.all(map(... .single()))`. Fine at small N; stress with 100+ conversations (latency, rate-limit, parallel-socket pressure). |

---

## 3. Area stress-matrices

### A. Offline-sync outbox — `src/core/offline/*` (#1)

**Invariants that MUST hold** (regression-guard the #56 hardening):
auth failures never increment `attempts`; a 0-row `report_update` becomes a
`conflict` (never a silent success that deletes the edit); `client_op_id`
idempotency; FIFO drain; exponential backoff; ≤ `MAX_ATTEMPTS` then `abandoned`
(surfaced, not deleted).

**Stress / edge cases:**
- **Intermittent connectivity:** toggle airplane mode mid-drain repeatedly; flip
  Wi-Fi↔cellular during a photo upload; 100 % packet loss then restore (Link
  Conditioner). Expect: drain pauses/resumes, **0 abandoned on transient errors**.
- **Token expiry mid-drain:** force-expire the JWT while ops are queued → verify
  `requeueForAuth` (no attempt burn) → session refresh → resume; **abandoned
  stays 0**; `onAuthExpired` fires only if refresh truly fails.
- **Conflict path:** delete or seal a report server-side, then let a queued
  `report_update` drain → it must land as `conflict`, never silent success.
- **Kill-and-relaunch mid-drain:** SQLite persists; app resumes; **no double-send**
  (idempotency) and **no stuck `in_flight`** (see F4).
- **Tap-tap dedup:** enqueue the same op twice → exactly one row.
- **Large queue:** 100+ ops offline → online → FIFO drain, no UI jank, no OOM.
- **Backoff honoured:** verify `next_attempt_at` gating; the 60 s poller doesn't
  hammer.

**Bug signatures:** `abandoned` rising on transient errors · a `report_update`
"succeeding" with 0 rows · duplicate detections after relaunch · a row stuck
`in_flight` · the drain loop burning CPU while offline.

### B. Provable-AI inference loop — `src/core/ml/*`, `shared-core/ml` (#2)

**Invariants:** signature required + absent → reject; bad signature → reject;
sha256 mismatch → reject; verifier unavailable + `requireSignature` → reject
(NEVER run unverified); invalid files discarded, **never cached**.

**Stress / edge cases:**
- **Tampered bytes:** flip a byte of the model in Storage → `sha256_mismatch` →
  discarded, not cached, feature reports unavailable.
- **Swapped/ð signature, wrong/rotated pubkey:** → `bad_signature` → reject.
- **Verifier missing:** simulate `@noble/curves` absent → `verifier_unavailable`
  → reject (regression-guard the v2 `.js` import fix — that exact bug silently
  disabled verification once).
- **Mid-download network drop:** partial file → discard, retry; never load partial.
- **Concurrent loads** of the same model → single download/verify, no race.
- **Harnesses to run on-device:** `node scripts/ml/prove-loop.mjs` (15/15) +
  `supabase test db` (binding pgTAP) are CI gates; add a hidden debug screen that
  loads a known-good and a tampered model and asserts the reject path on a real
  device.

**Bug signatures:** any model loading despite a bad signature · a corrupt/partial
file in the content-addressed cache · the verifier silently reporting available
when `@noble` failed to load.

### C. OTS / Bitcoin anchoring — `supabase/functions/*`, `_shared/ots.ts` (#3)

**The headline is F1 (timeout).** Beyond it:
- **Calendar 5xx / 404 / garbage body:** parser throws → caught → anchor stays
  `submitted` (no false `bitcoin_confirmed`). `prove-ots.mjs` already proves
  garbage/truncated → throw; extend to the live path.
- **One slow anchor must not block the batch:** with the F1 fix, a per-request
  timeout + the existing per-anchor `try/catch` isolate failures.
- **Idempotency:** re-running `confirm` on an already-`bitcoin_confirmed` anchor →
  no-op; two `pg_cron` runs overlapping → no double-update/race (consider an
  advisory lock or `status` guard).
- **Confirmation correctness:** only flip to `bitcoin_confirmed` when a real
  Bitcoin attestation is present (the reader checks this) — never on a still-
  pending upgrade response.

**Bug signatures:** a function timing out / batch never completing · an anchor
marked confirmed without a block height · duplicate confirmations.

### D. Real-time subscription leaks — both surfaces (#4)

**Stress / edge cases:**
- **Mount/unmount churn:** navigate into/out of a chat (and any `LiveRadar` /
  critical-alerts / dashboard) **50×**; take heap snapshots before/after — the
  `RealtimeChannel` count must return to baseline. Growth = leak.
- **Duplicate callbacks:** after churn, send one message → the handler must fire
  **once**, not 2–3× (2× = orphaned channels from missing cleanup).
- **Effect-dep re-subscribe:** change `jobId`/filter → old channel `removeChannel`
  before the new one is created (no orphans); verify deps arrays.
- **Background/foreground:** RN app background→foreground → channels reconnect,
  not duplicate; web tab sleep/wake likewise.
- **Channel-cap pressure:** a screen with many live widgets → stay under the
  Supabase per-client channel limit; watch for websocket reconnect storms.
- **Audit target (F2):** every `subscribeToMessages` / `.channel(` consumer has a
  cleanup that runs on unmount.

**Bug signatures:** growing `RealtimeChannel`/listener count in heap · duplicated
event callbacks · websocket reconnect loops · rising memory across a soak.

---

## 4. Cross-cutting hunts

- **Unhandled promise rejections:** the global traps + Sentry. Sweep fire-and-
  forget async in effects (RPCs called without `await`/`.catch`, `void`-less
  promises), and `Promise.all` branches where one rejection rejects the whole.
- **Hydration mismatches (web):** the landing is `force-dynamic` (dodges the
  static-export React #31). Verify the new marketing client components
  (`ProvableAI`/`BlockchainSeals`/`FieldResilience` — all `'use client'` with
  `useScroll`/`useReducedMotion`, which are client-only effects) produce **no
  hydration warning** and no layout shift. Hunt `Date.now()`/`Math.random()`/
  `new Date()`/`window`/locale used during render anywhere SSR runs.
- **Silent failures:** audit callers that ignore a returned `error` (F3); log-and-
  continue catches that hide a broken write.
- **Perf under load:** the N+1 in `getConversations` (F5); list virtualization on
  long message/job lists; image weight of the new full-bleed landing sections
  (they're below-the-fold + lazy, but confirm LCP is still the Hero).

---

## 5. Launch gate — exit criteria

- **0** unhandled rejections in a 30-min soak on each surface (Sentry clean).
- **Offline:** a 100-op intermittent-connectivity soak → **0 lost, 0 abandoned-
  on-transient, 0 stuck `in_flight`** (requires the F4 fix).
- **Provable-AI:** a tampered model is rejected **on a real device**.
- **OTS:** a simulated calendar timeout → the batch completes, the anchor stays
  `submitted` (requires the F1 fix).
- **Realtime:** 50× navigation churn → heap returns to baseline, handlers fire
  exactly once.
- **Web:** zero hydration warnings in the console across every route group.

---

## 6. Recommended immediate action

Fix the two confirmed code bugs now (small, contained, both in code I own):
**F1** (OTS `AbortController` timeout) and **F4** (outbox `in_flight` recovery
reset) — then run the offline-outbox deep-dive (§3A) as the first stress pass.
F2 (realtime call-site audit) follows. Everything else is execution against the
matrices above.
