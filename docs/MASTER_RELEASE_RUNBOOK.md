# NEXPEC — Master Release Runbook (Web + Mobile)

> THE single, consolidated launch runbook. Follow the phases **top to bottom** —
> deploy ordering is load-bearing (the storage lockdowns make it so).
> Covers the Final QA / Hardening Sprint + the adversarial sweep + the four
> architectural-surgery migrations (`242000` `244000` `246000` `248000`).
> Last compiled: 2026-06-26.

---

## 0. Release principles (the invariants every phase preserves)

- **One admin role.** `admin` == `super_admin` everywhere (god-mode). Every RLS/storage policy preserves admin access via `nx_is_admin()`; verified by `check-rls-admin-coverage`.
- **Price-blindness.** Buyers never see `inspector_payout` / `platform_spread` / margin; inspectors see only their own payout + coarse `rate_band`. Enforced in code + CI (`check-price-blindness`).
- **Anti-poaching / pseudonymity.** Applicants stay pseudonymous; raw CV / cert / ID / receipt files are **never** shown to buyers/posters pre-hire. Released only after an admin-brokered hire / identity reveal. Now enforced at the DB root by the `profiles` party-read policy + the PII storage locks.
- **Admin-brokered flow.** Buyer surfaces may only set `applications.status='CLIENT_SELECTED'`; only `admin_dispatch_job` assigns `jobs.contractor_id` (the canonical assignment column).
- **Offline-first writes** route through the outbox (`src/core/offline`); verified by `check-outbox-routing`.

---

## 1. Pre-flight checklist

- [ ] On the release branch; working tree clean; tag the candidate (`git tag rc-YYYYMMDD`).
- [ ] `.env` / Supabase project ref point at **production**; service-role key in the deploy shell only.
- [ ] Stripe keys are **live** for: `create-payment-intent`, `create-disclosure-fee-intent`, `stripe-payments-webhook`, `stripe-connect-webhook`, `create-stripe-connect-link`, `process-payout`.
- [ ] **New edge-function secrets set** (or the hardened functions 401 by design — see §3 Phase 1): `NOTIFY_SHARED_SECRET` (for `notify-job-assigned` / `notify-job-event` server-to-server calls) and `WEBHOOK_SECRET` (for `send-consent-receipt` webhook path + `critical-alert-monitor`, which now fails **closed**).
- [ ] **OAuth provider config done** (see §2 — mobile social login can't round-trip until the deep-link redirect URLs are whitelisted).
- [ ] EAS credentials present (`eas.json`, `app.config.js`). **Replace placeholder Apple/Play submit creds** before `eas submit`.
- [ ] Staging CI secrets set (money-flow E2E gate): the 3 GitHub secrets for `qa:e2e:money`.
- [ ] `supabase migration list` shows local-ahead migrations through `20260801250000`.
- [ ] **Vercel project Root Directory = `apps/web`** (Settings → Build & Deployment). The monorepo root is the Expo app and has no `next` dependency — a root-directory build fails with "No Next.js version detected" (seen 2026-07-02 on the branch deploy).

---

## 2. OAuth provider configuration (do BEFORE the mobile build ships)

Mobile OAuth now uses the correct PKCE flow (`exchangeCodeForSession`). It will only complete a round-trip once these deep-link redirect URLs are registered. `<scheme>` = the app's URL scheme from `app.config.js` (e.g. `nexpec`).

- [ ] **Supabase → Authentication → URL Configuration → Redirect URLs:** add `<scheme>://oauth-callback` and `<scheme>://reset-password` (and the web callback if not already present).
- [ ] **Web password recovery** (new 2026-07-02): also add `https://<web-domain>/reset-password` to the Redirect URLs — the web `/forgot-password` flow sends recovery links there.
- [ ] **Google Cloud Console** (OAuth client): add the Supabase auth callback + the app redirect.
- [ ] **Apple Developer** (Sign in with Apple service id): add the return URL.
- [ ] **LinkedIn Developer** app: add the authorized redirect URL.
- [ ] After deploy: device-test **one sign-in per provider** (Google, Apple, LinkedIn) + one "Forgot Password" round-trip (email link must open `reset-password` in-app and set a new password).

---

## 3. Build-time verification gates (must all be GREEN)

```bash
# Type safety
npm run typecheck -w @nexpec/web            # apps/web (the real web gate)
npx tsc --noEmit                            # mobile (Babel strips types; tsc never gates the EAS binary)

# QA guards
node scripts/qa/check-outbox-routing.mjs    # offline-write routing
node scripts/qa/check-price-blindness.mjs   # GR2 buyer-surface column scan
node scripts/qa/check-rls-admin-coverage.mjs# admin god-mode on every RLS table
node scripts/qa/check-db-refs.mjs           # table refs ↔ migrations (see §9 known items)

# Money-flow E2E + pgTAP (staging)
npm run qa:e2e:money
```

Last green status: outbox ✓ (687 files, no new bypass), price-blindness ✓ (**51** buyer surfaces incl. now `app/inspectors.tsx`), rls-admin ✓ (122 covered + 14 allowlisted). `check-db-refs` has two **pre-existing** unresolved refs — see §9.

> **apps/web build note:** `next.config` keeps `ignoreBuildErrors`/`ignoreDuringBuilds` ON to ship past ~37 pre-existing lucide/Suspense type errors. The real web gate is `npm run typecheck -w @nexpec/web`. The dual-React (#31) prerender crash is mitigated by the webpack alias in `next.config`.

---

## 4. Deploy sequence — **ORDER IS LOAD-BEARING**

The storage IDOR + PII lockdowns (`236000`, `242000`, `246000`) flip 13 buckets to **private**. If the DB is pushed **before** the client + edge functions ship, any client still calling `getPublicUrl` on those buckets gets dead images/files. (`244000`/`248000` are zero-app-code DB hardening but still push with the batch, last.)

**Therefore: edge functions → web → mobile → DB push.**

### Phase 1 — Edge functions (deploy FIRST)

```bash
# Storage / contract (CHUNK 2A/2B)
supabase functions deploy mint-doc-url            # NEW — mints signed URLs; authorizes via nx_can_access_doc (service_role)
supabase functions deploy generate-contract       # admin-gated direct call; no email echo; returns filePath
supabase functions deploy generate-dispute-report # stores report PATH; party/admin authz; returns service-role signed URL
supabase functions deploy stripe-connect-webhook  # restore_wallet_balance passes p_event_id (idempotency)

# Adversarial-sweep IDOR / relay hardening (NEW)
supabase functions deploy send-consent-receipt    # caller must own the consent OR be admin (or webhook-secret path)
supabase functions deploy notify-job-assigned     # was an open email relay → admin OR x-internal-secret
supabase functions deploy notify-job-event        # admin OR x-internal-secret (shared secret for pg_net)
supabase functions deploy critical-alert-monitor  # fail-CLOSED when WEBHOOK_SECRET unset
```

> **Secrets gate:** `notify-job-assigned` / `notify-job-event` require `NOTIFY_SHARED_SECRET` on their server-to-server callers (pg_net / DB webhooks must send `x-internal-secret`); `send-consent-receipt` webhook path + `critical-alert-monitor` require `WEBHOOK_SECRET`. Set these (Pre-flight) or those paths 401 **by design**.
>
> `mint-doc-url` works on public **and** private buckets, so shipping it before the lockdown is safe and forward-compatible.

Full inventory (deploy any others your diff touched): `ai-analysis-worker, anchor-inspection-seals, confirm-inspection-anchors, create-*-intent, create-stripe-*, create-supplier-payout, delete-account, dispatch-notification-emails, generate-vca, handle-dispute, process-payout, reconcile-ledger, refresh-fx-rates, release-payment, stripe-*-webhook, sync-*, tax-vault, tool-document, verify-affidavit, verify-contractor`.

### Phase 2 — Web (apps/web)

```bash
npm run typecheck -w @nexpec/web   # gate
npm run build -w @nexpec/web       # next build
# deploy via your host
```

### Phase 3 — Mobile (EAS)

```bash
eas build --platform all --profile production
eas submit --platform all          # ensure real Apple/Play creds first
```

New-Architecture is required (Nitro/Skia/fast-tflite); the `withNexpecNewArch` config plugin keeps the generated property files authoritative.

### Phase 4 — Database (push LAST)

```bash
supabase db push                   # applies all pending migrations in order; each self-test gates the push
```

Pending migrations apply in numeric order `20260801182000 … 20260801250000`. Each has `BEGIN/COMMIT` + an in-migration self-test that aborts the push on failure. Security/hardening highlights:

| Migration | What it seals |
|---|---|
| `218000` discover_jobs price-blind | RPC returns an allowlisted column set (no budget/spread leak) |
| `220000` / `240000` wallet lockdown + idempotency ledger | client can't mint balance; `restore_wallet_balance` is event-idempotent |
| `222000` / `224000` RLS lockdown + owner tables | anon-exposed + owner tables get RLS + policies |
| `226000` / `228000` / `234000` | profile role-escalation guard; revoke self-assign; application self-hire guard |
| `230000` audit redaction | `audit_events` pricing + identity redacted; raw table admin-only |
| `236000` storage IDOR | 8 buckets → owner+admin; `nx_can_access_doc` + `mint-doc-url` |
| `242000` storage PII lockdown | receipts, inspector-docs, certifications, resumes, dispute-reports → private + owner/admin; dispute parties via `nx_can_access_doc` |
| **`244000` SECDEF + RLS holes** | **pins `search_path` on every owner=postgres `SECURITY DEFINER` fn (escalation primitive); extends the profile guard to block self-grant of `is_verified`/`balance_cents`/ratings; drops cross-user `notification_preferences`; locks `reports`** |
| **`246000` client_documents bucket** | **private + owner/client/assigned-inspector/admin SELECT (mirrors the table RLS) — zero app-code** |
| **`248000` profiles party-read** | **drops blanket `USING(true)`; adds `nx_can_read_profile()` + `profiles_read_related` (self / admin / shared-job / same-org / application) — kills bulk PII harvest, zero app-code** |
| **`250000` phantom-object restore** | **restores `inspector_equipment` + `inspector_work_experience` + `contact_submissions` + `supplier_releases` + `credit_supplier_earnings()` + `notify()` alias — heals prod's `get_inspection_passport()` and `release_supplier_contract()`, un-breaks /inspector/compliance-equipment, /inspector/experience, public /contact, /admin/supplier-payouts** |

> If a self-test aborts, fix forward (do not force). The known gotcha — `pg_get_functiondef` including a function's own comment and tripping a leak scan — is handled by `regexp_replace(def,'--.*','','g')` in the guarded migrations.

---

## 5. This-release change manifest

**Final QA / Hardening Sprint (CHUNKS 1–4 + 2B):**
- **Security & routing (CHUNK 1).** `generate-contract` admin-gated + email echo removed; ~21 routing fixes (`/jobs/[id]/*` cluster → role groups; auth bounces → `/(auth)/sign-in`; `canGoBack` back-guards; `/ForgotPassword` wired; dead `/transactions`/`/p/[id]`/`/profile/[id]` repointed).
- **Storage (CHUNK 2A/2B).** Every `getPublicUrl` on a private bucket → store-path + signed-URL mint; 5 PII buckets locked; buyer/poster raw-file views removed (`avatars`/`company-logos` stay public by design).
- **Brand (CHUNK 3).** Stray cyan → `#7C3AED` across 24 files, contrast-aware; semantic palette preserved.
- **States (CHUNK 4).** `my-jobs` loading/empty/error+retry; `(client)/index` surfaces errors; inspector-dashboard error banner renders.

**Adversarial sweep + architectural surgery (this release):**
- **Assignment-column drift (was: inspector dashboard permanently empty).** Five surfaces filtered the never-written `jobs.inspector_id` → repointed to `contractor_id` (`useInspectorData`, inspector super-dashboard, `useJobs`, admin jobs list, live-radar); rebuilt a status map using non-existent statuses; web pipeline phantom `'selected'` → `CLIENT_SELECTED`.
- **Price-blindness leaks.** `app/inspectors.tsx` payout → `client_price_cents` only (+ added to the CI guard); web buyer projection dropped latent `bidCents`.
- **Edge-function IDORs/relay** (see §3 Phase 1): consent-receipt + dispute-report authz, two open email relays gated, critical-alert fail-closed.
- **DB hardening `244000`** (search_path sweep + profile trust-column guard + `notification_preferences`/`reports` lockdown).
- **Chat read path** (`chat/[job_id]`): read by `conversation_id` + `attachment_url` (was `job_id`/phantom `file_url`).
- **UI cleanup:** debug logs removed, back-button cold-start guards, dead "View Draft" wired, silent errors surfaced, debug artifacts deleted; web console.log + dead pagination anchor + admin-only link gated.
- **The four "before-launch" items:** `profiles` PII (`248000`), `client_documents` (`246000`), inbox rebuilt on `useInbox()`, mobile OAuth modernized (PKCE + `oauth-callback`/`reset-password` screens + `apply_onboarding_role` RPC).

---

## 6. Post-deploy smoke tests (by role)

**Auth / OAuth / routing**
- [ ] Email/password sign-in works; "Forgot Password?" email link opens `reset-password` in-app and sets a new password.
- [ ] One OAuth sign-in per provider (Google, Apple, LinkedIn) completes and lands on the right home (or choose-role for a brand-new account → role persists, no loop).
- [ ] Deep-link cold start into a job detail; back button lands on a valid screen (no dead-end).

**`profiles` party-policy (the `248000` blast radius — verify legit reads survive)**
- [ ] As a **client**, open a job you posted with an assigned inspector → the inspector's name/avatar render (shared-job branch).
- [ ] As an **inspector**, open an assigned job + its chat → the client/admin label renders.
- [ ] Open a **team/org** screen → teammate names/emails render (same-org branch).
- [ ] Admin user-list / verification queue render full profiles.
- [ ] If any counterparty name shows **blank**, that reader's relationship isn't covered → add a branch to `nx_can_read_profile` (one-line; fails to blank, never crashes).

**Storage render (the lockdown blast radius)**
- [ ] Inspector: chat image attachment renders; own receipt / CV / certs render.
- [ ] Client: submitted report photos + doc open; **own** vault/compliance document opens (`client_documents`).
- [ ] Contract PDF full-screen renders (no Google viewer).
- [ ] **Negative:** a non-party authenticated user cannot open another client's vault doc; a poster sees **no** raw "View CV"; a client sees expense amounts but **no** raw receipt image.
- [ ] Admin verification console renders inspector ID docs.

**Inbox / realtime**
- [ ] Send a new message → the inbox preview + unread update immediately (conversations backend, not stale `job_id` grouping).

**Data / dashboards**
- [ ] Inspector dashboard now lists assigned jobs + correct counts (the `contractor_id` fix).

**Money / Brand**
- [ ] Withdrawal → admin "Mark as Paid"; wallet balance server-authoritative; Stripe webhook replay does not double-credit.
- [ ] Spot-check screens: accent `#7C3AED`, background `#020420`, no cyan.

---

## 7. Rollback

- **Edge functions / web / mobile:** redeploy the previous artifact (functions independently versioned; web via host rollback; mobile via prior EAS build / store rollback).
- **Database:** migrations are forward-only. Do **not** force-down the storage locks while the new client is live. `244000`/`246000`/`248000` are additive RLS/policy changes — to revert a specific one, ship a compensating migration that restores the prior policy (e.g. re-add a bucket's owner+admin policy, or temporarily re-add `profiles_read_related` coverage). Treat `236000`+`242000`+`246000` (storage) as a unit.

---

## 8. Critical ordering — one-line summary

> **Functions → Web → Mobile → `supabase db push`.** Never push the DB first: the storage lockdowns break any client still calling `getPublicUrl`. Set `NOTIFY_SHARED_SECRET`/`WEBHOOK_SECRET` and register the OAuth redirect URLs before/with the deploy.

---

## 9. Known pre-existing items (not blockers, track post-launch)

- `check-db-refs` flags `withdrawal_requests` (apps/web treasury/inspectorWallet) and `work_sessions` (inspector earnings hook) — referenced without a local `CREATE` migration. Pre-existing data-layer drift; add the migrations or allowlist entries.
- `profiles` party-policy **residual (by design):** the application branch lets a poster read their own applicants' rows — bounded (not platform-wide) and masked by the `jobApplications` projection. Long-term, move applicant reads fully to projections/RPCs and drop that branch.
- Lower-priority cleanups surfaced by the sweep (not P0): support chat spans 3 tables (helpdesk_messages / support_messages / admin_direct_messages) — consolidate; orphaned hooks `useChat`/`useRealtimeChat`/`useChatEngine` carry the old `job_id` pattern — delete; `types/inspector.ts` still types the stale status union + `inspector_id` — align to the canonical enum/`contractor_id`.
- Legacy `src/screens/*` + `src/navigation/MainNavigator` are a superseded React-Navigation tree (live app is expo-router under `app/`); candidates for deletion.
- `apps/web` `next.config` build-error flags still ON; remove after fixing the ~37 pre-existing errors.
