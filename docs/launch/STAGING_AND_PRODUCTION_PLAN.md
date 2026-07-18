# NEXPEC — Staging & Production Deployment Plan

Companion to `LAUNCH_PLAYBOOK.md` and `docs/MASTER_RELEASE_RUNBOOK.md`. Steps are labelled: **[AUTO]** automatic · **[MANUAL]** human action · **[SECRET]** needs a secret/UUID/key/dashboard · **[IRREVERSIBLE]** · **[REVERSIBLE]**.

Global order of operations: **console prep → edge functions → web → mobile builds → `supabase db push` LAST → owner seeding → verification.** The DB push goes last because storage lockdowns break old clients still calling `getPublicUrl`.

---

## PART 5 — STAGING

### 5.1 Backup & recovery prep — [MANUAL][SECRET]
- Supabase (staging project) → Database → Backups: confirm a fresh automated backup exists, or take a manual snapshot. **[REVERSIBLE]**
- Record the current migration head: `supabase migration list` (note the last applied timestamp before `20260801278000`).
- Snapshot storage bucket policies (export current policies) for rollback reference.

### 5.2 Required environment variables — [MANUAL][SECRET]
Staging Supabase edge secrets (`supabase secrets set --project-ref <staging>`): `NOTIFY_SHARED_SECRET`, `WEBHOOK_SECRET`, `STRIPE_PAYMENTS_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `TAX_VAULT_KEY`, plus the rest in `.env.example` §edge secrets.
Vercel (staging): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test), `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SIGNING_SECRET`, `OWNER_EMAILS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. **Do NOT set `NEXT_PUBLIC_ENV=development`** on any non-dev scope.
EAS (staging/preview): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

### 5.3 Migration preview — [MANUAL][REVERSIBLE]
```bash
cd ~/Desktop/nexpec
supabase db diff --linked            # confirm 20260801278000 is the only new head vs staging
sed -n '1,40p' supabase/migrations/20260801278000_account_deletion_hardening.sql   # eyeball
```
Confirm: additive only (no DROP TABLE / DELETE), one BEGIN/COMMIT, trigger + RPC + 2 tables + 3 helpers.

### 5.4 Apply migration — [MANUAL][IRREVERSIBLE-ish]
```bash
supabase db push        # applies the pending batch through 20260801278000
```
Self-tests inside the migration RAISE on regression. If it fails, it rolls back its own transaction. **[REVERSIBLE]** via the drop-objects rollback (see 5.15).

### 5.5 Platform Owner UUID seeding — [MANUAL][SECRET][IRREVERSIBLE-ish]
Get the owner's `profiles.id` (the sole super_admin), then:
```sql
SELECT public.seed_platform_owner('<owner-profiles-uuid>');
SELECT public.nx_is_platform_owner('<owner-profiles-uuid>');  -- expect true
SELECT public.nx_active_super_admin_count();                  -- expect >= 1
```
Until seeded, owner protection is inert (admin/last-super-admin guards still active). **[REVERSIBLE]** (re-run seeder with a corrected UUID).

### 5.6 Edge Function deployment — [MANUAL]
```bash
supabase functions deploy delete-account --project-ref <staging>
```
`verify_jwt` defaults to true (correct). **[REVERSIBLE]** (redeploy previous).

### 5.7 Web staging deployment — [AUTO after push] 
Push the branch to the staging-tracked branch; Vercel builds `apps/web` (Root Directory must be `apps/web`). **[REVERSIBLE]** (redeploy prior).

### 5.8 Mobile staging build — [MANUAL][SECRET]
```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```
Install via internal distribution. **[REVERSIBLE]**.

### 5.9 Legal-document version activation — [MANUAL]
The registry ships docs as `status: 'draft'`. When counsel signs off, flip the changed docs to `status: 'active'` with an `effectiveDate` (code change, not DB). Until then they render but are not "effective." **[REVERSIBLE]**.

### 5.10 Acceptance-reset behavior — verify — [MANUAL] (CORRECTED — see REVIEW_CORRECTIONS §6)
The registry version bump changes the legal **viewer** state (`hasAccepted(id,'1.1')` = false → the viewer shows the doc as newly-versioned), but does **NOT** force onboarding re-acceptance: the mobile onboarding hard gate keys off a separate `TERMS_VERSION` constant in `app/(auth)/choose-role.tsx`, which is **unchanged**. So v1.1 is displayed but not enforced. To actually force re-acceptance (post counsel sign-off), bump `TERMS_VERSION` too. Verify: a test user of each role sees the v1.1 docs in the legal viewer, and a supplier sees SUP-AGR-001 — without being hard-blocked from using the app.

### 5.11 Storage verification — [MANUAL]
- Confirm private buckets stay private post-push (`client_documents`, resumes, docs).
- Run a test deletion (5.14) and confirm `avatars/<uid>/` and `resumes/<uid>/` are purged while `inspection-photos`, `inspection-reports`, `contracts`, `dispute-reports` retain the deleted user's evidence.

### 5.12 Smoke tests — [MANUAL]
Sign-in per provider · one job post→approve→publish · one bid→counter→accept · one capture→offline→sync · one chat send · env badge = staging.

### 5.13 Role-by-role testing — [MANUAL]
Run `FINAL_QA_CHECKLIST.md` sections B–G against staging for Inspector, Client, Supplier, Agency, Enterprise, Admin, Super Admin, Platform Owner.

### 5.14 Account-deletion testing — [MANUAL] (the new surface)
Positive: clean inspector/client/supplier/agency/enterprise → deletes → "Former {Role}", banned, signed out, retained records still load.
Blocked: seed each blocking condition → expect exact code (`ACTIVE_JOBS`, `WALLET_NOT_EMPTY`, `PENDING_PAYOUT`, `FAILED_PAYOUT`, `OPEN_INVOICE`, `OPEN_DISPUTE`, `SUPPLIER_ACTIVE_CONTRACT`, `SUPPLIER_OPEN_QUOTE`, `SUPPLIER_EARNINGS_UNSETTLED`, `ORG_OWNERSHIP_TRANSFER_REQUIRED`, `ORG_MEMBERSHIP_TRANSFER_REQUIRED`).
Security: admin self-delete → `ADMIN_NOT_SELF_DELETABLE`; owner via UI/RPC/edge → `PLATFORM_OWNER_PROTECTED`; `UPDATE profiles SET role='client' WHERE id=<owner>` → trigger raises; demote last super_admin → `LAST_SUPER_ADMIN`.

### 5.15 Rollback verification — [MANUAL][REVERSIBLE]
Rehearse on staging: `DROP TRIGGER trg_nx_protect_privileged_profiles ON public.profiles; DROP FUNCTION nx_protect_privileged_profiles; DROP FUNCTION seed_platform_owner(uuid); DROP FUNCTION nx_is_platform_owner(uuid); DROP FUNCTION nx_active_super_admin_count(); DROP TABLE ai_dataset_provenance; DROP TABLE platform_owner;` then restore the prior `request_account_deletion` body from migration `20260801164000`. Confirm deletion reverts to pre-hardening behavior with no data loss.

### 5.16 Staging sign-off criteria
All P0 checklist items pass · deletion matrix green · owner un-deletable · retained records intact post-deletion · env badge correct · no console errors · rollback rehearsed.

---

## PART 6 — PRODUCTION

**Maintenance recommendation:** **no maintenance window required** — the change is additive and the DB push goes last. Optionally post a short "brief read-only window" only if you want zero-risk during the push.

### 6.1 Pre-production backup — [MANUAL][SECRET][REVERSIBLE]
Fresh Supabase prod snapshot + note migration head + export storage policies.

### 6.2 Deploy order (exact) — CORRECTED (edge fn AFTER db push; see REVIEW_CORRECTIONS §1)
1. **[MANUAL]** Console prep (Supabase Auth redirect URLs, providers, edge secrets, reviewer account) per LAUNCH_PLAYBOOK Part 0. **[REVERSIBLE]**
2. **[MANUAL/AUTO]** Web deploy (Vercel builds `apps/web`) — **after** CI `next build` passes and `NEXT_PUBLIC_ENV` is not `development` on Production. Backward-compatible with old edge fn/schema. **[REVERSIBLE]**
3. **[MANUAL]** Mobile release timing: submit iOS/Android builds; review in parallel. Native binaries are **[IRREVERSIBLE]** once released (roll forward via OTA for JS-only fixes).
4. **[MANUAL][IRREVERSIBLE-ish]** `supabase db push` (storage lockdowns + `20260801278000`) — **LAST for the storage-lockdown reason**. This creates all owner/admin/supplier DB guards. Self-testing; transaction-guarded.
5. **[MANUAL]** `supabase functions deploy delete-account` — **AFTER the push**, so its `nx_is_platform_owner` RPC + new codes exist. (It is backward-compatible if deployed earlier, but its owner-by-singleton feature only works post-migration.) **[REVERSIBLE]**
6. **[MANUAL][SECRET]** `SELECT public.seed_platform_owner('<prod-owner-uuid>');` (run as service_role) then verify `nx_is_platform_owner` + `nx_active_super_admin_count`. A second seed is rejected; use `transfer_platform_owner()` to change later.
7. **[MANUAL]** Legal activation (flip to `active` + `effectiveDate`, and bump `TERMS_VERSION` in `choose-role.tsx` to force re-acceptance) — ONLY once counsel signs. Requires a web+mobile deploy.

### 6.3 Monitoring — [MANUAL]
Sentry (web + mobile), Stripe webhook dashboard, Supabase logs (grep `[middleware]`, `[delete-account]`), Play vitals / App Store Connect crash.

### 6.4 Smoke testing (prod) — [MANUAL]
Sign-in per provider · one real test-mode payment · one capture→sync · `/account/delete` renders + a controlled test-account deletion tombstones correctly · owner delete attempt blocked.

### 6.5 Rollback triggers — [MANUAL]
Auth broken for real users · payment capture failing · deletion deleting business records (should be impossible — halt immediately) · owner lockout · migration self-test failure.

### 6.6 Rollback procedure — [MANUAL][REVERSIBLE]
Web/JS: Vercel "Promote previous deployment" or `eas update --channel production` for mobile JS. DB: the drop-objects script from 5.15 (additive migration → clean revert). Edge fn: redeploy previous. Native: cannot un-release; OTA a fix or submit an expedited build.

### 6.7 Post-deployment verification — [MANUAL]
Re-run 6.4 + confirm audit rows for the owner-seeding and any privileged op; confirm env badge = PRODUCTION.

### 6.8 First 24 hours — [MANUAL]
Watch crash/ANR, webhook error rate, `AuthApiError` frequency (should drop to ~0 with cookie hygiene), any `PLATFORM_OWNER_PROTECTED`/`ADMIN_NOT_SELF_DELETABLE` audit spikes (would indicate probing). Keep Android at 20% staged rollout.

### 6.9 First 7 days — [MANUAL]
Promote Android 20% → 50% → 100% on healthy vitals. Review any real account deletions and confirm retained-record integrity. Confirm no orphaned personal files (spot-check `avatars`/`resumes` for banned uids). Revisit the storage-orphan sweep and `inspection_captures` de-identification job.
