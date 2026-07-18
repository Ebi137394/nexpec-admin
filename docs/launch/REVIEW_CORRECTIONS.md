# NEXPEC — Review Corrections (response to the 10-point pre-approval review)

Nothing deployed, committed, pushed, submitted, or activated. This document corrects the plan and records verification evidence. Code changes made this pass: **hardened `seed_platform_owner` + owner immutability + audited transfer** in the migration (item 2).

---

## 1. Deployment dependency order — corrected

### Dependency graph
```
                 ┌─────────────────────────────────────────────┐
                 │ migration 20260801278000                    │
                 │  • request_account_deletion() [REPLACE]     │
                 │  • platform_owner + seed/transfer + trigger │
                 │  • nx_is_platform_owner / active_super_count│
                 │  • profiles guard trigger                   │
                 │  • ai_dataset_provenance                    │
                 └───────────────┬─────────────────────────────┘
                                 │ REQUIRED BY
      ┌──────────────────────────┼───────────────────────────────┐
      ▼                          ▼                                ▼
 delete-account Edge fn     web deletion UI                 mobile deletion UI
 (new: calls               (DangerZone + DeleteAccountFlow;  (Security screen;
  nx_is_platform_owner,     reads profiles.role; calls        calls edge fn)
  expects new codes)        edge fn)
      ▲                          ▲                                ▲
      └────────── all three also work against the OLD fn/schema ──┘
                 (backward-compatibility proof below)

 legal registry changes  → INDEPENDENT of DB; code-only; gated by TERMS_VERSION (item 6)
 storage-lockdown migs    → SEPARATE reason for "DB last" (filenames below)
```

### Backward-compatibility proof (why "DB last" is safe)
The **new Edge Function** calls `admin.rpc('nx_is_platform_owner', …)`. Against the **old schema** (function absent), supabase-js returns `{data:null, error}` — it does **not** throw — so `isOwner = data === true` evaluates to `false`, and the function **still blocks admin/super_admin by role string** (owner is a super_admin, so the owner is blocked by the role check even without the RPC). It then calls `request_account_deletion` (present in both old and new schema). **Conclusion: the new Edge Function operates safely against the old schema — it is strictly a superset of protections, never a hard dependency that breaks.** Likewise the new web/mobile UI only reads `profiles.role` (exists) and calls the edge fn, so it is backward-compatible.

### The real reason for "DB push last" — storage lockdowns (exact files)
These migrations flip buckets private / change storage policies and would break old app clients still calling `getPublicUrl`:
- `20260801236000_storage_idor_lockdown.sql`
- `20260801242000_storage_pii_bucket_lockdown.sql`
- `20260801246000_client_documents_bucket_lockdown.sql`
- `20260801264000_avatars_bucket_owner_policies.sql`

`supabase db push` applies the **entire pending batch in one ordered run** — you cannot cherry-pick `20260801278000` out of it. So `278000` travels with the storage lockdowns and lands last **for the storage reason, not the account-deletion reason**.

### Corrected order (dependency-safe)
Because the DB push (with `278000`) is what actually creates the owner/admin/supplier **DB guards**, and the new Edge Function is backward-compatible, the corrected rule is:

> **Deploy the new delete-account Edge Function AFTER `supabase db push`, not before.** (My earlier plan listed the edge fn before the push — that was the ordering bug. It would not have *crashed* — the RPC call fails soft — but its owner-by-singleton feature and the new codes only work post-migration, so deploy it after.)

**Staging** (clean DB, no old clients): migration → seed owner → edge fn → web → mobile. Simple linear order.

**Production:**
1. Console prep · other edge fns
2. Web deploy (backward-compatible; also fix `NEXT_PUBLIC_ENV`)
3. Mobile submit (binaries reviewing)
4. **`supabase db push`** (storage lockdowns + `278000`) — creates all DB guards
5. **Deploy new delete-account Edge Function** (now RPC + trigger exist) ← moved to AFTER push
6. `seed_platform_owner('<prod-owner-uuid>')` (service_role)
7. Legal activation later (item 6), on counsel sign-off

During the pre-push window the **existing** production (`69740c9`) already runs the old edge fn + `/account/delete`, so there is **no new exposure**; the push+trigger is what *closes* the current owner/admin gap.

---

## 2. Platform Owner seed security — audited and FIXED

The prior seeder used `ON CONFLICT (only_one) DO UPDATE SET owner_uid = EXCLUDED.owner_uid` — a real flaw: a second call **silently replaced** the owner. Fixed in `20260801278000`:

| Requirement | Status | How |
|---|---|---|
| Works only when no owner seeded | ✅ | `IF EXISTS (SELECT 1 FROM platform_owner) THEN RAISE 'PLATFORM_OWNER_ALREADY_SET'` — INSERT-only, no upsert |
| Second call w/ different UUID rejected | ✅ | same guard (rejects regardless of UUID) — see `STAGING_VERIFICATION_TESTS.sql` TEST 6 |
| Owner row not updatable/deletable via ordinary paths | ✅ | `trg_platform_owner_immutable` BEFORE UPDATE/DELETE raises `PLATFORM_OWNER_TABLE_IMMUTABLE` unless the txn-local GUC is set (TEST 7) |
| Ownership transfer via a separate controlled, audited procedure | ✅ | `transfer_platform_owner(new_uid, reason)` — validates identity, requires reason ≥8 chars, sets txn-local GUC, updates, and writes a `critical` audit row (TEST 8) |
| Minimal EXECUTE grants | ✅ | seed + transfer: `REVOKE ALL FROM public, authenticated, anon; GRANT EXECUTE … TO service_role` (self-tested with `has_function_privilege`) |
| UUID belongs to correct profiles/auth identity | ✅ | validates `profiles.role='super_admin'` **and** `EXISTS auth.users WHERE id=uid` |

**Honest limitation (documented, not hidden):** a full **superuser / schema owner** with direct SQL could set the GUC or drop the trigger — no in-DB guard is tamper-proof against the schema owner. The protection defeats RPC-path, admin-tool, bulk-op, and accidental changes, and forces the audited procedure for legitimate transfers. **Correction to earlier wording:** re-running the seeder with another UUID is **no longer a valid "rollback/correction" path** — use `transfer_platform_owner()`.

---

## 3. Production build — status corrected

`next build` was run in the sandbox with placeholder public env vars. Result: it **initialized cleanly** (loaded `.env.local`, Next 15.5.18, no config/env/import error) but **timed out at the 45-second sandbox hard cap (exit 124)** during compilation. **This is a timeout, not a pass.** I have **no CI or non-sandbox shell available in this environment**, so I cannot complete it here.

**Corrected report wording (replaces "no launch-blocking code bugs found"):**
> **No blocker was found by completed static checks (typecheck ×3, ESLint, 4 CI guards); the production build and runtime verification remain PENDING** and must be completed in CI / Vercel and on staging.

Required manual step: run `cd apps/web && npm run build` in CI or a local shell with real env vars; capture full logs; it must exit 0 before web production.

---

## 5. Rollback — rewritten as a reviewed script
See `ROLLBACK_20260801278000.sql`. It is dependency-ordered (triggers → functions → helpers → restore prior RPC → drop tables), restores the exact prior `request_account_deletion` body from `164000`, and includes non-SQL steps (edge fn redeploy, web/mobile promote-previous, `git revert` legal). **Corrected claim:** it is **NOT zero-data-loss** — dropping `platform_owner` and `ai_dataset_provenance` loses their rows, so the script's §0 requires exporting both first. Rehearse on staging only.

---

## 6. Legal document state — clarified and tested

| Question | Answer (verified) |
|---|---|
| Are `status:'draft'` docs displayed? | **Yes.** `useResolvedLegalStack` renders docs by id regardless of `status`; the viewer shows them. No code path hides drafts. |
| Do draft docs trigger acceptance? | **Acceptance tracking** is by `(document_id, version)` in `legal_document_acceptances` (append-only, no FK). It is independent of `status`. |
| Is v1.1 enforced now? | **No.** The mobile onboarding **hard gate** keys off a *separate* constant `TERMS_VERSION = 'v1-2026-07'` in `app/(auth)/choose-role.tsx` — **not** the registry doc versions. Bumping TOS-001→1.1 changes the legal **viewer** state (`hasAccepted(id,'1.1')` = false, so the viewer shows the doc as not-yet-accepted at the new version) but does **not** force re-acceptance at onboarding. **Correction:** my earlier staging note "users will be re-prompted for v1.1" is only true for the viewer badge, not the onboarding gate. |
| Which previous versions remain active? | v1.0 acceptances remain valid records; nothing invalidates them. The gate still passes on the old `TERMS_VERSION`. |
| Suppliers before SUP-AGR-001 active? | The resolver now returns SUP-AGR-001 for `role='supplier'`, so it **displays** in the supplier legal stack. No hard gate change; suppliers are not blocked. |
| Does activation require a deploy? | **Yes.** `status`, `version`, and `TERMS_VERSION` all live in code (`registry.ts`, `choose-role.tsx`) → web + mobile deploy required. |

**To actually enforce v1.1 (do NOT do until counsel approves):** flip changed docs to `status:'active'` + set `effectiveDate`, and bump `TERMS_VERSION` in `choose-role.tsx` to force re-acceptance. Left undone deliberately.

---

## 7. Storage retention matrix (every real bucket)

Buckets confirmed from the storage migrations. Action key: **DELETE** (purge on account deletion), **RETAIN-LOCK** (keep, access-locked, business/legal basis), **MANUAL** (review before purge).

| Bucket | Contents | Personal? | Action on deletion | Currently purged by edge fn? |
|---|---|---|---|---|
| `avatars` | Profile photo (`<uid>/…`) | Personal | **DELETE** | ✅ Yes |
| `resumes` | Résumé/CV (`<uid>/…`) | Personal | **DELETE** | ✅ Yes |
| `inspector-docs` | Inspector credential/CV docs | Personal-ish | **RETAIN-LOCK** (needed for audit/dispute of completed jobs; anti-poaching already admin-locks) | ❌ No |
| `certifications` | Certificates | Personal-ish | **RETAIN-LOCK** | ❌ No |
| `profile_work_auth_documents` (bucket for work-auth) | Work authorization | Personal (sensitive) | **MANUAL** (retain for legal/fraud, or purge post-retention) | ❌ No |
| `vendor_documents` | Supplier/vendor docs | Business/personal mix | **MANUAL** | ❌ No |
| `client_documents` | Client contractual docs | Business | **RETAIN** | ❌ No (correct) |
| `documents` | Generic docs | Mixed | **MANUAL** | ❌ No |
| `compliance` | Compliance docs | Business | **RETAIN** | ❌ No (correct) |
| `contracts` | Signed contracts | Business/legal | **RETAIN** | ❌ No (correct) |
| `inspection-photos` / `inspection_photos` | Evidence images | Business evidence | **RETAIN** | ❌ No (correct) |
| `inspection-reports` / `report-images` | Reports | Business evidence | **RETAIN** | ❌ No (correct) |
| `dispute-reports` | Dispute evidence | Business/legal | **RETAIN** | ❌ No (correct) |
| `receipts` / `job-documents` | Financial/job docs | Business | **RETAIN** | ❌ No (correct) |
| `chat_attachments` | Chat files (part of audit/dispute trail) | Mixed | **RETAIN** | ❌ No (correct) |

**Corrected claim:** account deletion currently performs **personal profile-media removal (avatar + résumé)**, **not complete personal-file removal**. Credential / work-authorization / verification / vendor documents are **retained access-locked** (private buckets + RLS; the profile's `resume_url`/`cv_url` pointers are nulled) under legal/audit/fraud basis — a deliberate, justified choice, **not** full erasure. If you want true full erasure of those buckets on deletion, that is a follow-up (extend `purgePersonalStorage` to the personal ones after confirming `<uid>/` path convention and that no retained dispute needs them). The web/mobile copy has been kept accurate (it claims photo + CV removal, not "all documents").

---

## 8. AI de-identification — implemented vs planned (honest split)

**Implemented today:** **NONE.** A repo-wide search found **no** pipeline that strips GPS, EXIF, faces, names/text, serial numbers, or client/project identifiers. `inspection_captures` stores `gps_lat/gps_lng/exif_json/face_detected_count` **raw**. The only "EXIF stripped" reference is a **comment** in `src/design/haptics.ts`. The `ai_dataset_provenance` table **tracks** de-identification state (`deidentified` defaults **false**) but **does not perform** de-identification.

**Consequence / correction:**
- Retained technical data is **not currently de-identified**. Until a real de-id step exists, technical data tied to a deleted user is **still personal data**, so the "retain de-identified technical data after deletion" capability is **NOT yet actionable** — it is licensed (legally) but not operational.
- **Do not market or claim data is "de-identified."** The legal license *defines* De-Identified Technical Data and grants rights *if/when* de-identified; it does not assert the platform de-identifies automatically. That is fine legally, but operationally the de-id job is a **prerequisite** before any post-deletion AI retention actually happens.
- Recommended follow-up (not built): a de-id job that strips EXIF/GPS, blurs faces, and redacts identifiers, sets `ai_dataset_provenance.deidentified=true, deidentified_at=now()`, and only rows with `deidentified=true` become AI-eligible. Until then, treat `retention_status` as `withheld` in practice.

---

## 10. Store readiness — corrected

**Adaptive Android icon:** `assets/adaptive-icon.png` is **byte-identical** to `assets/icon.png` (both 393,493 bytes). An Android adaptive icon foreground must sit inside the ~66% safe zone (the launcher masks/zooms it); reusing the full square icon will likely be **cropped or mis-scaled**. **Action:** produce a dedicated foreground layer (logo centered in the safe zone, transparent padding) — technical + visual check required. Not verifiable from bytes alone; flagged as **Needs improvement**.

**Final missing-assets / credentials checklist**

| Item | Apple | Google Play |
|---|---|---|
| Developer account | [MANUAL] confirm | [MANUAL] confirm |
| Submit credentials | ❌ fill `eas.json` (Apple ID, ASC App ID, Team ID) [SECRET] | ❌ place `google-service-account.json` [SECRET] |
| App signing | EAS-managed | Play App Signing / upload key [SECRET] |
| Icon | ✅ from binary | ❌ **fix adaptive foreground** + 512×512 |
| Feature graphic | n/a | ❌ 1024×500 required |
| Screenshots | ❌ 6.7" + 6.5" (+ iPad or set `supportsTablet:false`) | ❌ phone (+ tablet if declared) |
| App Privacy questionnaire | ❌ complete (contact, user content, identifiers, diagnostics; no tracking) | — |
| Data Safety form | — | ❌ complete (mirror Apple + Sentry) |
| Privacy Policy URL | ✅ `/legal/privacy` (must be live) | ✅ same |
| Account-deletion URL | in-app + `/account/delete` | ✅ `/account/delete` (web) |
| Reviewer account | ❌ seed `apple_tester@nexpec.com`; **password shared out-of-band, NOT in any tracked file** | ❌ same |
| Real-device testing | ❌ TestFlight smoke | ❌ internal-testing smoke |
| Tablet/iPad decision | ❌ decide: produce iPad shots OR `supportsTablet:false` | ❌ decide tablet declaration |

**Reviewer password handling:** no password appears in any tracked file or these docs — the store docs say "provided separately / out-of-band." Keep it that way.

---

## Corrected Go / No-Go

| Surface | Verdict | Basis |
|---|---|---|
| **Staging** | ✅ Go | Static checks green; seeder now secure; rollback + verification scripts ready; migration additive |
| **Web production** | 🟡 No-Go until: CI `next build` passes · `NEXT_PUBLIC_ENV` fixed · staging P0 + deletion-matrix pass | Build is PENDING (timeout, not pass) |
| **Android** | 🟡 No-Go until: adaptive icon fixed · assets/credentials · data-safety · device smoke | Config ready; assets missing |
| **iOS** | 🟡 No-Go until: submit creds · screenshots/iPad decision · App Privacy · reviewer seed · device smoke | Config ready; creds/assets missing |
| **Public marketing** | 🟡 Pre-launch/early-access package only (see `MARKETING_CLAIMS_AND_PACKAGES.md`); no "live"/store claims until listings verified | Claims audited + softened |

**Honest overall:** the **code, migration (now with a secure seeder), edge function, legal text, rollback, and static gates are ready**; **production build + staging runtime verification + de-identification pipeline + store assets remain genuinely pending.** Do not deploy, submit, activate legal, or publish marketing yet.
