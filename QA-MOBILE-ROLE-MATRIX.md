# QA-MOBILE-ROLE-MATRIX — Role × Platform × Feature evidence

**Scope**: Full role-by-role Mobile qualification against **Staging only**
(`zmzvmgaeovleuvbvwxei`). Production untouched. Required by the FINAL COMPLETION
ADDENDUM: one row per Role × Platform × Feature; unsupported roles must fail
truthfully (no crash, no dead-end, no data leak).

**Builds under test**
- **Android**: `android/app/build/outputs/apk/release/app-release.apk` (177 MB,
  `assembleRelease`, arm64-v8a, Hermes bundle embedded, models embedded,
  `EXPO_PUBLIC_ML_RUNTIME=1`). Runtime bundle proof: `strings` on the embedded
  Hermes bundle → Staging refs ×1, Production refs ×0 (run 28 checkpoint).
  Device: emulator-5554 (API 35, hardware GPU `-gpu auto`).
- **iOS**: `ios/build/Build/Products/Debug-iphonesimulator/NEXPEC.app`
  (clean Simulator build, Debug **dev-client** — no embedded `main.jsbundle`;
  runs against local Metro with the same Staging env). Simulator UDID
  `0E876197-FBFD-40FA-80B3-5AF5A8E0758F`. Release-parity ML evidence is carried
  by the Android release APK lane (see TFLite section); the iOS leg qualifies
  role UX on the identical JS bundle source.

**Accounts** (Staging; passwords withheld — standard QA credential, no secrets here)
| Account | DB role (`profiles.role`) | Notes |
|---|---|---|
| qa.client@nexpec.test | client | |
| qa.inspector@nexpec.test | inspector | |
| qa.talent@nexpec.test | inspector | Talent persona; contractor on COMPLIANCE job |
| qa.senior@nexpec.test | senior | |
| qa.supplier@nexpec.test | supplier | |
| qa.agency@nexpec.test | agency | |
| qa.enterprise@nexpec.test | enterprise | |
| qa.rfqbuyer@nexpec.test | client | RFQ-Buyer persona |
| qa.tmpadmin.r8wkc8y@nexpec.test | admin | TEMP — revoked after this matrix |
| qa.tmpsuper.r8wkc8y@nexpec.test | super_admin | TEMP — revoked after this matrix |

Role list discovered authoritatively from the `profiles_role_allowed` CHECK
constraint (baseline migration): inspector, client, agency, enterprise,
supplier, senior, admin, super_admin. Talent and RFQ-Buyer are personas of
inspector/client, exercised as separate accounts.

**Method**: per-role deterministic driver flow (sign in → wait for auth
landing → screenshot; role switching via the app's real Sign out → Sign in, no
reinstall/`pm clear` between roles), bounded per-role watchdog, screenshot +
landing title per role. Screenshots are ground truth. Evidence in
`qa-artifacts/mobile-matrix/`.

**Environment record (2026-08-17)**: the original Android AVD (`nexpec_qa`,
API 35 Google-APIs Pixel, 2.5 GB guest RAM on an 8 GB host) is recorded as an
**unreliable QA environment** — repeated `system_server`/SystemUI ANR
deadlocks under release-APK cold-start pressure, independent of the product
(the app rendered its login screen correctly on every attempt). It is NOT used
for the final matrix. The final Android matrix runs on a fresh lightweight
arm64 AVD (see §1). This is an environment finding, not a product failure.

---

## 1. Android — Role × Feature rows

<!-- ROWS FILLED FROM batch bj8jf1ewr -->

## 2. iOS — Role rows

Driver: Maestro iOS (XCUITest) with **text selectors + verified point-taps**.
RN `testID`s do not surface as accessibilityIdentifier on this Fabric build
(only react-navigation's `tabBarButtonTestID` does — hierarchy-dump proof,
run 29); text full-match selectors are the reliable primitive. Secure password
fields drop characters on fast injection (verified on two drivers), so the
password types one character per step. Role switching uses the app's real
sign-out (Settings → Sign Out → confirm alert); the stance chooser's
escape-hatch "Sign out" covers the terms-gate state. App installed ONCE; no
erase/reinstall between roles.

<!-- ROWS FILLED FROM iOS leg -->
| Role | Account | Platform | Actions | Expected | rc | Verdict | Evidence | DB readback |
|---|---|---|---|---|---|---|---|---|
| client | qa.client@nexpec.test | iOS sim (18.2) | sign-out → sign-in (char-by-char pw) → 5-tab sweep | signed-in client dashboard + tabs render | out=0 in=0 explore=0 | PASS | ios-client.png, ios-client-tabs.png | db: client/terms-set (expect client) ROLE-OK |
| inspector | (see rerun below) | iOS sim (18.2) | — | — | — | **INVALID — WRONG SESSION** (harness typed default client email; caught by owner live screenshot; superseded by identity-proof rerun) | ios-inspector.png shows qa.client | — |
| talent | (see rerun below) | iOS sim (18.2) | — | — | — | **INVALID — WRONG SESSION** (harness typed default client email; caught by owner live screenshot; superseded by identity-proof rerun) | ios-talent.png shows qa.client | — |
| rfqbuyer | (see rerun below) | iOS sim (18.2) | — | — | — | **INVALID — WRONG SESSION** (harness typed default client email; caught by owner live screenshot; superseded by identity-proof rerun) | ios-rfqbuyer.png shows qa.client | — |
| agency | (see rerun below) | iOS sim (18.2) | — | — | — | **INVALID — WRONG SESSION** (harness typed default client email; caught by owner live screenshot; superseded by identity-proof rerun) | ios-agency.png shows qa.client | — |
| client | qa.client@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Client' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-client.png, ios-client-identity.png, ios-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| agency | qa.agency@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Agency' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=1 explore=0 | FAIL | ios-agency.png, ios-agency-identity.png, ios-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=NULL |
| agency | qa.agency@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Agency' → in-app email visible → 5-tab sweep | identity-proved session | out=1 in=1 ident=1 explore=0 | FAIL | ios-agency.png, ios-agency-identity.png, ios-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=NULL |
| agency | qa.agency@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Agency' → in-app email visible → 5-tab sweep | identity-proved session | out=1 in=1 ident=1 explore=0 | FAIL | ios-agency.png, ios-agency-identity.png, ios-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=NULL |
| agency | qa.agency@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Agency' → in-app email visible → 5-tab sweep | identity-proved session | out=1 in=1 ident=1 explore=0 | FAIL | ios-agency.png, ios-agency-identity.png, ios-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=NULL |
| agency | qa.agency@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Agency' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=1 explore=0 | FAIL | ios-agency.png, ios-agency-identity.png, ios-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=NULL |
| agency | qa.agency@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Agency' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-agency.png, ios-agency-identity.png, ios-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=set |
| inspector | qa.inspector@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-inspector.png, ios-inspector-identity.png, ios-inspector-tabs.png | uuid=a7556734-3754-4bdd-8aaf-9fc6288c7464 fresh-session + role=inspector terms=set |
| talent | qa.talent@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-talent.png, ios-talent-identity.png, ios-talent-tabs.png | uuid=6682e107-4231-427a-a207-842070fe951b fresh-session + role=inspector terms=set |
| rfqbuyer | qa.rfqbuyer@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Client' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=1 explore=0 | FAIL | ios-rfqbuyer.png, ios-rfqbuyer-identity.png, ios-rfqbuyer-tabs.png | uuid=0bfbd7cb-41b8-4aec-8d43-5a12e1bbfc24 fresh-session + role=client terms=NULL |
| rfqbuyer | qa.rfqbuyer@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Client' → in-app email visible → 5-tab sweep | identity-proved session | out=1 in=1 ident=1 explore=0 | FAIL | ios-rfqbuyer.png, ios-rfqbuyer-identity.png, ios-rfqbuyer-tabs.png | uuid=0bfbd7cb-41b8-4aec-8d43-5a12e1bbfc24 fresh-session + role=client terms=NULL |
| rfqbuyer | qa.rfqbuyer@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Client' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-rfqbuyer.png, ios-rfqbuyer-identity.png, ios-rfqbuyer-tabs.png | uuid=0bfbd7cb-41b8-4aec-8d43-5a12e1bbfc24 fresh-session + role=client terms=set |
| enterprise | qa.enterprise@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Enterprise' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-enterprise.png, ios-enterprise-identity.png, ios-enterprise-tabs.png | uuid=1852da2d-f7d2-4f0c-8ffb-48a2a761975f fresh-session + role=enterprise terms=set |
| supplier | qa.supplier@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Vendor' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-supplier.png, ios-supplier-identity.png, ios-supplier-tabs.png | uuid=6d10ec5b-5858-45be-9671-5cbd0ded1b50 fresh-session + role=supplier terms=set |
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=124 ident=1 explore=0 | FAIL | ios-admin.png, ios-admin-identity.png, ios-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=1 ident=0 explore=0 | FAIL | ios-admin.png, ios-admin-identity.png, ios-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=1 ident=0 explore=0 | FAIL | ios-admin.png, ios-admin-identity.png, ios-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=1 ident=0 explore=0 | FAIL | ios-admin.png, ios-admin-identity.png, ios-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |

### iOS terms-gate / consent-path proof (2026-08-18)

The stance-chooser consent flow was proven **through the real UI once,
end-to-end** (qa.rfqbuyer): chooser → Client card → "Continue as Client" →
`apply_onboarding_role` → landed on rfqbuyer's own client dashboard;
`terms_accepted_at` stamped 06:38:06Z **and** both per-document ledger rows
written (TOS-001 1.1, PRIV-001 1.1). Evidence: `ios-rfqbuyer-consent.png` +
Staging readback. Driven by HID-level taps — Maestro/XCTest synthesized taps
do not reach this animated carousel's buttons (documented automation-
environment limitation, NOT a product defect: human/HID taps work, and D32
fixed the real product bug on this screen).

For matrix-run reliability, the remaining terms-NULL fixtures (qa.enterprise,
qa.supplier — and earlier qa.agency during D33 investigation) had their ToS
acceptance recorded via the SAME RPC the button calls, each authenticated as
its own account (identical server path; visible in `terms_version`
v1-2026-07). Their matrix rows therefore exercise sign-in/identity/tab
navigation without re-traversing the flaky-under-XCTest carousel.

## 3. Compliance capture chain + literal TFLite inference (Android)

Fixture: `QA-OWNER-REVIEW-COMPLIANCE` job `5481d15e-dbf1-4fef-9d9a-551ee0b5a500`
(status `in_progress`, contractor qa.talent `6682e107`), scope template
`radiographic_weld_review_rt` (`214ec98f`) with one required photo requirement
"RT film photograph" (min 1 / max 3).

Dev-client evidence chain (run 28, `qa-artifacts/mobile-matrix/tflite-01…13.png`):

| # | Screen/Action | Result | Evidence |
|---|---|---|---|
| 1 | Compliance wizard opens via deep link `nexpec://compliance/job/5481d15e…/capture` | Requirement list renders (was "No requirements to capture." — Staging catalog was empty for ALL templates; seeded as product data fix) | tflite-01, tflite-02 |
| 2 | Open camera (in-Modal) | Camera renders; D29 fixed (GestureHandlerRootView at expo-router root AND inside RN Modal — separate native host) | tflite-03 |
| 3 | Shutter → seal | GPS/EXIF captured, SHA-256 chain `5e7d1af6…` / `2c47b311…`, "requirement satisfied ✓" | tflite-04, tflite-05 |
| 4 | AI Co-Inspector panel | Renders; per-scope model selection correct ("On-device model: Welding / WDA defects (wda-fissure-detector v1)"); registry lane truthfully `[ml] unavailable: no_artifact` (Staging registry empty — expected) | tflite-05, tflite-06 |
| 5 | Literal `model.run()` (dev client) | **D30**: dev-client asset path fails (40 MB model → 24 s → JSI error; 8 MB yolov9t resolves Metro URL then Kotlin AssetLoader `JniException`). Dev-asset-path defect, not a model defect | run 28 checkpoint |
| 6 | Literal `model.run()` (release APK, models read from APK, no Metro) | <!-- RELEASE RESULT --> | <!-- EVIDENCE --> |

## 4. Defects raised in this lane

| ID | Severity | Summary | Status |
|---|---|---|---|
| D29 | P1 (mobile crash) | AI Co-Inspector gestures crashed: no `GestureHandlerRootView` at expo-router root; second instance required INSIDE the camera `Modal` (separate native host) | **Fixed** 261dcd5 + regression comment; verified on device |
| D30 | P2 (dev-only) | Bundled TFLite models unloadable in dev-client (Metro asset path); release APK embeds models in APK | <!-- D30 STATUS --> |
| — | product data | Staging `inspection_evidence_requirements` empty for every template → wizard dead-ended "No requirements to capture." | Seeded API 510 (2 reqs), weld (1), RT (1) on Staging; durable idempotent seed committed (`scripts/qa/seed-evidence-requirements.mjs`, 2nd run creates 0 rows) |
| D31 | P1 (privilege loss + legal gate) | (a) `senior` missing from `apply_onboarding_role`'s protected-role guard — confirming any stance card silently DEMOTED a senior reviewer; (b) refusal path returned before stamping ToS acceptance, so protected roles could never record consent via mobile | Migration `20260801548000` + pgTAP `apply_onboarding_role_guard_test.sql` written; local proof + Staging apply pending (gates phase) |
| D32 | P1 (dead-end) | Signing out on the stance chooser stranded the user on a dead screen: chooser is in `(auth)`, and the signed-out gate only navigated users outside `(auth)` — session cleared, router stayed | **Fixed** a38ef87 (explicit route after signOut + gate handles parked choose-role); found by iOS matrix when the escape hatch produced no transition in 60 s |

## 5. Unsupported-role decisions (intentional, truthful refusal required)

<!-- UNSUPPORTED ROLES -->

## 2b. iOS per-role live log (append-only)

- `qa.client@nexpec.test` | iOS | rc=1 | landing: NEXPEC PEC The Future of Inspection  | evidence: `qa-artifacts/mobile-matrix/ios-client.png` | 22:50:19
- `qa.client@nexpec.test` | iOS | rc=124 | landing: NEXPEC PEC The Future of Inspection  | evidence: `qa-artifacts/mobile-matrix/ios-client.png` | 22:55:51
- `qa.client@nexpec.test` | iOS | rc=124 | landing: NEXPEC MONDAY, AUG 17 Good evening, QA OPS qa.client@nexpec.test MONDA | evidence: `qa-artifacts/mobile-matrix/ios-client.png` | 23:01:39
- `qa.client@nexpec.test` | iOS | out=1 in=1 | landing: NEXPEC MONDAY, AUG 17 Good evening, QA OPS qa.client@nexpec.test MONDA | `qa-artifacts/mobile-matrix/ios-client.png` | 23:10:42
