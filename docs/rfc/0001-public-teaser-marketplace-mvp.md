# RFC 0001 — Public "Teaser Marketplace" Feed (MVP / Phase 1)

**Status:** Draft for approval
**Author:** Architecture
**Date:** 2026-06-24
**Scope:** MVP only. Multi-role breadth, per-item SEO pages, and the projection-table graduation are Phase 2/3 (designed-for here, not built here).

---

## 1. Goal

A public, unauthenticated, SEO-indexable feed on the web landing page that mirrors live marketplace activity — **demand** (sanitized job teasers) and **supply** (pseudonymous talent spotlights) — to drive organic acquisition, **without ever emitting PII, exact pricing, or anything that enables off-platform poaching.**

## 2. Locked decisions (from product)

1. **Consent = opt-in AND admin curation.** A user flips a "Feature me publicly" toggle; an admin must additionally flag them to reach the feed.
2. **Enterprise/Agency demand = opt-in (default private).** NDA-safe: a mission is teased only if explicitly marked publicly-listable.
3. **"Vetted/top" = hybrid.** Automated eligibility baseline (verified + min completed jobs + min rating) *gates*; an admin "Featured" flag *promotes*.
4. **Freshness = ~60s ISR.** Prioritize SEO + low DB overhead over realtime.

## 3. Core principle (non-negotiable)

**Privacy by construction, not redaction.** The public surface reads only from purpose-built projections whose column lists physically exclude PII. If `full_name` isn't a column in the feed, no `select('*')`, view edit, or future refactor can leak it. Every privacy property is enforced in SQL (the view's column list + `WHERE` gate), never in the React layer.

---

## 4. What exists today (verified against the live schema)

**The leaks we are closing** — all currently `GRANT … TO anon`:

| Surface | Leak | Location |
|---|---|---|
| `get_marketplace_inspectors(...)` RPC | `display_name` = `COALESCE(full_name, first_name‖last_name, …)` + `avatar_url` | baseline migration |
| `get_public_profile(uuid)` RPC | `display_name` (from real name) + `avatar_url` | baseline migration |
| `get_public_profiles(uuid[])` RPC | same, batch | baseline migration |

**Reusable assets:**

- `nxHandle(id)` — FNV-1a → `NX-XXXXXX` (Crockford alphabet, no I/L/O/U). Mobile: `src/core/utils/handle.ts`. Web: `apps/web/src/lib/identity/inspectorHandle.ts`.
- `supplier_directory` view (anon) — precedent for an anon-granted sanitized projection (note: it exposes `legal_name`, which is acceptable for a *supplier business entity*, **not** for an individual inspector).
- `is_featured`, `verification_status`, `is_verified`, `rating_average`, `completed_jobs_count`, `organization_id`, `is_available` already exist on `profiles`.
- `jobs` already has the `client_id` / `agency_id` **XOR owner** model (`jobs_owner_xor`) + `domain` enum + `specialty_slugs[]` — so polymorphic demand is nearly free.

**Web stack:** Next.js **15.5.18**, App Router. Existing public pages (e.g. `/directory`) are **client-rendered** (`'use client'` + `useEffect`) — invisible to crawlers. The teaser surface will set the correct **RSC + ISR** pattern.

---

## 5. Architecture (MVP)

```
profiles ──┐                          ┌── public_supply_feed (VIEW, anon)  ── independent inspectors
           ├─ [gates in WHERE] ──────►┤
jobs ──────┘                          └── public_demand_feed  (VIEW, anon)  ── open jobs (client/ent/agency)
                                                   │
                                          Next.js RSC + revalidate=60  (server anon client)
                                                   │
                                          CDN-cached HTML  ──►  crawlers + visitors
```

- **MVP delivery = anon-granted VIEWS** (simplest correct thing). The views are owned by a privileged role so they bypass the underlying RLS, which makes the **`WHERE` clause the single security boundary** — it must be airtight, and we set `security_barrier = true` to block predicate-pushdown leaks. (Phase 3 graduates these to a denormalized projection table refreshed by triggers, for true physical isolation + scrape-resistance. Not now.)
- **Polymorphic from day one:** both views expose a `source_kind` column. MVP populates `client_job`/`enterprise_mission`/`agency_tender` on demand (all derivable from `jobs` today) and `independent_inspector` on supply. Phase 2 adds `agency_pool` (supply) and `deal`/`rfq` (demand) by **adding rows, not reshaping the contract.**

### 5.1 Identifier strategy

The feeds emit the **`nx_handle` only — never the raw `profiles.id` / `jobs.id`** to `anon` (the uuid enables cross-surface correlation; the handle is one-way). This requires a **SQL** `public.nx_handle(uuid)` mirroring the TS implementation byte-for-byte (FNV-1a over `'nexpec-handle:'||id`, 6 Crockford chars), with a parity self-test against `handle.ts`. The handle doubles as the future per-talent SEO slug (`/talent/nx-xxxxxx`, Phase 3) via `WHERE nx_handle(id) = $1` — no uuid exposure needed.

---

## 6. The supply feed — `public_supply_feed`

**Population (MVP):** independent inspectors only.

**Eligibility `WHERE` (all required):**
```
role = 'inspector'
AND organization_id IS NULL            -- affiliation-aware: agency talent is NOT shown individually
AND verification_status = 'verified'   -- automated baseline (decision 3)
AND completed_jobs_count >= 3          -- automated baseline (tunable)
AND rating_average >= 4.0              -- automated baseline (tunable)
AND public_listing_opt_in = true       -- consent (NEW flag, decision 1)
AND is_featured = true                 -- admin curation (existing flag, decision 1)
```

**Emitted columns (sanitized):**

| Column | Source | Note |
|---|---|---|
| `handle` | `nx_handle(id)` | pseudonym; **no uuid** |
| `source_kind` | const `'independent_inspector'` | badge |
| `headline` | derived from `specialty_slugs` | e.g. "NDT & Mechanical Expert" — **not** free-text bio |
| `specialty_slugs` | `specialty_slugs` | taxonomy tags |
| `certifications` | `certifications` | **category labels only** (CWI, API-570…); no cert IDs/numbers |
| `location_city`, `location_province` | as-is | exact city retained (per your earlier decision); no street/postal |
| `country` | `country_of_residence` | jurisdiction |
| `rating_average`, `rating_count` | as-is | trust signal |
| `completed_jobs_count` | as-is | trust signal |
| `is_available` | as-is | "Available for dispatch" |
| `is_featured` | const true | "Vetted" sigil |

**Never emitted:** `id`, `full_name`/`first_name`/`last_name`, `email`, `avatar_url`, `bio` (raw), `hourly_rate_cents` (exact rate — GR2 + re-identification risk; a coarse band is a Phase 2 option), `organization_id`.

> **Why no exact rate / no raw bio:** a unique (rate + niche cert + city) tuple can re-identify one person, and free-text bios routinely contain names/links. Both are withheld by construction.

---

## 7. The demand feed — `public_demand_feed`

**Population (MVP):** `jobs` only (covers all three demand roles via the owner model).

**Eligibility `WHERE`:**
```
status = 'open'                 -- live demand only; teaser disappears once assigned
AND public_listable = true      -- consent (NEW flag; default-private satisfies decision 2)
```

**Polymorphic badge (`source_kind`):**
```
agency_id IS NOT NULL                         → 'agency_tender'
ELSE owner(profiles.role via client_id)='enterprise' → 'enterprise_mission'
ELSE                                          → 'client_job'
```
*(Build note: confirm `jobs.agency_id` FK target — `profiles` vs `organizations` — before finalizing the owner join.)*

**Emitted columns (sanitized):**

| Column | Source | Note |
|---|---|---|
| `source_kind` | computed | badge: Client Job / Enterprise Mission / Agency Tender |
| `domain_label` | `domain` enum → human | "Mechanical Field", "Industrial NDT"… |
| `specialty_slugs` | as-is | taxonomy tags |
| `location_city` | as-is | "Montreal area" (city-level only) |
| `country` | `job_country` | jurisdiction |
| `timeframe` | from `scheduled_date` | **coarsened** to "Late June 2026" (early/mid/late + month) |
| `posted_ago` | from `created_at` | "2h ago" liveness |

**Never emitted:** `id`, `title` (raw — may contain client/site name), `client_id`/`agency_id`/`contractor_id` (identities), **any `*_cents`** (`client_price_cents`/`inspector_payout_cents`/`budget_cents` — GR2 price-blindness), exact address, `scheduled_date` (raw).

> **Why not the raw title:** "Acme Corp boiler teardown" fingerprints the buyer. MVP derives the display label from `domain` + `specialty_slugs`. An admin-sanitized headline is a Phase 2 enhancement.

---

## 8. Consent & curation mechanics

**New columns (additive, both default to the private/off state):**

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS
  public_listing_opt_in boolean NOT NULL DEFAULT false;   -- "Feature me publicly" toggle
ALTER TABLE public.jobs     ADD COLUMN IF NOT EXISTS
  public_listable        boolean NOT NULL DEFAULT false;   -- "List this publicly (sanitized)"
```

- **Supply consent:** inspector toggles `public_listing_opt_in` on their profile; admin sets `is_featured`. Feed requires **both** + the automated baseline.
- **Demand consent:** `public_listable` defaults **false** (satisfies decision 2 — enterprise/agency are private until they opt in). The **client** post-job form pre-checks the box (role-based UI default) so individual clients opt in frictionlessly; enterprise/agency forms leave it unchecked with NDA-aware copy. The data layer shows nothing that isn't explicitly flagged — privacy by construction.
- **Admin curation (MVP):** reuse existing `is_featured` editing. A dedicated admin curation console is Phase 2.

---

## 9. Related hardening (same epic)

Because they leak real names to `anon` today, in the same migration set:

1. **`get_marketplace_inspectors`** — pseudonymize (emit `nx_handle`, drop real name/avatar) **and `REVOKE … FROM anon`** (keep `authenticated`; in-app browse still must respect identity-escrow). The public path is the new feed only.
2. **`get_public_profile` / `get_public_profiles`** — `REVOKE … FROM anon` (or pseudonymize). They should not be a public surface.

This gives one coherent story: *close the accidental public leaks; open exactly one intentional, sanitized public surface.*

---

## 10. Web delivery (apps/web)

- New `apps/web/src/lib/data/teaser.ts` — **server** anon Supabase client; `fetchSupplyFeed()` + `fetchDemandFeed()` + `fetchEcosystemStats()`.
- New RSC section on the landing route with `export const revalidate = 60` (ISR) — server-rendered HTML for crawlers, CDN-cached.
- Components: `<RoleBadge>` (the source_kind chips — an ecosystem-depth marketing asset), `<TalentSpotlightCard>`, `<JobTeaserCard>`, `<EcosystemStats>` ("47 inspections this week · 320 vetted inspectors").
- Two-sided CTAs: job teasers → "Inspector? Sign up to apply"; talent → "Need an inspection? Post a job." All engagement routes through sign-up (anti-circumvention preserved).
- Reuse the existing web `nxHandle` util only for display polish; the feed already emits `handle`.

---

## 11. Verification plan

- **Migration self-tests:** views exist; `anon` has `SELECT`; `nx_handle` parity vs `handle.ts` on sample ids; **assert the view column lists contain none of** `full_name,first_name,last_name,email,avatar_url,*_cents,id` (information_schema check) — fail the migration if they do.
- **GR2 guard:** extend `scripts/qa/check-price-blindness.mjs` to scan the new view definitions for `*_cents`.
- **Manual QA (logged-out browser):** names never appear (only `NX-` handles); an opted-out inspector is absent; a non-featured inspector is absent; an **agency-affiliated** inspector is absent (shown only via Phase 2 pool); a filled/assigned job is absent; an enterprise job is absent unless `public_listable`.
- **Leak probe:** as `anon`, `select *` from both feeds → confirm zero PII columns returned.

---

## 12. Rollout (proposed migrations)

1. `…168000_nx_handle_sql.sql` — `public.nx_handle(uuid)` + parity self-test.
2. `…170000_teaser_consent_flags.sql` — add `profiles.public_listing_opt_in` + `jobs.public_listable`.
3. `…172000_public_supply_feed.sql` — fix + revoke-anon `get_marketplace_inspectors`; revoke-anon `get_public_profile(s)`; create `public_supply_feed` (+ anon grant, `security_barrier`).
4. `…174000_public_demand_feed.sql` — create `public_demand_feed` (+ anon grant, `security_barrier`).
5. **Web:** `teaser.ts` data layer + RSC/ISR landing section + components.

Shippable in the same set-by-set rhythm as the security epic. Each migration is additive and idempotent.

## 13. Explicitly out of scope (Phase 2/3)

- `agency_pool` supply rows (aggregate-only, never individual members) + `deal`/`rfq` demand rows.
- Per-item canonical SEO pages (`/talent/[handle]`, `/inspections/[slug]`) + JSON-LD (`JobPosting`).
- Graduation of the views to a trigger-refreshed **projection table**.
- Admin curation console; coarse rate **band**; admin-sanitized job headlines.

## 14. Open items to confirm before build

- `jobs.agency_id` FK target (profiles vs organizations) — affects the owner-role join in §7.
- Eligibility thresholds in §6 (min completed jobs = 3, min rating = 4.0) — OK as defaults?
- For agency-owned jobs, is the desired badge "Agency Tender" (agency sourcing) — confirmed?
