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
| Role | Account | Platform | Actions | Expected | rc | Verdict | Evidence | DB readback |
|---|---|---|---|---|---|---|---|---|
| client | qa.client@nexpec.test | Android (API 31 fresh AVD, release APK) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=1 in=1 ident=1 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 31 fresh AVD, release APK) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=127 in=381 ident=127 explore=127 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 31 fresh AVD, release APK) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=3 ident=1 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 31 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=1 ident=1 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 31 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=1 in=1 ident=1 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=1 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=1 | FAIL | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| client | qa.client@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-client.png, and-client-identity.png, and-client-tabs.png | uuid=0d06d2ba-5651-4265-9143-06ee82a3d6a4 fresh-session + role=client terms=set |
| inspector | qa.inspector@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-inspector.png, and-inspector-identity.png, and-inspector-tabs.png | uuid=a7556734-3754-4bdd-8aaf-9fc6288c7464 fresh-session + role=inspector terms=set |
| talent | qa.talent@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-talent.png, and-talent-identity.png, and-talent-tabs.png | uuid=6682e107-4231-427a-a207-842070fe951b fresh-session + role=inspector terms=set |
| rfqbuyer | qa.rfqbuyer@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-rfqbuyer.png, and-rfqbuyer-identity.png, and-rfqbuyer-tabs.png | uuid=0bfbd7cb-41b8-4aec-8d43-5a12e1bbfc24 fresh-session + role=client terms=set |
| agency | qa.agency@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-agency.png, and-agency-identity.png, and-agency-tabs.png | uuid=3b0b0d85-5718-4195-b20d-a2d14b95a36a fresh-session + role=agency terms=set |
| enterprise | qa.enterprise@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=1 in=1 ident=1 explore=1 | FAIL | and-enterprise.png, and-enterprise-identity.png, and-enterprise-tabs.png | uuid=1852da2d-f7d2-4f0c-8ffb-48a2a761975f fresh-session + role=enterprise terms=set |
| enterprise | qa.enterprise@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-enterprise.png, and-enterprise-identity.png, and-enterprise-tabs.png | uuid=1852da2d-f7d2-4f0c-8ffb-48a2a761975f fresh-session + role=enterprise terms=set |
| supplier | qa.supplier@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=1 | FAIL | and-supplier.png, and-supplier-identity.png, and-supplier-tabs.png | uuid=6d10ec5b-5858-45be-9671-5cbd0ded1b50 fresh-session + role=supplier terms=set |
| supplier | qa.supplier@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-supplier.png, and-supplier-identity.png, and-supplier-tabs.png | uuid=6d10ec5b-5858-45be-9671-5cbd0ded1b50 fresh-session + role=supplier terms=set |
| senior | qa.senior@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=1 | FAIL | and-senior.png, and-senior-identity.png, and-senior-tabs.png | uuid=eebb4407-c22c-44a9-9455-7ee4a740190b fresh-session + role=senior terms=set |
| senior | qa.senior@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-senior.png, and-senior-identity.png, and-senior-tabs.png | uuid=eebb4407-c22c-44a9-9455-7ee4a740190b fresh-session + role=senior terms=set |
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-admin.png, and-admin-identity.png, and-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |
| superadmin | qa.tmpsuper.r8wkc8y@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-superadmin.png, and-superadmin-identity.png, and-superadmin-tabs.png | uuid=bf833213-9ed6-4a2a-aae1-0288d3957096 fresh-session + role=super_admin terms=NULL |
| talent | qa.talent@nexpec.test | Android (API 34 fresh AVD, release APK, adb/uiautomator driver) | sign-out → sign-in → in-app email visible → tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | and-talent.png, and-talent-identity.png, and-talent-tabs.png | uuid=6682e107-4231-427a-a207-842070fe951b fresh-session + role=inspector terms=set |


## 2. iOS — Role rows

Driver: Maestro iOS (XCUITest) with **text selectors + verified point-taps**.
**Maestro text matching is case-insensitive**: the admin dashboard's
"Welcome back" header satisfies a "Welcome Back" (login screen) selector, which
made one sign-out run a silent no-op. Goal-state checks therefore use the
unambiguous login subtitle "Sign in to continue your inspections".
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
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=1 in=1 ident=1 explore=0 | FAIL | ios-admin.png, ios-admin-identity.png, ios-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |
| admin | qa.tmpadmin.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-admin.png, ios-admin-identity.png, ios-admin-tabs.png | uuid=acbda408-c2de-4b7d-a8c2-7a99c6514413 fresh-session + role=admin terms=NULL |
| superadmin | qa.tmpsuper.r8wkc8y@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-superadmin.png, ios-superadmin-identity.png, ios-superadmin-tabs.png | uuid=bf833213-9ed6-4a2a-aae1-0288d3957096 fresh-session + role=super_admin terms=NULL |
| senior | qa.senior@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=1 explore=0 | FAIL | ios-senior.png, ios-senior-identity.png, ios-senior-tabs.png | uuid=eebb4407-c22c-44a9-9455-7ee4a740190b fresh-session + role=senior terms=NULL |
| senior | qa.senior@nexpec.test | iOS sim (18.2) | sign-out → sign-in → stance 'Inspector' → in-app email visible → 5-tab sweep | identity-proved session | out=0 in=0 ident=0 explore=0 | PASS | ios-senior.png, ios-senior-identity.png, ios-senior-tabs.png | uuid=eebb4407-c22c-44a9-9455-7ee4a740190b fresh-session + role=senior terms=set |

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
| 6 | Literal `model.run()` (release APK, models read from APK, no Metro) | **PASS** — real camera → shutter → Use & Save → production `persistPhotoCapture` path. wda-fissure-detector: in `[1,3,1024,1024]` f32 NCHW (1/255), out lengths **881664 + 2097152**, **2327 ms**. yolov9t-weld-detector: in `[1,3,640,640]`, out length **50400** (`[1,6,8400]`), **226 ms**. `[seg-qa-load]` proves APK-embedded asset via expo-asset `file://` URI (8,448,370 B / 41,995,363 B, exists=true); `[seg-qa-model]` prints interpreter schema; native `Initialized TensorFlow Lite runtime` in logcat | `tflite-and-online-*.png`, `tflite-and-online-logcat.txt` |
| 7 | Capture sync → Staging readback | **PASS** (after D35 fix) — outbox drain uploads file then inserts row in one idempotent op. Row `4b91accb` on Staging (14:15:35Z), object at `captures/5481d15e…/56bee4ae…/4b91accb….jpg` (18,328 B, image/jpeg) downloaded; **exact recompute**: sha256(base64(object)) = `8107473d…` → canonical metadata → sha256 = `6e38eb65e271…` = row `capture_sha256`, bit-for-bit | `staging-capture-4b91accb.jpg` + recompute transcript |

## 4. Defects raised in this lane

| ID | Severity | Summary | Status |
|---|---|---|---|
| D29 | P1 (mobile crash) | AI Co-Inspector gestures crashed: no `GestureHandlerRootView` at expo-router root; second instance required INSIDE the camera `Modal` (separate native host) | **Fixed** 261dcd5 + regression comment; verified on device |
| D30 | P1 (AI dead on release) | Literal `model.run()` unreachable — three stacked causes, each proven by its own native stack: (a) release packs `.tflite` as mangled `res/` names → Kotlin AssetLoader `JniException`; (b) `loadTensorflowModel` REQUIRES the delegates arg (no default) → opaque `jsi::JSError` in `createModel` ~280 ms; (c) `run()` takes raw `ArrayBuffer[]`, a `TypedArray` throws `JSINativeException` in 3 ms | **Fixed** 2871cef (expo-asset `downloadAsync` → `file://`), 8a9a9a4 (pass `[]` delegates), 6282af1 (raw ArrayBuffer in, `Float32Array` re-view out). Release-verified: see §3 rows 6–7 |
| — | product data | Staging `inspection_evidence_requirements` empty for every template → wizard dead-ended "No requirements to capture." | Seeded API 510 (2 reqs), weld (1), RT (1) on Staging; durable idempotent seed committed (`scripts/qa/seed-evidence-requirements.mjs`, 2nd run creates 0 rows) |
| D31 | P1 (privilege loss + legal gate) | (a) `senior` missing from `apply_onboarding_role`'s protected-role guard — confirming any stance card silently DEMOTED a senior reviewer; (b) refusal path returned before stamping ToS acceptance, so protected roles could never record consent via mobile | **Fixed** — migration renumbered `20260801554000` (548000 collided with applied remote head), pgTAP guard suite 10/10, applied to Staging with in-transaction self-test NOTICE; UI-verified: senior kept role, terms stamped 07:56:10Z |
| D32 | P1 (dead-end) | Signing out on the stance chooser stranded the user on a dead screen: chooser is in `(auth)`, and the signed-out gate only navigated users outside `(auth)` — session cleared, router stayed | **Fixed** a38ef87 (explicit route after signOut + gate handles parked choose-role); found by iOS matrix when the escape hatch produced no transition in 60 s |
| D33 | P1 (whole-app crash) | Android release with no Google Maps API key: `MapView.<init>` throws `RuntimeException` → expo-updates "could not recover, crashing" → white screen on EVERY route (jobs tab ×2 sites + map screen) | **Fixed** 2015f97 — `SafeMap` gate (`mapsAvailable()` requires `android.config.googleMaps.apiKey`; `MapUnavailable` placeholder, testID `map-unavailable`); key plumbed via `GOOGLE_MAPS_ANDROID_API_KEY` in app.config.js |
| D34 | P1 (test-integrity + prod risk) | expo-updates `CHECK_ON_LAUNCH=ALWAYS` + cached remote update silently REPLACED the JS bundle under test — "fixes not working" was the updater swapping code at launch; same mechanism can override any hermetic build | **Fixed** 69ab66a — `updates.enabled=false` when `QA_DISABLE_UPDATES=1`; verified in compiled manifest via aapt (`expo.modules.updates.ENABLED` = 0x0) |
| D35 | P1 (evidence loss) | `compliance` storage bucket never created — the 20260801532000 bucket sweep derived from web server actions and missed the mobile bucket. Capture upload → 400 "Bucket not found" → outbox classifies **fatal** → silent dead-letter (release strips console.log): captures stuck PENDING locally forever, zero rows/objects server-side. Also breaks CCI applications, compliance job docs, and VCA affidavit storage on any environment built from the repo | **Fixed** 2b60a64 — migration `20260801556000`: private bucket, 25 MB cap, MIME from observed writers; owner/admin policy shape of 532000; ONE narrow anon SELECT for `affidavits/` (public verify page signs URLs sessionless by design). Applied to Staging (self-check NOTICE); proven by §3 row 7. Release-safe `[outbox-qa]` drain-failure logging added (was fully silent) |

## 5. Unsupported-role decisions (intentional, truthful refusal required)

<!-- UNSUPPORTED ROLES -->

## 2b. iOS per-role live log (append-only)

- `qa.client@nexpec.test` | iOS | rc=1 | landing: NEXPEC PEC The Future of Inspection  | evidence: `qa-artifacts/mobile-matrix/ios-client.png` | 22:50:19
- `qa.client@nexpec.test` | iOS | rc=124 | landing: NEXPEC PEC The Future of Inspection  | evidence: `qa-artifacts/mobile-matrix/ios-client.png` | 22:55:51
- `qa.client@nexpec.test` | iOS | rc=124 | landing: NEXPEC MONDAY, AUG 17 Good evening, QA OPS qa.client@nexpec.test MONDA | evidence: `qa-artifacts/mobile-matrix/ios-client.png` | 23:01:39
- `qa.client@nexpec.test` | iOS | out=1 in=1 | landing: NEXPEC MONDAY, AUG 17 Good evening, QA OPS qa.client@nexpec.test MONDA | `qa-artifacts/mobile-matrix/ios-client.png` | 23:10:42

## 6. Environment / harness records (2026-08-18, D35–D36 phase)

- **Hermeticity near-miss, caught by mandatory verification**: one rebuild lane
  (post-compaction) omitted the Staging `EXPO_PUBLIC_*` exports; Expo's dotenv
  chain (`.env`/`.env.local` → Production ref) filled the bundle env. The
  verify step reported `staging-refs: 0, prod-refs: 1` and the lane was stopped
  before install. Rule made structural: `build-verify-install.sh` now aborts
  unless the exported bundle env is Staging, and NEVER installs an APK that
  fails size / staging=1 / prod=0 / seg-qa / D36-watchdog / outbox-qa /
  updates-disabled checks (verified again on the device-pulled bundle).
- **Gradle env is not a task input**: changing `EXPO_PUBLIC_*` does NOT
  invalidate `createBundleReleaseJsAndAssets`; the generated bundle outputs
  must be deleted to force a re-bundle. (This is how a stale-env bundle can
  silently survive a "successful" rebuild.)
- **Disk incident**: host hit 0 bytes free mid-qualification (shell execution
  itself failed). Recovered 2.0Gi → 16Gi by deleting only regenerable build
  artifacts (app/build, .cxx trees, gradle transforms, ~/.expo, uv/pip download
  caches, pulled-APK copies). All fixtures/evidence preserved. Release builds
  now require ≥15Gi free before launch.
- **Build OOM**: `:app:collectReleaseDependencies` (AGP dependency-metadata
  task) OOMs at the CNG default 2G heap on a full dependency graph re-run;
  `android/gradle.properties` (gitignored) bumped to `-Xmx4096m`. Excluding
  the task instead breaks `:app:sdkReleaseDependencyData` — don't.
- **Offline cold-start**: the compliance wizard requires network to load the
  requirement catalog; a cold offline launch lands on the error boundary
  (graceful, screenshot `tflite-and-offline-coldstart.png`). Warm-offline is
  the truthful field scenario and is the one proven.
- **Wizard CTA taps**: OCR cannot see white-on-purple button text and list
  growth shifts layout; `adbui.py tappurple` finds the primary CTA by pixel
  band (RGB 124,58,236) instead of fixed coordinates.

## 7. D36/D37 on-device proofs + controlled-image evidence (2026-08-18)

**Build under test** (all rows below): hermetic arm64 release APK, verified
before every install — Staging×1 / Prod×0 in the Hermes bundle,
`expo.modules.updates.ENABLED=0x0`, `[seg-qa]`/`[outbox-qa]`/`OpWatchdogTimeout`
markers present, device-pulled bundle re-verified after install. Sole signed-in
identity per lane proven three ways (visible email screenshot, fresh
`last_sign_in_at` by UUID, profile role by that UUID).

### 7.1 Warm-offline camera capture + automatic no-restart drain (D36 proof)

| Step | Evidence |
|---|---|
| Wizard loaded ONLINE (Structural Weld, "Weld bead close-up") | `tflite-and-offlinewarm-1-wizard.png` |
| Network cut BEFORE capture (`Lost default Internet network` in logcat) | `tflite-and-offlinewarm-1b-network-cut.png` |
| Real camera → shutter → Use & Save, all offline | `…-2-camera/3-preview/4-overlay.png` |
| Literal offline `model.run()`: wda-fissure-detector, in `[1,3,1024,1024]` f32 (3,145,728 floats), out **881,664 + 2,097,152**, **1947 ms**, model from local `file://` (41,995,363 B) | `[seg-qa-gate/load/model/input]` + `[seg-qa]` lines, `tflite-and-offlinewarm-logcat.txt` |
| Reconnect — NO app restart → automatic drain in 24.7 s, zero `[outbox-qa]` failures | row `4d7a60bc` created 18:08:21.701Z vs captured 18:07:57.044Z |
| UI shows the capture with its hash `5c938fa48c32…` = row `capture_sha256` | `…-5-saved.png`, `…-6-ai-result.png` |
| Value verification: object 18,321 B downloaded → `file_sha256` recomputed → canonical metadata → `capture_sha256` **bit-for-bit match**; chain `4d7a60bc → c295c78e → 1f049583 → 4b91accb` verified by value (chain is per-JOB: links across requirements) | `staging-capture-4d7a60bc.jpg` + verify transcript |

Pre-fix control (same day): capture `1f049583` taken offline 14:29:11 stayed
queued until an app RESTART drained it 14:35:51 — the D36 wedge, observed live,
then eliminated (watchdogReplay.test.mjs + the no-restart drain above).

### 7.2 Controlled-image inference — production `analyze()` on release APK (/mldiag)

Camera-content limitation documented in §6 (virtualscene black under
SwiftShader; iOS Simulator has no camera) — content proof runs through the
owner-sanctioned `/mldiag` screen calling the EXACT production entry point
(`SegModelManager.analyze`, same call as capture.tsx). Images bundled
byte-identical to `qa-artifacts/tflite-test-set/MANIFEST.md` (SHA-256
recomputed ON DEVICE each run and shown in the UI + logs).

| Image (sha256, device-recomputed) | Model | ms | Detections (label:score) | Expected | Read |
|---|---|---|---|---|---|
| weld-defect-crack-1 (`58e087f6d0a4…`) | wda-fissure | 2034 | none | weld defect | miss (diagram-style image) |
| weld-defect-crack-1 | yolov9t | 266 | inclusion:0.58, inclusion:0.301 | weld defect | **defect detected** |
| weld-defect-crack-2 (`38e1c6b97a17…`) | wda-fissure | 2227 | none | weld defect | miss |
| weld-defect-crack-2 | yolov9t | 156 | none | weld defect | miss (recall limit, truthful) |
| corrosion-1 (`aab2161f503c…`) | corrosion | 2210 | rust:0.325, rust:0.257 | corrosion | **corrosion detected** |
| corrosion-2 (`d8197ec0f27b…`) | corrosion | 1739 | none | corrosion | miss (recall limit, truthful) |
| clean-weld (`e746213353c1…`) | wda-fissure | 1713 | Welding line:0.694 | clean | structural class only — correct |
| clean-weld | yolov9t | 304 | none | clean | **correct (no findings)** |
| negative-control-cat (`f91f1e37a233…`) | wda-fissure | 2101 | none | negative | **correct (no false positive)** |
| negative-control-cat | corrosion | 1809 | none | negative | **correct (no false positive)** |

Run-completed ≠ accuracy-PASS: detection hits/misses recorded separately above.
Evidence: `mldiag-online-top.png` + scrolls, `[seg-qa-diag]` JSON lines
(`mldiag-online-logcat.txt`) — every line carries the full device-side SHA-256.

### 7.3 D37 gates (post-fix build)

- **Gate A (functional)**: full set ONLINE (10 runs) + full set OFFLINE
  (10 runs, `Lost default Internet` ×2) = 22/22 `[seg-qa-diag]` lines,
  0 errors, 0 `OutOfMemoryError`, 0 JSI/JNI exceptions. Concurrency=1 by
  construction (screen awaits each run; manager serializes swap+dispose).
- **Gate B (bounded memory)**: 20 sequential inferences, **18 model loads**
  (≥8 swaps required); native heap sampled every 3 s (`d37-mem.log`, 462
  samples): peak 312 MB during pass 1 → settles to a **flat 265 MB plateau
  for 23 idle minutes (+0.3 % drift)** → peaks 527 MB in-flight during pass 2
  → 0 OOM. Pre-fix control: identical 10th run (corrosion re-acquire) threw
  `OutOfMemoryError: Failed to allocate 42004707 bytes … 179MB/192MB` after
  blocking GCs freed only KBs (`mldiag-offline-logcat.txt`).
- Identity for the gate lane: fresh qa.talent sign-in 19:19:20Z, UUID
  `6682e107…`, role=inspector, SESSION-ASSERT PASS (`d37-2-identity.png`).

### 7.4 Defects raised

| ID | Severity | Summary | Status |
|---|---|---|---|
| D36 | P1 (field data loss) | Hung upload fetch (reconnect flap) wedged the singleton outbox worker for the process lifetime — offline captures never synced until app restart; drain failures also fully silent in release | **Fixed** e643e1e (per-op 180 s watchdog, timeout=transient by construction) + 2fb11c3; regression `watchdogReplay.test.mjs` (hung op abandoned <5 s, bounced not lost, completes on retry) + on-device no-restart drain proof §7.1 |
| D37 | P1 (AI dead after use) | Evicted TFLite models retained until Hermes GC (which feels no ART pressure) — ~4 swaps of 42 MB models OOM a 192 MB-heap device; surfaced as opaque `JniException` | **Fixed** 31b28a6 (eager Nitro `dispose()` on eviction); gates §7.3 |
| — | observation | Offline COLD start of the app lands on the stance chooser (profile fetch fails → treated as no-stance) instead of a cached-role landing; stance save then fails truthfully offline ("Could not save role — Network request failed", no server write). Recovered by reconnect. | Recorded for owner triage (routing hardening candidate; no data corruption — D31 guard + failed network write both held) |
