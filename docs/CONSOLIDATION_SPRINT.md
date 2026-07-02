# NEXPEC Consolidation Sprint — Health, Parity & Feature Inventory
_Audit date: 2026-06-25 • Scope: web (`apps/web`), database/RLS (`supabase/`), mobile (root Expo `app/` + `src/`)_

---

## Executive summary (the bill of health)

**Not a clean bill — one CRITICAL security finding, plus mobile RLS breakage and known TS debt.**

| Area | Verdict |
|---|---|
| 🔴 **Database RLS** | **CRITICAL.** ~28 public tables are **RLS-off *and* anon-granted** — wide open to anyone with the public key. Several hold money, contracts, documents, chat, credentials. The sweep that found the `messages`/`payment_methods` holes was the tip of the iceberg. |
| 🟠 **Mobile ↔ new RLS** | 3 mobile data paths will break or misbehave under the RLS we just hardened (`work_orders` dashboards, `legal_consents` consent flow, `messages` reads need confirming). |
| 🟢 **Web feature code** | Healthy. Everything we shipped is type-clean; ~37 pre-existing lucide/Suspense TS errors remain (gated by `next.config` flags — non-blocking, tech debt). |
| 🟡 **Mobile TS** | ~3.5k pre-existing root-tsc errors; **does not gate the EAS binary** (Babel strips types). Tech debt, not a release blocker. |
| 🟢 **Mobile feature breadth** | Large and mature — arguably broader than web in field tooling (offline, barcode, on-device AI, camera capture). |

---

# PHASE 1 — Deep Audit

## 1A. 🔴 CRITICAL: RLS-off + anon-open tables

Computed across the **entire migration history** (baseline + all 2026 migrations, accounting for every `ENABLE ROW LEVEL SECURITY` and `REVOKE … FROM anon`). These tables have **no RLS and an active `anon` grant** → readable/writable/deletable by anyone with the public anon key:

**🔴 High-severity (money / contracts / PII / chat):**
`inspector_earnings`, `platform_wallet`, `payment_audit_log`, `signed_agreements`, `documents`, `project_documents`, `inspector_documents`, `chat_rooms`, `job_messages`, `certifications`, `inspector_certifications`, `push_token_history`

**🟠 Medium (operational / user data):**
`assets`, `equipment`, `projects`, `milestones`, `form_submissions`, `form_drafts`, `form_templates`, `work_experience`, `activity_logs`, `notification_settings`, `admin_notification_settings`, `alerts`, `badges`, `user_badges`, `error_logs`, `legal_templates`

> **Caveat (read before panic):** this is derived from migration text, which is the source of truth for what's deployed — but (a) some of these are likely **legacy/empty** tables superseded by newer ones (`projects`→`jobs`, `assets`→`inspection_assets`, `job_messages`/`chat_rooms`→`conversations`/`messages`), and (b) a table being anon-granted only matters if it actually holds data. The **authoritative confirmation** is one query against the live DB.

**Run this against prod (and local) to get the definitive live list:**
```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', format('public.%I', c.relname), 'SELECT') as anon_can_select,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policy_count
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relrowsecurity = false
  and has_table_privilege('anon', format('public.%I', c.relname), 'SELECT') = true
order by 1;
```
Any row returned = a live open table. Cross-check row counts (`select count(*) from <t>`) to separate live-and-dangerous from legacy-and-empty.

**Recommended remediation (its own hardening epic, same discipline as 196000):**
1. For each confirmed-live table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` + `REVOKE ALL … FROM anon[, authenticated];` + add owner/party-scoped policies + the god-mode admin overlay.
2. For confirmed-legacy/empty tables: `REVOKE ALL … FROM anon, authenticated;` and `ENABLE RLS` with no policy (deny-all) — or drop them if truly dead.
3. **A `rls_open_tables_test.sql` pgTAP guard** asserting `anon` can't `SELECT` any non-reference table, so the CI gate (`db-tests.yml`) blocks this class forever.

## 1B. `USING(true)` policy status

- **Fixed (migrations 192000/194000/196000):** `messages` allow-all read, `messages` loose insert, `payment_methods` ×3, `work_orders` ×8, `legal_consents` read leak.
- **Still present, intentional:** reference-data reads (`country_codes`, `fx_rates`, `inspection_domains`, `inspector_skills`, `review_weights_config`, `platform_settings`, `courses`, `knowledge_base`) and `service_role`-scoped policies on the deal spine — these are fine (`service_role` bypasses RLS anyway; reference tables are meant to be public).
- **Watch:** `legal_consents` "Enable insert for all users" `WITH CHECK(true)` was **kept** (pre-auth consent capture) — it lets a caller insert a consent with any `user_id` (forge risk). Acceptable for now; revisit if the consent flow can be made post-auth.

## 1C. 🟠 Mobile flows broken by the new RLS

| Table | Mobile path | Verdict | Fix |
|---|---|---|---|
| `work_orders` | `src/hooks/useOperationsData.ts` — `.eq('organization_id', orgId)` only | **BREAKS** — RLS now needs owner/membership; dashboards may show empty | Confirm the new policy allows org members; our `work_orders_owner_all` keys off `owner_id/client_id/inspector_id/user_id`, **not `organization_id`** → likely empty. Add an org-membership read path or switch the hook to `jobs`. |
| `legal_consents` | `src/services/consentService.ts` — `checkConsent(userId)` reads by **param**, `saveConsent(userId)` inserts by param | **BREAKS** if `userId ≠ auth.uid()` or pre-auth read | Refactor to `auth.uid()`; consent **read** now owner/admin-only (insert still works). |
| `messages` | `src/core/chat/messages.ts`, `chatService.ts` — insert `sender_id=auth.uid()` ✅; SELECT by `job_id`/`room_id` | **NEEDS-CHECK** | Insert is safe. Reads rely on `job_id`/`room_id` scoping — but note mobile also uses `job_messages` + `chat_rooms` (the **open** legacy tables in 1A), so mobile chat may be running on the unguarded tables entirely. Reconcile mobile onto `conversations`/`messages`. |
| `payment_methods` | `app/profile/payments.tsx` — scoped to `auth.uid()` | **SAFE** | none |

## 1D. TypeScript

- **Web (`apps/web`):** all code shipped this sprint is type-clean (verified per set). ~37 pre-existing errors (lucide icon typings + a Suspense boundary) remain, suppressed by `next.config` `ignoreBuildErrors`/`ignoreDuringBuilds`. Real gate: `npm run typecheck -w @nexpec/web`. **Action:** burn down the 37 and remove the flags.
- **Mobile (root Expo):** ~3.5k root-`tsc` errors, overwhelmingly from broad config/legacy areas. **Does not gate the EAS build** (Babel strips types). Tech debt; not a blocker.

---

# PHASE 2 — Mobile Parity

The mobile app is **mature and broad** (266 screen files; full role coverage, offline, native tooling). The new web work is mostly **web-appropriate** (public SEO surfaces don't belong in a logged-in app). Here's the precise picture.

| New web capability | Mobile status | Notes / where it'd live |
|---|---|---|
| Public Teaser Marketplace `/discover`, `/talent`, `/agency`, `/inspections` | ❌ **Absent** (correct) | Public SEO surfaces are web-only by nature. Mobile has *authenticated* `browse-jobs`, `inspector-directory`. |
| RSS/JSON syndication feeds | ❌ **Absent** (correct) | Web-only by design. |
| RFQs / procurement / supplier directory | ✅ **Present** | `app/rfqs/*`, `app/suppliers/*`, `src/hooks/useSupplierEcosystem.ts` (anti-poaching NX- handles, quote→award→sign). |
| Agency Team Workspaces — org members + invitations | ✅ **Present (core)** | `app/(client)/team.tsx` mirrors `/client/team` (roster, invite/revoke, roles). |
| Team **Missions** list (org's jobs) | ⚠️ **Missing** | Web `client/team-missions`. Backed by `nx_team_jobs` RPC — mobile would just call it. |
| **In-mission team chat** + pseudonymous attribution | ⚠️ **Missing** | Web `client/jobs/[id]/chat`. Mobile has general job chat but not the org-team buyer-thread surface. |
| Team **notification fan-out** | ✅ **Backend (automatic)** | The `tg_notify_messages` fan-out is DB-side → mobile push already delivers them; no mobile change needed beyond deep-link targets. |
| Admin marketplace curation | ⚠️ **Partial** | Mobile has supplier verification + live-radar, not the feature/unfeature curation console. |

### Mobile sync plan (priority order)
1. **🔴 RLS breakage fixes first** (Phase 1C) — `work_orders` (operations dashboards), `legal_consents` (consent flow), and reconcile mobile chat onto `conversations`/`messages` (it appears to ride `job_messages`/`chat_rooms`, which are in the open-table list). This is **release-blocking** for the mobile build against the hardened DB.
2. **🟠 Team Missions + in-mission team chat** — small: call `nx_team_jobs`, reuse the existing mobile chat thread filtered to the `job_client_admin` conversation; add the `senderRoles` pseudonymous labels.
3. **🟢 Nice-to-have** — deep-link the team notifications to the right mobile screen; agency aggregate display parity.

---

# PHASE 3 — Master Feature Inventory (Web vs Mobile)

Legend: ✅ full · ⚠️ partial · ❌ absent · ➖ N/A (platform-inappropriate)

### Auth & onboarding
| Feature | Web | Mobile |
|---|---|---|
| Google SSO | ✅ | ✅ |
| Apple SSO | ✅ | ✅ |
| LinkedIn SSO (OIDC) | ✅ | ✅ |
| Email/password | ✅ | ✅ |
| Magic-link / token bridge | ✅ | ⚠️ |
| Biometric (Face/Touch ID) | ➖ | ✅ |
| 2FA / MFA (TOTP) | ✅ | ⚠️ (prepared) |
| Role selection + onboarding wizard/checklist | ✅ | ✅ |
| Org invitation accept | ✅ `orgs/accept/[token]` | ✅ |

### Public / marketing / SEO (web-native)
| Feature | Web | Mobile |
|---|---|---|
| Landing page + marketing sections | ✅ | ➖ |
| `/discover` teaser marketplace (ISR) | ✅ | ❌ |
| `/talent/[handle]` (Person/ProfilePage JSON-LD) | ✅ | ❌ |
| `/agency/[handle]` (Organization JSON-LD) | ✅ | ❌ |
| `/inspections/[slug]` (JobPosting JSON-LD → Google Jobs) | ✅ | ❌ |
| `/p/[userId]` anonymized trust card | ✅ | ⚠️ (`cert/[slug]` public cert) |
| Public inspector directory | ✅ | ⚠️ (auth-only) |
| RSS `/feed.xml` + JSON `/feed.json` | ✅ | ➖ |
| sitemap.xml + robots.txt | ✅ | ➖ |

### Client / Agency / Enterprise portal
| Feature | Web | Mobile |
|---|---|---|
| Dashboard + metrics | ✅ | ✅ |
| Post / list / detail jobs | ✅ | ✅ |
| Applications review + rate inspector | ✅ | ✅ |
| Team members + invitations (roles) | ✅ | ✅ |
| **Team Missions** (org jobs list) | ✅ | ⚠️ |
| **In-mission team chat** (pseudonymous attribution) | ✅ | ⚠️ |
| Budget envelopes + approval policies | ✅ | ⚠️ |
| Invoices list + detail | ✅ | ⚠️ (finance tab) |
| Finance / spend analytics | ✅ | ✅ |
| RFQs + supplier directory | ✅ | ✅ |
| Contracts + e-signature | ✅ | ✅ |
| Disputes | ✅ | ✅ |
| Documents / Evidence Vault | ✅ | ✅ |
| Org structure / departments | ✅ | ⚠️ (minimal) |
| Branding / white-label | ✅ | ✅ |
| Preferred inspector network | ⚠️ | ✅ (`network`) |
| Live radar / risk heatmap | ⚠️ | ✅ |

### Inspector portal
| Feature | Web | Mobile |
|---|---|---|
| Dashboard | ✅ | ✅ |
| Browse + apply to jobs | ✅ | ✅ |
| Assignments | ✅ | ✅ |
| Submit inspection report | ✅ | ✅ |
| Flash report / NCR | ✅ | ✅ |
| Seal report (provable-AI) | ⚠️ | ✅ (`seal-report`) |
| **On-device AI Co-Inspector** (vision) | ⚠️ (page) | ✅ (live capture) |
| **Native camera compliance capture** | ➖ | ✅ |
| **Barcode / QR asset scanner** | ❌ | ✅ |
| **Voice findings drafter** | ✅ (composer) | ✅ |
| **Offline outbox + SQLite sync** | ➖ | ✅ |
| Wallet / withdrawal / Stripe Connect | ✅ | ✅ |
| Certifications / cert wallet | ✅ | ✅ |
| Equipment / experience / documents | ✅ | ✅ |
| Tax center | ✅ | ✅ |
| Calendar / scheduling | ✅ | ⚠️ |
| Negotiations + coordination bridge | ✅ | ⚠️ |
| Maps (browse jobs) | ⚠️ | ✅ (`browse-jobs-map`) |

### Supplier portal
| Feature | Web | Mobile |
|---|---|---|
| Dashboard + matching | ✅ | ✅ |
| Opportunities + bid/quote | ✅ | ✅ |
| Award → agreement sign → milestone escrow | ✅ | ✅ |
| Onboarding | ✅ | ✅ |
| Finance / payouts | ✅ | ✅ |
| Documents | ✅ | ✅ |

### Admin / Super-admin console
| Feature | Web | Mobile |
|---|---|---|
| Dashboard | ✅ | ✅ |
| Audit trail (event log + diff) | ✅ | ✅ |
| Jobs + moderation | ✅ | ✅ |
| **Dispatch / Spread Editor** (price-set) | ✅ | ⚠️ (pending-assignments) |
| RFQ moderation | ✅ | ⚠️ |
| Contracts / MSA | ✅ | ✅ |
| Messages / support chat | ✅ | ✅ |
| Disputes | ✅ | ✅ |
| Reviews moderation | ✅ | ✅ |
| Treasury / payouts / reconciliation | ✅ | ✅ (financial) |
| Supplier releases | ✅ | ⚠️ |
| Tax Center (reveal/verify/exempt) | ✅ | ⚠️ |
| Users + roles | ✅ | ✅ |
| Orgs + department structure | ✅ | ⚠️ |
| Invoices | ✅ | ⚠️ |
| Documents / vault | ✅ | ⚠️ |
| Compliance + templates | ✅ | ✅ (CCI apps) |
| **Marketplace curation** (feature/unfeature) | ✅ | ❌ |
| Domains / white-label | ✅ | ❌ |
| Verification workflow | ⚠️ | ✅ |
| Diagnostics | ✅ | ⚠️ |

### Cross-cutting / platform
| Feature | Web | Mobile |
|---|---|---|
| Escrow / money-flow (internal ledger) | ✅ | ✅ |
| Strict price-blindness | ✅ | ✅ |
| Brokered deal spine (contract-before-money) | ✅ | ✅ |
| Identity escrow + NX- pseudonyms + Trust Sigil | ✅ | ✅ |
| Provable-AI seals / evidence pack / passport | ✅ | ✅ |
| Named-Disclosure Stripe settlement | ✅ | ⚠️ |
| Push notifications | ➖ | ✅ |
| In-app notification feed | ✅ | ✅ |
| **DB-enforced chat silos + team RLS** | ✅ | ⚠️ (mobile may ride legacy chat tables) |
| **pgTAP guard suite + CI gate** | ✅ (repo-wide) | ✅ (repo-wide) |
| Social syndication (ports & adapters) | ✅ | ➖ |
| i18n / locale | ✅ | ✅ (language setting) |
| Global search | ✅ | ⚠️ |

### Platform-native exclusives
- **Mobile-only:** barcode/QR asset scanner, offline outbox + SQLite, on-device AI Co-Inspector vision, native camera compliance capture, biometric login, push notifications, voice drafter.
- **Web-only:** public Teaser Marketplace + all SEO surfaces, RSS/JSON syndication, admin marketplace curation, domains/white-label, Team Missions + in-mission team chat, global search.

---

## Recommended next sprint (priority)
1. **🔴 RLS open-table lockdown epic** — confirm the live list (query above), enable RLS + scope + revoke anon on every live table, add the `rls_open_tables_test.sql` CI guard. _This is the single most important item on the board._
2. **🟠 Mobile RLS reconciliation** — fix `work_orders`/`legal_consents` access and migrate mobile chat onto `conversations`/`messages` (off the open `job_messages`/`chat_rooms`).
3. **🟢 Mobile feature parity** — Team Missions + in-mission team chat.
4. **🟡 TS debt** — burn down the web's 37 errors (remove `ignoreBuildErrors`); chip at mobile root-tsc config.
