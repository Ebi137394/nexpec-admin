# NEXPEC — Holistic Architecture & Bug-Hunt Audit
_2026-06-25 • TS / Next.js web (`apps/web`) + React Native/Expo mobile (`app/` + `src/`) + Supabase. Every load-bearing claim below was verified against the baseline schema and migrations, not inferred._

## 0. Two earlier assumptions corrected this pass (honesty first)
1. **"Mobile chat rides legacy open tables `job_messages`/`chat_rooms`."** ❌ **Wrong.** `grep` shows **zero** mobile references to either table. Mobile chat uses the real `public.messages` table. The actual problem is different and worse (see P0-1). Those two legacy tables are still RLS-open (Phase-1 finding) but **nothing depends on them** — they can simply be locked/dropped.
2. **"Evidence Vault is dormant because `client_documents` is missing `category`/`valid_from`/`is_verified`/`is_archived`."** ❌ **Wrong.** The baseline `CREATE TABLE public.client_documents` **does** contain all of them (`category, valid_from, valid_until, is_verified, verified_by, verified_at, is_archived`). The vault columns exist; the feature is not blocked by schema drift. (Old memory note was based on a migrations-only search that missed the baseline dump.)

Also ruled out as **false alarms**: the "156 RPCs called / only 42 defined" sweep was a grep artifact (the baseline defines functions with quoted identifiers `"public"."fn"` my regex didn't capture); the web agent's proper signature check found **every** RPC/view aligned. And most code references to `payout_status = 'released'` are legitimate **escrow/deal-leg** status (where `'released'` is valid) — not the `jobs.payout_status` enum.

---

## P0 — Must fix before (or in lockstep with) the messages-RLS deploy

### P0-1. Hardened `messages` RLS breaks mobile's legacy job-chat screens
**This is a direct collision between our security work and mobile's older chat code.**

Mobile has **two** chat implementations:
- ✅ **Modern, RLS-safe:** `src/core/chat/hooks/useChat.ts` → `supabase.rpc('send_message', …)`; `src/hooks/useConversations.ts` → `ensure_job_conversation` / `ensure_help_support_conversation`. These create/resolve a `conversation_id` server-side, so they satisfy the new policies.
- ❌ **Legacy, raw:** `app/messages/[id].tsx` (L184, L201), `app/messages/[jobId].tsx` (L619), `app/chat/[job_id].tsx`, `src/core/chat/chatService.ts` (L131) → `supabase.from('messages').insert({ job_id, sender_id, content })` **with no `conversation_id`**, and SELECT by `job_id`.

The current `messages` policies (after we dropped `insert_chat_msgs` in `194000` and the allow-all read in `192000`) **all key off `conversation_id`**:
- INSERT `msg_insert_party`: `sender_id = auth.uid() AND (nx_is_admin() OR EXISTS(conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid() AND c.status='open'))`
- SELECT `msg_select_via_conv` / `view_chat_msgs`: match on `messages.conversation_id` → `conversations`.

**Consequence:** a non-admin inserting/reading a message with `conversation_id = NULL` (the legacy job-chat pattern) is now **denied**. The permissive `insert_chat_msgs` (sender-only check) that used to allow it is gone. → **Legacy mobile chat send/read breaks for all non-admin users the moment `194000` is live.** Admins are unaffected (`nx_is_admin()` bypass), which is why it can hide in testing.

**Severity: P0** (silent, user-facing, security-coupled).
**Fix:**
1. Route the legacy screens through the same RPCs the modern hook uses — `ensure_job_conversation(p_job_id, p_kind)` to get the `conversation_id`, then `send_message(...)` (or insert WITH `conversation_id`). Delete the raw `job_id`-only inserts and `getChatRoomId()` string-keying in `src/core/chat/messages.ts`.
2. **Data backfill:** any existing `messages` rows with `conversation_id IS NULL` are now invisible — backfill `conversation_id` from `job_id` (create/lookup the job's conversation) before or with the deploy, or they vanish from history.
3. Add a pgTAP case: "non-admin cannot insert a message with null `conversation_id`" + "can insert via a conversation they own" so this never silently regresses.

---

## P1 — Latent runtime breakage (verified schema drift)

### P1-1. Mobile inspector-document approval writes phantom columns → UPDATE 400s
`public.inspector_documents` columns are exactly: `id, inspector_id, doc_name, file_url, expiry_date, status, created_at`.
- `app/(admin)/verification/index.tsx` L99 & L127 `UPDATE … SET reviewed_at, reviewed_by` → **neither column exists** → PostgREST 400 → **approving an inspector's document fails entirely** (not a silent no-op — the call errors).
- `app/(admin)/users/[id].tsx` L10 types `InspectorDoc` with `document_type`, `document_url`, `reviewed_at`, `reviewed_by` — but the table has `doc_name`/`file_url` and no review columns. Any SELECT of those names also 400s; `doc.reviewed_at` display is always empty.
**Fix:** either (a) add `reviewed_at timestamptz, reviewed_by uuid` to `inspector_documents` via migration (if you want the audit trail), or (b) drop those writes/reads and use `status` + `created_at`. Align field names to `doc_name`/`file_url`. **Severity P1.**

### P1-2. Mobile `profiles` drift: `years_experience` & `is_featured` are phantom
`profiles` has `experience_years` (int) and `years_of_experience` (text) — **not** `years_experience`; and **no** `is_featured`.
- `app/(tabs)/profile.tsx` L188 `.select('… years_of_experience, years_experience, …')` → selecting the non-existent `years_experience` makes the **whole query 400** → the profile tab's load fails (or silently falls to a catch). 
- `app/(agency)/jobs/[id].tsx` L1130 `.select('… years_experience …')` → same 400.
- `app/(client)/explore/index.tsx` reads `inspector.is_featured` (L402) and `inspector.years_experience` (L514) → featured badge never renders / years blank (and 400s if those names are in its select).
**Fix:** replace `years_experience` → `experience_years` (or `years_of_experience`); replace the `is_featured` read with the real featured signal (`public_listing_featured`, used by the teaser feed). Mirrors the bug that broke the web teaser push (commit 3327585) — same drift, mobile side. **Severity P1.**

### P1-3. Mobile `legal_consents` written/read by a `userId` param, not `auth.uid()`
`src/services/consentService.ts`: `saveConsent(userId,…)` inserts `user_id: userId` (caller-supplied, no check); `checkConsent(userId,…)` reads `.eq('user_id', userId)`. With `legal_consents` now owner-scoped (read revoked for non-owners; insert still open), the **read path breaks** whenever `userId ≠ auth.uid()` or pre-auth, and the insert is a forge vector (you can write a consent under someone else's id).
**Fix:** resolve `auth.uid()` inside the service and assert `userId === user.id`; never accept it from the caller. **Severity P1.**

### P1-4. Mobile `work_orders` operations read is org-scoped, RLS is owner-scoped
`src/hooks/useOperationsData.ts` L43 `.from('work_orders').select(...).eq('organization_id', orgId)`. Our `196000` lockdown scopes `work_orders` to `owner_id/client_id/inspector_id/user_id` — **not** `organization_id`. → operations dashboards return **empty** under the new RLS.
**Fix:** add an org-membership read path to the `work_orders` policy (`organization_id IN (select org_id from org_members where user_id = auth.uid())`) **or** repoint the hook at `jobs`/`nx_team_jobs`. **Severity P1.**

### P1-5. Web payout trigger references invalid `payout_status` values
`supabase/migrations/00000000000000_remote_baseline.sql` L14260: `IF … NEW.payout_status IN ('paid','released','complete')`. The `jobs.payout_status` CHECK only allows `unpaid/processing/paid/disputed` → the `'released'`/`'complete'` arms are **dead**; the inspector-payout side-effect in that trigger only ever fires on `'paid'`. Confirm that's the intended terminal state (it is), then hotfix the condition to `= 'paid'` so the logic isn't misleading. **Severity P1 (correctness/clarity).**

---

## P2 — Tech debt & resilience

- **P2-1. `.single()` on possibly-empty reads** (`app/messages/[jobId].tsx` L460, `app/chat/[job_id].tsx`, `app/contract/[id].tsx`, others): throws `PGRST116` if the row is missing (job deleted mid-flight, RLS deny) → blank/crash. Use `.maybeSingle()` + null guard.
- **P2-2. Unfiltered realtime `messages` subscription** (`app/messages/index.tsx` L180): subscribes to **all** message INSERTs, then refetches. Add a `filter` (now that rows are conversation-scoped, filter by `conversation_id`) to cut device load.
- **P2-3. Money naming hazard** (`src/roles/inspector/hooks/useEarnings.ts`, `app/(tabs)/finance.tsx`): live `transactions.*_halalas` mapped 1:1 to `*_cents`. Numerically fine, but SAR-subunit vs USD-subunit naming is a footgun. Pick one convention or add a typed `Minor` unit. (Already worked-around, not broken.)
- **P2-4. Chat attachment signed-URL TTL** (`src/core/chat/messages.ts` L367): 1h view URL can expire while the app is backgrounded → "file not found". Mint on tap everywhere (already done for images). A CI guard already blocks long-lived TTLs, so keep them short + lazy.
- **P2-5. Dead web filter param**: `app/admin/users/[id].tsx` L466 links `/admin/jobs?assigned_inspector_id=${id}` — there's no such column; confirm the jobs page maps this to `contractor_id` or the filter silently no-ops.
- **P2-6. Consent dedup**: `legal_consents` has no `UNIQUE(user_id, document_id, policy_version)`; double-signing bloats the trail. Add the constraint or upsert.

**Note — offline outbox is already hardened:** the agent flagged the drain loop's error handling as "incomplete," but the shipped `#56` work classifies errors (auth never burns attempts; 0-row update → `SyncConflictError` → `'conflict'`). Treat as **resolved**, not a finding.

---

## Verified clean (no action)
- **RPC/projection alignment (web):** every `supabase.rpc()` and projection read (`nx_team_jobs`, `nx_handle`, `public_supply_feed`/`demand_feed`, `rfq_client_offers_view`, the shortlist/offer views, `p_`-prefixed args) matches its migration signature.
- **Price-blindness (web):** client finance projections select `client_price_cents` only; no buyer surface selects `inspector_payout_cents`/`platform_spread_cents`; CI guard `qa:gr2` in place.
- **`service_role` key:** server-only (`adminUserModeration.ts`), never in a client bundle; no `EXPO_PUBLIC_*SERVICE*` leak.
- **Layout resilience:** admin/client/inspector/marketplace layouts wrap `getUser`/profile reads in `runWithRetry` → no layout throw escapes to a full-screen 500.
- **React #31:** fixed structurally via web dependency isolation (`apps/web` excluded from root workspaces; `symlinks:false`); the old webpack alias band-aid was correctly removed.
- **Server actions:** Zod-validated (`jobs.ts`, `invoices.ts`, …). Feeds are anon-client, fail-closed, ISR-cached. `dangerouslySetInnerHTML` only in JSON-LD (safe).

---

## Remediation order
1. **P0-1 mobile chat** — migrate legacy screens to `ensure_job_conversation`+`send_message`, backfill `conversation_id`, add pgTAP. _Do this as part of the Mobile Parity Epic, before/with pushing `192000`/`194000` to prod._
2. **P1-1…P1-4 mobile drift/RLS** — `inspector_documents` columns, `profiles.years_experience`/`is_featured`, `consentService` auth.uid(), `work_orders` org path. Small, mechanical, high-impact.
3. **P1-5** web payout trigger hotfix migration.
4. **P2** batch as a cleanup pass.
5. Lock/drop the orphaned open tables (`job_messages`, `chat_rooms`, + the rest of the 28) — nothing depends on them; folds into the RLS open-table epic.
