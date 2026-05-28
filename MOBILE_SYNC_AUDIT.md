# Mobile ↔ Web Synchronization Audit

**Date:** 2026-05-28
**Purpose:** Catalog every web feature shipped in this conversation against its mobile-parity status. Same evidence-anchored format as `SPRINT_12_PLAN.md` and `SPRINT_13_AUDIT.md`.

**TL;DR:** 14 web features shipped this conversation. Of those, **5 already have mobile equivalents** (the foundational data layer — taxonomy, slugs, badges — handles itself via shared-core), **6 are web-only marketing/admin surfaces** that arguably belong on web only, and **3 are genuinely missing from mobile and would benefit from mobile parity**. Realistic mobile sprint to close the meaningful gaps: roughly 2-3 weeks.

---

## Status table

| # | Feature | Web | Mobile | Verdict | Rationale |
|---|---|---|---|---|---|
| 1 | Multi-domain taxonomy (5 domains, 303 kebab specialty slugs, 57 scope templates) | ✅ shipped | ✅ shipped via `@nexpec/shared-core` re-export | **Auto-synced** | Phase 0B unification means the taxonomy is one TS file in shared-core. Mobile imports from `src/data/specialties.ts` which is now a thin adapter to shared-core. Any taxonomy edit reaches both surfaces simultaneously. |
| 2 | `InspectionDomainBadge` for jobs | ✅ shipped | ✅ shipped (Layer 4) | **Auto-synced** | Two implementations (lucide-react vs lucide-react-native) both read from the shared-core meta map. The Phase 5 chemical_process expansion ships on both. |
| 3 | DB schema additions (jobs.domain, inspection_domains, inspection_scope_templates, inspection_evidence_requirements) | ✅ | ✅ via Supabase | **Auto-synced** | DB is the source of truth; mobile reads same Supabase. |
| 4 | Specialty slug canonicalization (kebab-case) + backfill migration | ✅ | ✅ | **Auto-synced** | The SQL backfill (Phase 0B) rewrote `jobs.specialty_slugs` and `profiles.specialty_slugs` in place — both surfaces now read kebab from the same columns. |
| 5 | CalendarSync.ts (mobile native calendar integration) | ✅ via web calendar UI (just shipped) | ✅ shipped earlier | **Already synced both ways** | Mobile uses expo-calendar; web has the new `/inspector/calendar` UI + `.ics` feed. Same source columns (`jobs.scheduled_date`, `jobs.calendar_event_id`). |
| 6 | `/admin/domains` configuration UI | ✅ shipped | ⚠️ N/A | **Web-only by design** | Admin platform-config surfaces don't belong on the mobile inspector app. Internal admins use the desktop console. |
| 7 | `/admin/domains/[slug]/readiness` dashboard | ✅ shipped | ⚠️ N/A | **Web-only by design** | Same reasoning — operational admin tool. |
| 8 | `/admin/users/specialties-bulk` bulk specialty assigner | ✅ shipped | ⚠️ N/A | **Web-only by design** | Admin operational tool. |
| 9 | Public inspector directory `/inspectors` + SEO | ✅ shipped | ⚠️ N/A | **Web-only by design** | Marketing / discovery surface — funnels potential clients into signing up. Mobile is post-signup. |
| 10 | Homepage revamp + PlatformScale section | ✅ shipped | ⚠️ N/A | **Web-only by design** | Marketing surface. |
| 11 | Onboarding checklist dashboard widget | ✅ shipped on `/inspector/dashboard` and `/client/dashboard` | 🔴 **MISSING** | **Mobile gap — high priority** | Inspectors spend more time in the mobile app than on web. The post-signup checklist should nudge them on whichever surface they open first. Derived state (specialty count, cert count, eligibility) works identically against the DB; just needs a mobile component. ~3 days. |
| 12 | 2FA (TOTP enrollment + recovery codes) | ✅ shipped on `/inspector/settings`, `/client/settings`, `/admin/settings` | 🔴 **MISSING** | **Mobile gap — high priority** | Critical for inspectors with payout permissions. Same `supabase.auth.mfa.*` API works on React Native via supabase-js. Recovery codes table + RPCs already shipped. ~5 days (TOTP QR scan UX on mobile, biometric gate at sign-in). |
| 13 | Cmd+K global search overlay | ✅ shipped | 🔴 **MISSING** | **Mobile gap — medium priority** | Mobile UX is different (no Cmd+K keyboard shortcut). The equivalent is a search tab or pull-down. Same `global_search` RPC works. ~4 days for a mobile-native search screen. |
| 14 | Onboarding wizard (signup flow) | ✅ existed pre-Sprint-13 | ✅ already on mobile | **Synced** | Existing flow on both surfaces; the checklist (#11) is the new piece. |

---

## What "Mobile Sync" actually means

There are three categories above. Treating all 14 features as "needs mobile build" overstates the work by 4-5×.

**Auto-synced by architecture (5 items, #1-5):** These are the foundational primitives. They live in shared-core (TypeScript) or in Supabase (DB / RPCs). Web and mobile both consume them through the same import / API. Phase 0B made this true for the taxonomy; the DB layer was always shared. **Zero mobile work needed.**

**Web-only by design (5 items, #6-10):** Admin platform-config tools, marketing surfaces, public SEO pages. Putting them on mobile would be busywork at best, security risk at worst (e.g. surfacing the bulk specialty assigner on a mobile device that gets lost). **Zero mobile work needed; this is correct.**

**Genuine mobile gaps (3 items, #11-13):** Onboarding checklist, 2FA, global search. These are inspector-facing features that the mobile app's primary users (field inspectors) genuinely want.

---

## Per-gap effort estimate

If you decide to close the three real gaps, here's the realistic sprint shape:

### Sprint 13.M1 — Mobile onboarding checklist (~3 days)
- New screen / dashboard widget at `src/screens/inspector/Dashboard.tsx` (or equivalent mobile-router location)
- New data hook `src/hooks/useOnboardingChecklist.ts` that calls the same derived-completion logic from web's `lib/data/onboardingChecklist.ts` (port the role-specific step list to TypeScript shared between surfaces or just re-implement against Supabase queries)
- Dismiss / restore actions using the same `profiles.onboarding_checklist_dismissed_at` column

### Sprint 13.M2 — Mobile 2FA (~5 days)
- `MfaSection` equivalent screen at `src/screens/account/Mfa.tsx`
- TOTP QR display — native components (no `<img>` data URLs; render the SVG directly or use react-native-svg)
- Recovery codes display screen with native share / save-to-files options
- Sign-in flow integration — challenge the user for the 6-digit code after `supabase.auth.signInWithPassword`
- Optional: biometric unlock as a second layer (expo-local-authentication)

### Sprint 13.M3 — Mobile global search (~4 days)
- New tab or modal at `src/screens/Search.tsx`
- Calls the same `global_search` RPC — server-side does all the permission filtering
- Native list rendering with debounced query
- Recent-search history persisted in AsyncStorage

### Total: ~12 working days for one engineer to close the three meaningful mobile gaps.

---

## Recommended sequence

If you want to close mobile parity as its own focused sprint after Sprint 13:

1. **13.M1 — Onboarding checklist** (smallest, highest user-visibility ratio)
2. **13.M2 — 2FA** (security-critical, blocks nothing)
3. **13.M3 — Global search** (cross-cutting, ships with the most polish payoff)

Same per-feature cadence as Sprints 13.1 → 13.5. Each one its own focused conversation, each one shippable in 3-5 days, each one independently mergeable.

---

## What NOT to mobile-sync

Listing these explicitly so future planning sessions don't burn cycles re-considering them:

- **`/admin/*` operational tools** — admins are on desktop. Reproducing the bulk specialty assigner or the readiness dashboard on mobile is a mis-allocation of effort.
- **Marketing surfaces (`/inspectors`, `/`)** — these are SEO-driven public-web surfaces. Mobile is post-signup; users don't browse the marketing site from inside the app.
- **`/p/[userId]` public profile** — accessed via deep link from outside the app; falls into the marketing/SEO bucket.

---

## How to use this doc

1. **Read the status table.** If you disagree with any classification (e.g. you want `/inspectors` browsable inside the mobile app for sub-contractor referrals), flag the row.
2. **Decide which of the 3 real gaps to ship first.** Default recommendation: 13.M1 → 13.M2 → 13.M3.
3. **Per-gap focused conversation.** Same audit-first cadence: I discover the existing mobile architecture (Expo Router stacks, state management library, navigation patterns), propose the implementation, then ship.

The web platform is fully launch-ready as of this sprint. Mobile parity is a polish sprint, not a launch blocker.
