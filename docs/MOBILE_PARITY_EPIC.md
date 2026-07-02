# Mobile Parity Epic — Architectural Execution Plan
_2026-06-25 • Goal: align the Expo app with the hardened backend, clear the P0/P1 debt, and bring the new Web capabilities (Teaser Feed, Team Missions, Team Chat) to mobile — including the new Ghost-Mode internal team chat. All interfaces below verified against the live schema/migrations._

## Verified ground truth this plan builds on
- **`send_message` RPC does NOT exist** (0 hits in SQL). `useChat.ts` calls `rpc('send_message', {p_room_id,…})`, it errors, and the hook silently **falls back to a raw `room_id` insert** — which has no `conversation_id` and is therefore **already denied** by the hardened `messages` policies for non-admins. So the P0 is broader than "legacy screens": *every* mobile send path is currently conversation_id-blind.
- **`messages` policies all key off `conversation_id`** (`msg_insert_party`, `msg_select_via_conv`, `view_chat_msgs`, `msg_team_*`); `room_id`/`job_id`-only rows are invisible/insertable only by admins (`nx_is_admin()` bypass) → hides in testing.
- **`ensure_job_conversation(p_job_id uuid, p_kind text)`** exists, SECURITY DEFINER, **rejects any kind ≠ `job_client_admin`/`job_inspector_admin`**, sets `conversations.user_id = auth.uid()` (the caller), idempotent on `(job_id, kind, user_id)`. → For a *shared* team-internal room this per-caller ownership is wrong; we need a principal-owned variant.
- **`conversation_kind` enum** = `{job_client_admin, job_inspector_admin}` only → must `ADD VALUE 'job_team_internal'`.
- **`conversations`** cols: `id, job_id, client_id, contractor_id, kind, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, …`. `user_id` is the owning principal the team-RLS helper matches on.
- **Feeds (anon-readable projection tables):** `public_demand_feed(ref, source_kind, domain, specialty_slugs, location_city, country, timeframe, posted_at)`; `public_supply_feed(handle, source_kind, specialty_slugs, certifications, location_city, location_province, country, rating_average, rating_count, completed_jobs_count, is_available, is_featured, pool_size, rate_band)`. Price-free + pseudonymous by construction.
- Next migration slot: **`20260801198000`+** (196000 was the last).

> ⚠️ **Sequencing is live-coupled.** If `192000`/`194000` are already in prod, mobile chat is broken **right now** for non-admins. Phase 1 (the `send_message` RPC + backfill + refactor) is the emergency fix and ships first. Backend migrations land **before** the mobile binary that depends on them.

---

# PHASE 1 — P0: Chat realignment onto `conversation_id` (emergency)
**Goal:** every mobile chat read/write goes through a conversation_id the RLS recognizes. No raw `job_id`/`room_id` inserts remain.

### 1.1 Create the missing `send_message` RPC _(migration `198000`)_
`send_message(p_conversation_id uuid, p_content text, p_attachment_url text DEFAULT NULL, p_attachment_type text DEFAULT NULL, p_attachment_name text DEFAULT NULL) RETURNS public.messages`, `LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp`:
- assert `auth.uid()` is a party to `p_conversation_id` (reuse the `msg_insert_party` predicate, or call a shared `nx_can_post_conversation(uuid)` helper so RLS + RPC share one source of truth);
- `INSERT INTO messages(conversation_id, sender_id, content, attachment_*) VALUES (p_conversation_id, auth.uid(), …)`;
- bump `conversations.last_message_at/last_message_preview` + the correct unread counter;
- `RETURN` the inserted row.
- `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated, service_role;`
- Self-test: function exists, is SECURITY DEFINER, anon has no EXECUTE.

### 1.2 Backfill `conversation_id` on legacy rows _(migration `200000`)_
Existing `messages` with `conversation_id IS NULL` are now invisible. For each distinct `(job_id)` with legacy messages, ensure a `job_client_admin`/`job_inspector_admin` conversation exists (derive side from `sender_id` vs `jobs.client_id`/`contractor_id`) and `UPDATE messages SET conversation_id = … WHERE conversation_id IS NULL`. Guard with row counts in a self-test; this is data-touching, so run it idempotently and log affected counts.

### 1.3 Refactor the mobile chat layer
Standardize on the modern path (`useConversations.ensureJobConversation` → `send_message`). Touch:
- `src/core/chat/hooks/useChat.ts` — drop the `room_id` rpc args + the raw-insert fallback; send via `send_message(conversationId, …)`; key state on `conversationId`.
- `src/core/chat/messages.ts` — **delete `getChatRoomId()`** (the `${jobId}-admin-${userId}` string-keying); reads/writes by `conversation_id`.
- `src/core/chat/chatService.ts` (L67/105/131) — `from('messages')…eq('conversation_id', …)`; insert via `send_message`.
- `app/messages/[id].tsx` (L184/201), `app/messages/[jobId].tsx` (L460/619), `app/chat/[job_id].tsx` (L216/287/369), `app/(admin)/communications/index.tsx` — resolve `conversationId = ensureJobConversation(jobId, kind)` on mount; all sends → `send_message`; all selects `.eq('conversation_id', conversationId)`.
- `app/(tabs)/index.tsx`, `app/(inspector)/super-dashboard.tsx`, `admin-inbox.tsx` (unread/listing reads) — read `conversations` + counters, not raw `messages.job_id`.

### 1.4 Realtime
Re-key subscriptions to `filter: 'conversation_id=eq.${conversationId}'` (replaces the unfiltered global `messages` binding — fixes P2-2 at the same time).

### 1.5 Verification gate
- New pgTAP `rls_messages_silo_test.sql`: (a) non-admin insert with NULL `conversation_id` **denied**; (b) party insert via `send_message` **allowed**; (c) cross-party read/insert **denied**; (d) admin read allowed. Wire into `db-tests.yml`.
- Manual: inspector↔admin and client↔admin send/receive on a fresh build against the hardened DB.
- **Commits:** `feat(db): add send_message rpc`, `fix(db): backfill messages.conversation_id`, `refactor(mobile): route chat through conversation_id + send_message`, `test(db): messages silo deny-matrix`.

---

# PHASE 2 — P1: Schema-drift & security cleanup (mechanical, parallel)
**Goal:** kill the PostgREST 400s and the forge vectors. Each is small and independent.

- **2.1 `inspector_documents`** — table is `{id, inspector_id, doc_name, file_url, expiry_date, status, created_at}`. Either (a) migration `ADD COLUMN reviewed_at timestamptz, reviewed_by uuid` (keep the audit trail — recommended), then keep the writes; or (b) drop the phantom writes. Fix `app/(admin)/verification/index.tsx` (L99/127) + `app/(admin)/users/[id].tsx` (align `document_type`/`document_url` → `doc_name`/`file_url`). Commit: `fix(mobile): inspector_documents review columns`.
- **2.2 `profiles` drift** — replace `years_experience` → `experience_years` and `is_featured` → `public_listing_featured` in `app/(tabs)/profile.tsx` (L188), `app/(agency)/jobs/[id].tsx` (L1130), `app/(client)/explore/index.tsx` (L402/514). Commit: `fix(mobile): profiles column drift (experience_years/public_listing_featured)`.
- **2.3 `consentService.ts`** — resolve `auth.uid()` inside `saveConsent`/`checkConsent`; assert `userId === user.id`; never trust the param. Commit: `fix(mobile): bind legal_consents to auth.uid()`.
- **2.4 `work_orders`** — either migration adds an org-membership read path (`organization_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())`) to the policy, or repoint `useOperationsData.ts` to `nx_team_jobs()`/`jobs`. Pick based on whether ops should be org-wide (likely yes → add the policy). Commit: `fix(db|mobile): work_orders org-scoped operations read`.
- **2.5 Web payout trigger** — migration hotfix L14260 logic to `payout_status = 'paid'`. Commit: `fix(db): payout trigger valid status only`.
- **Gate:** `supabase test db` green; a fresh build loads profile tab + admin verification without 400s.

---

# PHASE 3 — Teaser Feed & Team Missions (mobile UI on the new backend)
**Goal:** native RN screens consuming the projections, price-blind by construction.

- **3.1 Public Teaser Feed** — new screen(s) (e.g. `app/(public)/discover.tsx` or a tab) reading `public_supply_feed` (Inspector Spotlights) + `public_demand_feed` (Job Teasers) via the **anon** client. Render `handle` (NX- pseudonym, already in the projection), `rate_band` (coarse), `specialty_slugs`, location, ratings, `is_featured`. **Never** fetch `jobs`/`profiles` directly here — the projection is the only source, so price/identity can't leak. Mirror the web `lib/data/teaser.ts` field mapping for consistency.
- **3.2 Team Missions** — screen under `app/(client)/team-missions.tsx` calling `supabase.rpc('nx_team_jobs')` → `{id, title, status, domain, location_city, scheduled_date, created_at, contractor_id, can_manage}` (price-free by design). `can_manage` gates actions; viewers are read-only.
- **3.3 In-mission team chat** — reuse the Phase-1-fixed chat against the **shared `job_client_admin`** conversation (`ensureJobConversation(jobId,'job_client_admin')`), with pseudonymous attribution (`sender_role` + NX- handle), matching the web `MessageThread` `senderRoles` behavior.
- **Gate:** price-blindness check (no `*_payout`/`*_spread`/`client_price` reachable on these screens); `tsc`; visual parity with web.
- **Commits:** `feat(mobile): public teaser feed`, `feat(mobile): team missions list`, `feat(mobile): in-mission team chat`.

---

# PHASE 4 — Ghost-Mode Internal Team Chat (new feature)
**Goal:** a private team-only thread per mission; Super Admin has invisible read access.

### 4.1 Enum value _(its own migration `2xx000`, committed before any use)_
`ALTER TYPE public.conversation_kind ADD VALUE IF NOT EXISTS 'job_team_internal';` — **must be a standalone migration** (an enum value can't be added and used in the same transaction). No other DDL in this file.

### 4.2 Principal-owned shared room RPC _(next migration)_
New `ensure_team_internal_conversation(p_job_id uuid) RETURNS uuid`, SECURITY DEFINER — **do not overload `ensure_job_conversation`** (avoids the new-arity drop dance and keeps semantics clean):
- assert caller is a **teammate** (shares an org with `COALESCE(jobs.agency_id, jobs.client_id)` via `org_members`);
- `user_id = COALESCE(agency_id, client_id)` (the **principal**, not the caller) so the room is shared;
- idempotent on `(job_id, kind='job_team_internal')` **alone** → one internal room per mission.

### 4.3 RLS — team access + Ghost admin read
- `conv_team_internal_select` / `msg_team_internal_select` — teammates SELECT where `kind='job_team_internal'` and principal-owned (new helper `nx_can_team_access_internal(uuid)` mirroring `nx_can_team_access_conversation` but for the new kind).
- `msg_team_internal_insert` — teammates, **non-viewer**, post via `send_message`.
- **Ghost read is already granted**: `msg_select_via_conv` and "Admins can read ALL messages" include `nx_is_admin()` → Super Admin can read these messages with no new grant. ✅
- **Block admin posts (integrity of the ghost):** add `AS RESTRICTIVE` insert policy on `messages` → `WITH CHECK (NOT (nx_is_admin() AND (SELECT kind FROM conversations c WHERE c.id = conversation_id) = 'job_team_internal'))`, so a ghost can never accidentally reveal itself by sending.

### 4.4 Invisibility (the hard part — UI/projection + notify, not RLS)
- **Member list / seen-by / typing:** every team-facing projection of participants must derive from `org_members` only — never include the admin. Audit the inbox member-list query + any presence indicator so admin never appears.
- **Notification fan-out:** extend `tg_notify_messages` so `job_team_internal` notifies **teammates only**; the admin is **never** added to recipients (no presence signal). Admin monitoring is a separate **pull** surface.
- **Admin monitor surface:** a read-only super-admin "Integrity Monitor" view (web + mobile `(super-admin)`) listing `job_team_internal` threads — **no composer**. Optionally log each admin open to `audit_events` (accountability), admin-only.
- **Decisions to confirm with you:** (a) audit-log the ghost reads? (b) any ToS monitoring-disclosure copy for legal cover? (c) ghost on all internal rooms by default vs per-investigation toggle?

### 4.5 Verification gate
- pgTAP `rls_team_internal_test.sql`: teammate read+post ok; non-teammate denied; **admin reads (ghost) but admin INSERT denied**; admin **absent** from the member-list projection; viewer can read not post.
- Mobile + web UI parity (team composer present for non-viewers; admin sees read-only monitor only).
- **Commits:** `feat(db): job_team_internal enum`, `feat(db): ensure_team_internal_conversation + ghost RLS`, `feat(db): notify fan-out excludes ghost admin`, `feat(mobile|web): internal team chat + super-admin integrity monitor`, `test(db): team-internal ghost deny-matrix`.

---

# PHASE 5 — Epic verification & rollout
- Full `supabase test db` green (all RLS deny-matrices) via the `db-tests.yml` gate; `npm run typecheck -w @nexpec/web`; mobile `tsc` no new errors.
- **Deploy order:** (1) Phase-1 + Phase-2 backend migrations (`send_message`, backfill, drift fixes, `work_orders` policy) **first** and confirm chat works; (2) ship the refactored mobile binary; (3) Phase-4 enum migration, then its RPC/RLS/notify, then the Ghost UI. Never ship a mobile binary ahead of the RPC it calls.
- Update `reference_master_feature_matrix` (flip the ⛔/🟡 cells to ✅ as each lands) and close `project_architecture_audit_hitlist`.

## Risks / watch-items
- **Enum-in-transaction:** `ADD VALUE` must be standalone (Phase 4.1).
- **Backfill correctness:** deriving conversation side from `sender_id` can be ambiguous for admin-sent legacy rows — default those to the `job_client_admin`/`job_inspector_admin` room matching the other participant; verify counts.
- **Ghost leak surface:** the invisibility lives in *many* small queries (member list, seen-by, typing, unread, notify) — one missed projection reveals the admin. The pgTAP member-list assertion is the backstop.
- **`CREATE OR REPLACE` new-arity:** if any existing function's signature changes, `DROP` the old arity first (known overload gotcha).
