# Owner-only actions — FINAL list (2026-08-22, HEAD 2aee2ec)

Everything automatable is done: final artifacts built and verified, screenshots
captured from the approved UI, web production deployed, docs/metadata updated.
What remains needs your Apple/Google accounts (and two optional one-liners).

## 1 · Apple — upload & submit  🔑 OWNER
1. Upload `01-Release-Artifacts/iOS/NEXPEC-1.0.0-build11-AppStore.ipa`
   with Transporter (drag & drop, Apple ID sign-in) — or run:
   `xcrun altool --upload-app -f <ipa> -t ios -u <apple-id> -p <app-specific-password>`
2. In App Store Connect → NEXPEC → 1.0.0:
   paste fields from `02-Apple-App-Store/Metadata/APP-STORE-CONNECT-ANSWERS.md`
   (screenshots: `02-Apple-App-Store/Screenshots/framed/` for 6.9",
   `Screenshots/ipad-raw/` for 13" iPad),
   review notes + demo account from `Privacy-and-Review/review-notes.md`.
3. select build 11 → Submit for Review.

## 2 · Google — upload & submit  🔑 OWNER
1. Play Console → NEXPEC → Production → Create release.
2. Upload `01-Release-Artifacts/Android/NEXPEC-1.0.0-versionCode16-production.aab`.
3. Paste listing/Data-Safety fields from
   `03-Google-Play/Metadata/PLAY-CONSOLE-ANSWERS.md`
   (screenshots: `03-Google-Play/Screenshots/phone/`).
4. **Check the pre-launch report** before rollout — the one open risk is the
   16 KB page-size warning on some SDK 52 prebuilt libraries (details in
   `05-QA-and-Verification-Evidence/ANDROID-16KB-FINDING.md`). If Play blocks
   on it, the fix is the Expo SDK 53 upgrade next cycle.
5. Roll out.

## 3 · One-line Production data fix (recommended before Apple review)
The May-era SSO test row makes `acme.com` claim SSO. The app now shows a
friendly message regardless, but the row is stale test data. Run in the
Supabase SQL editor (Production):

```sql
update enterprise_domains set is_active = false, updated_at = now()
 where domain = 'acme.com' and display_name = 'Test Tenant';
```

## 4 · Optional — provider-side demo for reviewers
Reviewers currently get a CLIENT demo (`apple_tester@nexpec.com`). If you want
them to see the inspector side too, create `inspector_tester@nexpec.com`
(role inspector) in Supabase Auth → Users and add it to the review notes.
Not required for submission.

## 5 · Stripe activation (later, when Stripe restores the account)
Run `scripts/stripe-live-golive.sh` verification path → confirm webhook →
flip `platform_settings.online_payments_enabled = true`. No rebuild needed;
every surface reads the flag at runtime. Full steps in `STRIPE-GO-LIVE.md`.

---
Historical record: the June-era deployed-functions TEST-MODE issue was fixed
2026-08-21 (all six functions redeployed with the fail-closed guard; 403
ONLINE_PAYMENTS_DISABLED verified on Production).
