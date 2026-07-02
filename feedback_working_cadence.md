---
name: feedback-working-cadence
description: "The development cadence/direction ebi wants kept consistent on NEXPEC (audit-first, per-feature commits, precision rule)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

Keep the established NEXPEC working direction consistent across sessions.

**Rules:**
- **Audit-first.** Before building anything, grep the codebase for evidence of what already exists (migrations, `apps/web/src`, `src/`). Sprint 12 was half-misclassified as "open" when it had already shipped — audit-first is now mandatory. The `SPRINT_13_AUDIT.md` / `MOBILE_SYNC_AUDIT.md` evidence-table format is the house style.
- **Per-feature conventional commits**, e.g. `feat(mobile/search): Sprint 13.M3 — …`, with a descriptive multi-line body. One feature = one independently-mergeable commit.
- **Precision rule:** do NOT break or alter existing UI/UX. Make minimal, scoped changes; mirror existing components and their placement rather than inventing new patterns (e.g. the mobile search bar was placed exactly where the 13.M1 onboarding checklist already lived).
- **Web↔mobile parity is intentional, not automatic.** Web features are mirrored to mobile only when they belong there; admin/marketing/SEO surfaces stay web-only. Taxonomy + DB live in shared-core/Supabase and auto-sync both surfaces.

**Why:** ebi explicitly asked to "keep the same structure, logic, and development direction we already established."
**How to apply:** default to this cadence for any NEXPEC work without being re-told. See [[reference-sandbox-git]] for the commit mechanics in this sandbox.
