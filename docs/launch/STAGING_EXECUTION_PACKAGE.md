# NEXPEC — Staging Execution Package

Ordered, copy-paste-ready staging run. Legend: **[YOU-CLI]** command you run · **[AI-CLI]** a command I could run if given access (I currently cannot reach staging) · **[YOU-DASH]** dashboard action · **[SECRET]** you must supply · **[EVIDENCE]** capture this.

## Sequencing decision (definitive)
The pending batch includes storage-lockdown migrations (`20260801236000/242000/246000/264000`) **and** `20260801278000`. `supabase db push` applies the whole batch in order, so `278000` lands with them. The new Edge Function is backward-compatible with the old schema (its `nx_is_platform_owner` rpc call fails soft → owner still blocked by role check), so it is **not** a hard pre-req. **Order: migration (whole batch) → owner seed → edge fn deploy → web → mobile.** On staging there are no old clients, so this is a clean linear order (no "DB last" constraint — that only matters in production for live old clients).

---

## 1. Preflight — [YOU-CLI]
```bash
cd ~/Desktop/nexpec
git status                       # clean tree / known branch
git log --oneline -3
(cd apps/web && npm run typecheck && npm run lint)
npx tsc --noEmit                 # mobile scope
npm run qa:db-refs && npm run qa:rls-admin && npm run qa:outbox && npm run qa:gr2
```
[EVIDENCE] all exit 0.

## 2. Backup checks — [YOU-DASH]
- Supabase (staging) → Database → Backups: confirm a recent backup or take a snapshot.
- Record current head: `supabase migration list` [YOU-CLI]. [EVIDENCE] the last applied timestamp.

## 3. Environment-variable checks — [YOU-DASH][SECRET]
- Vercel (staging scope) has every var in `EXTERNAL_DASHBOARD_SETUP.md §1`. `NEXT_PUBLIC_ENV` NOT `development`.
- Supabase edge secrets set (`supabase secrets list`).
- EAS preview env has the three `EXPO_PUBLIC_*`.
[EVIDENCE] `vercel env ls`, `supabase secrets list` (names only), `eas env:list preview`.

## 4. Migration preview — [YOU-CLI]
```bash
supabase db diff --linked         # confirm 278000 (+ pending batch) is what will apply
sed -n '1,60p' supabase/migrations/20260801278000_account_deletion_hardening.sql
```
[EVIDENCE] additive only; BEGIN/COMMIT; trigger + RPC + 2 tables + 5 functions.

## 5. Apply migration — [YOU-CLI]
```bash
supabase db push
```
[EVIDENCE] self-tests pass (no `SELFTEST:` exception); `supabase migration list` head = `20260801278000`.

## 6. Owner seeding — [YOU-CLI / SQL editor, service_role][SECRET=UUID]
```sql
-- get the owner profiles.id first (the sole super_admin you designate):
-- SELECT id, email, role FROM public.profiles WHERE role='super_admin';
SELECT public.seed_platform_owner('<OWNER_PROFILES_UUID>');
SELECT public.nx_is_platform_owner('<OWNER_PROFILES_UUID>');   -- expect true
SELECT public.nx_active_super_admin_count();                    -- expect >= 1
-- second call must fail:
-- SELECT public.seed_platform_owner('<ANY_OTHER_UUID>');  -- expect PLATFORM_OWNER_ALREADY_SET
```
[EVIDENCE] true / count / rejection message.

## 7. Edge Function deploy — [YOU-CLI]
```bash
supabase functions deploy delete-account
```
[EVIDENCE] deploy success; a test invoke returns JSON (not 500).

## 8. Web staging deploy — [YOU-DASH/CLI]
Push to the staging-tracked branch (Vercel builds `apps/web`), or `vercel --prebuilt` per your flow.
[EVIDENCE] deployment URL; header badge shows the staging env; footer shows `build-<sha>` not `build-local`.

## 9. Mobile preview build — [YOU-CLI][SECRET]
```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```
[EVIDENCE] build URLs; installed on device.

## 10. Runtime test order — [YOU]
1. `STAGING_VERIFICATION_TESTS.sql` in the SQL editor → [EVIDENCE] NOTICE log with PASS per test.
2. `OWNER_MANUAL_WEB_TEST.md` sections 1–9.
3. `OWNER_MANUAL_MOBILE_TEST.md` "Test once" + one full role.
4. Deletion matrix using `TEST_ACCOUNT_PLAN.md` accounts 1–10.
[EVIDENCE] screenshots per failure; the harness NOTICE log.

## 11. Rollback conditions — [YOU]
Roll back if: migration self-test fails · deletion touches business records (halt immediately) · owner can be deleted/demoted · auth broken · payments failing. Procedure: `docs/launch/ROLLBACK_20260801278000.sql` (export data first) + redeploy previous edge fn/web.

## 12. Evidence to capture
- Preflight exit codes · migration head · owner-seed outputs · harness NOTICE log · web badge/footer screenshot · deletion-matrix screenshots · any console errors.

---

## Who does what
| Step | I (assistant) can | You must |
|---|---|---|
| Preflight validation (local) | ✅ run in sandbox (already green) | re-run before go |
| Migration preview/apply | ❌ no staging access | run `supabase db push` |
| Owner seed | ❌ (needs UUID + service_role) | run SQL, supply UUID |
| Edge deploy | ❌ | run `supabase functions deploy` |
| Web/mobile deploy | ❌ | Vercel push / `eas build` |
| Dashboard config | ❌ | all `[YOU-DASH]` |
| Verification scripts | wrote them | run + capture evidence |

## Staging sign-off sheet
- [ ] Preflight green
- [ ] Backup taken
- [ ] Env vars confirmed (no `NEXT_PUBLIC_ENV=development`)
- [ ] Migration applied; self-tests pass
- [ ] Owner seeded; second-seed rejected
- [ ] Edge fn deployed
- [ ] Web staging: badge PRODUCTION-family, footer `build-<sha>`
- [ ] Mobile preview installs and runs
- [ ] `STAGING_VERIFICATION_TESTS.sql`: all PASS
- [ ] Deletion matrix (accounts 1–10): each expected code seen
- [ ] Owner cannot be deleted/demoted/suspended via any path
- [ ] Retained records still load after a test deletion
- [ ] No console errors in core flows
- [ ] Rollback rehearsed once
- [ ] Sign-off: name + date
