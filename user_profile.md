---
name: user-profile-ebi
description: "Who ebi is, the NEXPEC project/stack, and his communication preferences"
metadata: 
  node_type: memory
  type: user
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

ebi (git author "Ebi <<owner email — configured server-side, not published>>") is building **NEXPEC**, a multi-domain industrial-inspection marketplace.

Monorepo layout: Expo / React Native mobile app at the repo root (`app/` Expo Router, `src/`, `components/`, `hooks/`), a Next.js web app under `apps/web/`, and a Supabase backend (`supabase/migrations`, RPCs, edge functions). Shared TypeScript lives in `@nexpec/shared-core` (taxonomy, specialty groups) and re-exports to both surfaces.

He works on this largely solo and across many sessions, and sometimes switches the underlying model mid-project while expecting seamless continuity ("continue exactly from where we left off").

Prefers concise, direct responses — minimal preamble, no verbose recaps. See [[feedback-working-cadence]] for how he wants the work itself approached.
