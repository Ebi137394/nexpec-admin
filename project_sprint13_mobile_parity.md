---
name: project-sprint13-mobile-parity
description: "Status of the Sprint 13 mobile-parity sub-sprint (M1-M3) on NEXPEC, plus the pre-existing tsc-error caveat"
metadata: 
  node_type: memory
  type: project
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

Sprint 13 (web) is closed. The mobile-parity follow-on defined in `MOBILE_SYNC_AUDIT.md` had three real gaps; all now shipped:

- **13.M1** mobile onboarding checklist — commit `643684f`
- **13.M2** mobile 2FA recovery-codes lane — commit `04c0b7a`
- **13.M3** mobile global search — commit `5907508` (2026-05-28, completed this session). New `src/shared-ui/search/GlobalSearchModal.tsx` + `GlobalSearchBar.tsx`, wired into the `(tabs)` and `(inspector)` dashboards. Backed by the `global_search` RPC (`supabase/migrations/20260703120000_global_search_rpc.sql`). Mirrors `apps/web/src/components/search/GlobalSearch.tsx`. Jobs open a native screen (`/(tabs)/jobs/[id]`); inspector profiles + scope templates deep-link to the web app (no native screen yet).

**Why / notes:**
- `MOBILE_SYNC_AUDIT.md` is a point-in-time snapshot — it was NOT edited when M1/M2 shipped, so M3 followed the same pattern (no doc edit on ship).
- The repo has **pre-existing** strict-`tsc` errors in `src/core/supabase/supabase.ts`, `src/hooks/useOnboardingChecklist.ts`, and `src/roles/inspector/hooks/useInspectorData.ts` (Supabase type-inference friction). The Expo/Babel build does not gate on `tsc`, so these are NOT regressions — never attribute them to new work.

**How to apply:** the mobile-parity arc is complete. If ebi wants to go further, the next candidates are native inspector-profile and scope-template screens (currently web deep-links). Deferred-to-post-E2E items per the audit: scope-change request flow, bulk job posting, email-template depth.
