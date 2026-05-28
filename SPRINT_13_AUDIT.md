# Sprint 13 — Pre-build Audit

**Date:** 2026-05-28
**Method:** evidence-anchored grep across `supabase/migrations`, `apps/web/src`, `src/`, `supabase/functions`, `.env.example`. Same approach that revealed Sprint 12 was already shipped end-to-end.

**TL;DR:** 1 of the 8 candidate items is substantially shipped, 3 are partial (have the heavy lifting done — need the last 30-50%), 4 are genuinely open. The "10-16 week build everything from scratch" estimate from the strategic-call response collapses to **roughly 4-6 weeks of focused work** to ship a realistic Sprint 13 subset, because much of the foundation is already in production.

---

## Status table

| # | Candidate | Status | Evidence | What's actually missing |
|---|---|---|---|---|
| 1 | Transactional email infrastructure | **🟢 SUBSTANTIALLY SHIPPED** | `20260607120000_notification_email_queue.sql` overlays email-queue fields onto `public.notifications`. Edge function `dispatch-notification-emails` (319 lines, has `templates.ts`). RPCs: `claim_pending_notification_emails`, `mark_notification_email_sent`, `mark_notification_email_failed`, `cron_kickoff_email_dispatch`. Adjacent edge functions: `notify-job-event`, `notify-job-assigned`, `send-consent-receipt`. `.env.example` has `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. | Verify template coverage (which events actually have a template). Possibly an admin email-queue dashboard at `/admin/email-queue` for inspecting failures + manual retry. Bookkeeping not infra. |
| 2 | Two-factor auth (2FA / MFA) | **🔴 OPEN** | Zero migrations matching `2fa|mfa|totp|recovery_code|otp`. Zero MFA code in `apps/web/src`. | Full build. **But** Supabase Auth ships TOTP MFA primitives (`supabase.auth.mfa.enroll/challenge/verify/unenroll`), so the heavy lifting is enrollment UI + recovery codes + lockout policy + settings page wiring, not crypto. Realistic: 1-2 weeks. |
| 3 | Public inspector profiles / directory | **🟡 PARTIAL** | Single profile page `/p/[userId]/page.tsx` exists (276 lines, includes `generateMetadata` for SEO). Renders rating, recommend %, completed jobs. | No directory **listing** route (`/inspectors` and `/directory` both don't exist). Missing pieces: filterable inspector index, handle/slug scheme, sitemap.xml entries, public-readable RLS view that excludes sensitive fields. Realistic: 3-5 days. |
| 4 | Onboarding checklist | **🟡 PARTIAL** | `apps/web/src/components/auth/OnboardingWizard.tsx` ships the full 4-step signup wizard (role → profile → terms → auth method). Migrations `20260518360000_onboarding_profile_columns.sql` + `20260519010000_apply_onboarding_role_rpc.sql` ship the schema. | The post-signup **dashboard checklist** widget tracking "profile complete %, payment method added, first job posted, first specialty selected, …" is missing. The wizard handles day-0; the checklist handles days 1-30. Realistic: 3-5 days. |
| 5 | Scope-change request flow | **🔴 OPEN** | Zero migrations, zero code. | Full build. Schema: `scope_change_requests` table with FK to `jobs`, status state machine, audit columns. Bi-directional approval flow. Integration with the existing contract state machine + the existing notifications/email infra. 3 portal surfaces (client, inspector, admin). Realistic: 1-2 weeks. |
| 6 | Bulk job posting | **🔴 OPEN** | Zero migrations, zero code. | Full build. CSV upload UI, schema mapping, per-row validation, atomic batch insert RPC, error reporting page, `bulk_job_uploads` tracking table. Primarily an admin tool, secondarily an enterprise client tool. Realistic: 1 week. |
| 7 | Inspector calendar | **🟡 PARTIAL** | Mobile: `src/services/CalendarSync.ts` wraps `expo-calendar` for native calendar sync; `src/examples/CalendarSyncExample.tsx` exists. Schema: `20250316125200_add_calendar_event_id.sql` adds `jobs.calendar_event_id` + `jobs.calendar_synced_at` + index. | Web inspector calendar view is open (mobile-only today). Missing pieces: `/inspector/calendar` page with month/week views, conflict detection across jobs, iCal export. Realistic: 1-2 weeks. |
| 8 | Global search | **🔴 OPEN** | Zero tsvector columns across any migration. Zero `GlobalSearch` / `CommandPalette` / Cmd+K code in `apps/web/src`. | Full build. Choose between Postgres FTS (`tsvector` + GIN index) or an external service. Cross-entity search (jobs, inspectors, clients, scope templates). Cmd+K overlay UI. Permission-aware result filtering. Realistic: 1-2 weeks. |

---

## Bucket summary

- **🟢 Substantially shipped (1):** transactional email — needs polish + admin visibility, not a rewrite
- **🟡 Partial (3):** public profiles directory, onboarding checklist, inspector calendar — each is a **finish, not a start**
- **🔴 Genuinely open (4):** 2FA, scope-change request, bulk job posting, global search

---

## Recommended order for the next 4-6 weeks

Optimised for **E2E-readiness** (Cowork's stated goal):

| Order | Item | Why this slot | Realistic effort |
|---|---|---|---|
| 1 | **Onboarding checklist** | New-user flows are the highest-leverage E2E paths. Checklist closes the loop on the existing wizard. Partial → done. | 3-5 days |
| 2 | **Public inspector directory** | Closes the marketing → conversion funnel. Public-facing, easy to E2E. Partial → done. | 3-5 days |
| 3 | **2FA** | Security-critical, well-trodden path on Supabase Auth primitives, blocks nothing. Open → done. | 1-2 weeks |
| 4 | **Global search** | Enables cross-feature discoverability in E2E specs. Open → done. | 1-2 weeks |
| 5 | **Inspector calendar (web)** | Mobile already has it; web parity is a defined gap, low ambiguity. Partial → done. | 1 week |

That's roughly **4-5 weeks of focused work** to ship the most valuable 5 items. Each ships as its own per-feature commit, same cadence as the catalogue sprint and the readiness dashboard.

## Explicitly deferred to post-E2E

- **Scope-change request flow** (#5) — large multi-portal feature, best built when E2E coverage of the contract state machine already exists
- **Bulk job posting** (#6) — enterprise feature, low E2E utility, ships after first enterprise pilot validates the schema
- **Email template depth + admin queue dashboard** (#1 follow-on) — current infra works; expansion is bookkeeping, do it as operational needs surface

---

## How to use this doc

1. **Read the status table.** If you disagree with any of the classifications, flag the row — I'll dig deeper.
2. **Pick the order.** The recommended sequence is one valid option; reorder if your priorities differ (e.g. if 2FA is contractually required, move it up).
3. **Per-item kickoff.** Each item gets its own focused conversation: I do a deeper audit on the partial state (where applicable), propose the build with you, ship it. Same cadence that's worked for everything in this conversation.

---

## Why not "build all 8 in one push"

Two hard reasons:

1. **The Sprint 12 lesson.** Half of Sprint 12 was misclassified as open when it had shipped weeks earlier. Building from a stale plan wasted 30 minutes of audit time to discover, and would have wasted multiple days of rewriting. The audit-first pattern is mandatory now.
2. **The precision rule.** The "DO NOT break or alter existing UI/UX" requirement is in direct tension with parallel-developing 8 features against a single codebase. Every partial item touches an existing surface — finishing them well means careful per-surface review, not parallel sprawl.

The audit-first pattern lets us ship 5 of these 8 items with confidence in the same time it would take to build a single one from scratch under the precision rule.
