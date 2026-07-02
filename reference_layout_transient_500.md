---
name: reference-layout-transient-500
description: "Intermittent full-screen 500 on authed routes = uncaught promise reject in a portal layout's Supabase reads; fix = runWithRetry. A layout throw escapes child error.tsx."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

Intermittent full-screen `500` on an authenticated route (first seen `/client/jobs/[id]`, "renders fine, then 500s, retry clears it") = a **promise REJECTION** (cold pool / TLS reset / dropped fetch) from a Supabase read in the **portal layout** (`app/{admin,client,inspector,(marketplace)}/layout.tsx`), not the page. The layouts `await` `auth.getUser()` + a `profiles` role read (+ client: `fetchActiveOrgInfo`) on every render; inline guards only checked `{ error }`, so a reject propagated uncaught.

Key Next.js fact: **a throw in a `layout.tsx` escapes EVERY child `error.tsx`** and lands on the global 500 — a sibling/child boundary cannot catch its own parent layout's throw. So the in-portal error card (`app/client/jobs/error.tsx`) and the full-screen 500 were two *different* failures (page-level vs layout-level).

Fix (shipped, LIVE 2026-06-06): `apps/web/src/lib/supabase/resilient.ts` → `runWithRetry(op, {label})` retries a rejected thenable with short linear backoff WITHOUT touching `{ error }` (query errors stay the caller's concern), + `runSafe(op, fallback)`. Both layouts' getUser + profile reads wrapped; persistent failure degrades (getUser→sign-in redirect, profile→owner-by-email) instead of 500. Commits `75aab93 e0d2dd9 2536e64 1f02d4e`.

GOTCHA when wrapping: do NOT cast `res.data as typeof profile` — inside the assignment `typeof profile` resolves to the *narrowed* (`null`) type and collapses downstream usages to `never`. Cast to an explicit inline object type instead.

Pattern is reusable for any Server Component that awaits a network read with no boundary above it (layouts, root pages). See [[project_contract_engine]], [[reference_web_build_typecheck_gated]].
