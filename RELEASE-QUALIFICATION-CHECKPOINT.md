# NEXPEC Release Qualification — Checkpoint

> **Status: IN PROGRESS — NOT COMPLETE.** Section 00 is the newest work and the
> exact resume point; everything below it is earlier runs and remains accurate
> except where a newer section corrects it.

---

## 00. RUN 5 — 2026-08-16, current session

**HEAD at start: `6840a1d`, branch `release/identity-replacement`, clean, synced.**

### 00.1 The two blockers from run 4 are BOTH cleared

| Run 4 said | Physical reality now |
|---|---|
| "Browser walks blocked — 0 bypass keys exist, every create/revoke endpoint 404s" | **A bypass key EXISTS** on the project (`automation-bypass`, owner-created after run 4). Browser access is **restored and working**. |
| "D8 root cause: nitro 0.35.9 targets RN 0.83; downgrade the dependency" | **Root cause was misdiagnosed.** It is a *named-argument* mismatch, fixable in place. No downgrade needed. See 00.3. |

### 00.2 Preview at HEAD, and it targets Staging

* Preview at exactly `6840a1d`: `nexpec-main-platform-i3ko4l8mz-ebi137394s-projects.vercel.app`
* **Anonymous access is protected** — `GET /sign-in` → **302** to `vercel.com/sso-api`,
  15 bytes, **0** NEXPEC markers. SSO protection stays `all_except_custom_domains`.
* **Staging proof 1** — across the 13 served `_next/static` chunks + the HTML:
  `zmzvmgaeovleuvbvwxei` **×1**, `sxqpjxhslzzcdrdctatm` **×0**.
* **Staging proof 2** — the only `*.supabase.co` host anywhere in the served
  bundle is `zmzvmgaeovleuvbvwxei.supabase.co`.
* **Staging proof 3** — the session cookie the app sets after a real sign-in is
  `sb-zmzvmgaeovleuvbvwxei-auth-token`.

The bypass secret is stored at `~/.nexpec-preview-bypass` (0600, outside the
repo) and is never typed into a tool call: a local redirector
(`<scratchpad>/redirector.mjs`, 127.0.0.1:8791) performs the one-time
cookie-setting hop. **CLEANUP OBLIGATION: delete this key at the end and
re-verify anonymous protection.**

### 00.3 D8 — root-caused correctly and FIXED (native build still verifying)

Run 4's fix direction would not have worked. The registry disproves it:

* nitro versions whose own `devDependencies.react-native` is **0.76.x** are
  **0.20.0 / 0.20.1 / 0.21.0** only; `0.22.0` already moves to RN 0.77.
* but `react-native-fast-tflite@3.0.1` (published 2026-04-21) was generated
  against nitro **0.35.x**. Pinning nitro back to 0.21 would leave fast-tflite's
  vendored nitrogen C++ calling a nitro API ~14 minor versions newer than the
  library present. A downgrade trades a Kotlin error for a C++ one.

**The actual defect is one call site.** RN 0.76's `ReactModuleInfo` primary
constructor names its first four parameters `_name`, `_className`,
`_canOverrideExistingModule`, `_needsEagerInit` — private, underscore-prefixed.
Nitro calls it with **named arguments** (`canOverrideExistingModule = …`), which
matches RN 0.83 but resolves against nothing on 0.76. The parameter **order is
identical on both**, so positional arguments compile against either.

Fix: `patches/react-native-nitro-modules+0.35.9.patch` (1.6 KB) converts that one
call to positional form, plus `"postinstall": "patch-package"` in `package.json`
so it survives `npm install`. `patch-package@8` was already a devDependency but
was **unwired** — no `postinstall`, no `patches/`. Nothing was downgraded.

Risk check on the C++ side: nitro's entire RN coupling is `jsi/jsi.h`,
`ReactCommon/CallInvoker.h` and `ReactCommon/CallInvokerHolder.h` — stable
across 0.76→0.83.

**Also found and fixed while reproducing:** `android/gradle.properties` had
`newArchEnabled=false`. `android/` and `ios/` are gitignored and fully generated,
so the tree was stale — `withNexpecNewArch` only forces the value during
prebuild. Nitro/Skia/Reanimated cannot compile under the Old Architecture, so
this was a second, independent reason the Android build could not succeed.
`expo prebuild --platform android --clean` now regenerates it at
**`newArchEnabled=true`** (verified in the generated file).

### 00.4 Browser role walks — IN PROGRESS, real UI sign-in on the deployed Preview

Method: sign in through the actual deployed sign-in form (a React Server Action),
then walk routes in-session. Sign-out between roles is the real UI button and
**does clear the session cookie** — verified, so role isolation is genuine.

| Role | Landing | Own routes | Forbidden routes |
|---|---|---|---|
| **Client** | `/client/dashboard` ✓ | **22/22 render** | **16/16 blocked** |
| **Inspector** | `/inspector/dashboard` ✓ | **18/18 render** | **14/14 blocked** |

### 00.5 A methodology trap this run fell into — and the correction

The first walker flagged **every** authenticated Inspector route as "signed
out". It was wrong. The detector matched `/sign in to nexpec/i` against the raw
HTML, and **every authenticated page embeds the i18n bundle**, which contains
`auth.signInTitle = "Sign in to NEXPEC"`. A real navigation to the same URL
rendered `Wallet, NEXPEC` correctly.

This is checkpoint trap #7 (loose regex) in a new costume, and it nearly
produced a fabricated P0. **Discriminate on `<title>`**, not on body text:
the sign-in page is the only one titled `Sign in, …`. Corrected walker re-run
clean.

Related: a `fetch()`-based walker is a weaker oracle than navigation — treat a
surprising *uniform* failure across every route as an instrumentation bug until
a real navigation disagrees with it.

### 00.6 Temporary privileged identities — CREATED, cleanup owed

Staging had **exactly one** privileged identity at session start: the owner
`super_admin` (email sha `f6ac53c2b120`), zero admins — invariant intact.
`qa.admin@` and `qa.superadmin@` do **not** authenticate (revoked in run 2).

Created for this run, random secrets, never printed, stored 0600 at
`<scratchpad>/temp-identities.json`:

* `qa.tmpadmin@nexpec.test` → `admin`
* `qa.tmpsuper@nexpec.test` → `super_admin`

**CLEANUP OBLIGATION:** run `<scratchpad>/cleanup-temp-admin.mjs`. It strips
privilege first, then deletes, then re-reads and asserts exactly one privileged
identity remains, then proves the temp credentials no longer authenticate.

### 00.7 Standing QA accounts on Staging (verified this run)

8 of 10 authenticate with the seeded password. `qa.talent@` carries role
`inspector` and `qa.rfqbuyer@` carries role `client` — to be confirmed as
intended sub-roles rather than seeding defects.

### 00.8 Open items carried into the rest of this run

* Roles not yet walked: Senior, Agency, Enterprise, Talent, Supplier, RFQ Buyer,
  Admin, Super Admin.
* `OPTIONS /` → **400** (aborted) on the Preview, correlating with
  `[NotificationBellLive] realtime degraded, falling back to 25s polling`.
  Not yet root-caused. Graceful degradation, so not user-breaking.
* `/inspector/ai-coinspector` and `/inspector/tools` serve the generic site
  `<title>` instead of a page-specific one. Cosmetic (P3).
* `scripts/qa/seed-role-qa.mjs:48` still hard-codes a QA password — must be
  moved to an env var before the secret scan can pass.

---

## 0. RUN 4 — 2026-08-16, latest session

### 0.1 What was PROVEN this run (all behavioural, all on Staging)

| Area | Result | Evidence |
|---|---|---|
| **Owner-only settlement RPCs** | **32/32 PASS** | `scripts/qa/verify-owner-financial-ops.mjs` |
| **Supabase Storage end to end** | **8/8 PASS** | `scripts/qa/verify-storage-e2e.mjs` |
| **iOS app RUNNING on a simulator** | **PASS** | screenshots, live Metro bundle |
| **Android emulator provisioned and booted** | **PASS** | API 35 arm64, boot 41.7 s |
| **Preview SSO protection** | **PASS — genuinely enabled** | anonymous request lands on `vercel.com/login`, 0 NEXPEC bytes |

### 0.2 Owner-only financial operations — 32/32, no owner credential used

`admin_mark_payout_processed` and `admin_resolve_dispute` gate real money and are
`super_admin`-only by design, so they had never been exercised. Proving them
needs either the owner's credential or a weakened guard, and both are
unacceptable — so the script creates **one throwaway `super_admin`** with a
crypto-random secret that is never printed, proves the matrix, deletes it, and
asserts the owner stands alone again. The owner's address is read only as a
sha256 prefix (`f6ac53c2`) and is never modified.

Proven, with no real money and no Stripe call:

* **15/15 refusals** — client, inspector, senior, supplier, agency, enterprise
  and talent are all refused for **both** RPCs, with the guard's own message
  (`Only super_admin can mark payouts processed`).
* **Anonymous refused at the grant level** — `permission denied for function`.
* **A plain `admin` is refused too** — this is the strict-super_admin claim, and
  it holds.
* **No automatic payout** at creation, on funding the client tranche, or on any
  status transition through `in_progress` and `completed`.
* **Dispatch without a fully executed contract is refused** — `CONTRACT_REQUIRED`.
  A funded job does not become dispatchable just because the money arrived.
* `super_admin` settlement writes `payout_paid_at`, the reference and `marked_by`.
* **The retry is refused** — `Job payout is already marked paid`. No duplicate payout.
* Dispute resolution is gated on the `disputed` state.
* Exactly **one** privileged identity remains: the owner.

**A trap this run fell into and fixed.** The first draft selected a
`payout_processed_at` column that does not exist. PostgREST errored, the helper
returned `{}`, and the empty object read as "no payout has happened" — a passing
test built on a failed query. The real column is `payout_paid_at`. The helper now
**raises** on a read error instead of returning an empty object. Worth
remembering: this is exactly the failure mode the brief warns about, and it
appeared inside the very script written to guard against it.

### 0.3 Storage — Supabase free tier passes, so R2 is NOT a release blocker

Exercised with a genuine 75-byte PNG: upload as the owning inspector into a
private bucket; metadata truthful (size and mimetype match the real bytes, not
the client's claim); signed download **byte-identical by sha256**; a different
role refused; an anonymous caller refused; a 1-second signed URL refused once
expired (http 400); a disallowed MIME rejected by the bucket allowlist; the
object deleted and its absence **re-read**, not assumed.

The negative cases are non-vacuous — the owner reads that exact key successfully
in the same run, so "refused" means the guard fired rather than the path being wrong.

Staging carries **12 buckets, 11 private**, each with a size limit and MIME
allowlist; only `avatars` is public, which is appropriate for profile images.
**Recommendation: ship on Supabase Storage.** Adding R2 would introduce
credentials, a billing relationship and a rollback surface to replace something
that already passes.

### 0.4 iOS — the app is genuinely RUNNING, not merely bundling

* iPhone 16 Pro `0E876197-…`, iOS 18.2, booted.
* `com.nexpec.app` installed and launched (pid 6583); the **sign-in screen
  renders** — logo, email/password, Apple/Google/LinkedIn, SSO and Enterprise.
* The native shell is the Jun 20 build. That is legitimate here: **`ios/Podfile.lock`
  has 0 commits since Jun 19**, so the native layer is unchanged, and a Debug
  build serves all JS from Metro — the app is running today's code.
* **Runtime bundle proof**: `GET /index.bundle?platform=ios` → 200,
  **33,680,281 bytes, 5,047 modules**, `zmzvmgaeovleuvbvwxei` **× 1**,
  `sxqpjxhslzzcdrdctatm` **× 0**. No `failed to compile`, no
  `Unable to resolve module`. (38 `SyntaxError` hits are library string
  literals, not build errors — a 34 MB bundle with a full module registry is not
  a Metro failure payload.)

**The Claude iOS Simulator MCP is unusable on this machine** — it insists *"Xcode
is installed but not selected"* while `xcode-select -p` returns
`/Applications/Xcode.app/Contents/Developer` and `xcodebuild -version` reports
Xcode 26.3. Worked around with `xcrun simctl` directly, stated openly.

### 0.5 Android — free tooling installed from nothing, emulator booted

No Java, no SDK, no Android Studio existed. Installed **entirely free, in the
user directory, with no sudo and no billing**, via
`scripts/qa/android-bootstrap.sh` → `~/.nexpec-android`:

* Temurin JDK 17.0.20 (Eclipse Adoptium)
* Android command-line tools + platform-tools + emulator + `platforms;android-35`
* `system-images;android-35;google_apis;arm64-v8a`
* AVD **`nexpec_qa`** (pixel_6) — **booted in 41.7 s**, `adb` shows
  `emulator-5554  device`, `sys.boot_completed=1`

First `expo run:android` attempt failed with *"Could not find device with name:
emulator-5554"* — pass the **AVD name** (`--device nexpec_qa`), not the adb
serial. Gradle build was still running at checkpoint time.

### 0.55 Regression gates re-run at `c14bc03` — and two false alarms disproved

| Gate | Result |
|---|---|
| **pgTAP** | **66 suites · 66 PASS · 0 FAIL** |
| **Vitest** | **13 files · 173 tests · 173 PASS**, exit 0 |
| **Workspace typechecks** (`typecheck:all`) | **0 errors**, exit 0 |
| **Deno — deployment runtime 2.1.4** | **37 pass · 0 fail** |
| **Migration ledger after stack restart** | **205 recorded**, unchanged |

**False alarm 1 — "66 pgTAP suites failing".** The first run reported
`66 suites · 0 PASS · 66 FAIL`, every one with `psql exit 2; no TAP plan emitted`.
That is not 66 regressions: **the local Docker stack had died** (`docker ps`
returned nothing, port 54322 refused connections). After `supabase start`, the
identical command returned **66/66 PASS**. A uniform abort-before-plan across
every suite is an environment signature, not a product one.

**False alarm 2 — "3 Deno edge functions fail typecheck".** `anchor-inspection-seals`,
`generate-vca` and `verify-affidavit` fail `TS2769` on
`crypto.subtle.importKey('spki', …)` under the **Deno 2.9.5** on this machine —
`Uint8Array<ArrayBufferLike>` no longer satisfies `ArrayBufferView<ArrayBuffer>`
in newer lib definitions. The brief specifies the deployment runtime, so 2.1.4
was fetched to `~/.nexpec-deno214` and run against the same files: **37/37, zero
failures.** The product is fine; the newer type-checker is stricter. Always
check edge functions with 2.1.4, never with whatever `deno` is on PATH.

### 0.56 Security / privacy / route guards at `c14bc03`

**12 of 14 PASS, 0 FAIL, 2 unfinished (slow, not failing):**
`check-role-routing`, `check-price-blindness`, `check-inspector-price-blindness`,
`check-admin-money-mapping`, `check-outbox-routing`, `check-orphan-modules`,
`check-db-refs`, `check-db-columns`, `check-sql-schema-refs`,
`check-rls-admin-coverage`, `check-admin-route-reachability` — all PASS.
`check-edge-functions` and `check-assignment-client-invisibility` were still
running when the session ended; **neither had failed.** Re-run them first on
resume, with `~/.nexpec-deno214` ahead of `deno` on PATH.

### 0.57 DEFECT D8 — the Android app cannot be built at all (release blocker)

**Status: root-caused, NOT fixed.** Deliberately left unfixed: diagnosing it
consumed the end of the session, and a dependency downgrade is exactly the kind
of change that must not be made without room to re-verify the iOS build that
currently works.

```
> Task :react-native-nitro-modules:compileDebugKotlin FAILED
NitroModulesPackage.kt:26  None of the following functions can be called with
                           the arguments supplied: ReactModuleInfo(...)
```

**Root cause.** `react-native-nitro-modules@0.35.9` is built against **React
Native 0.83** — that is its own `devDependencies.react-native`. This project is
on **React Native 0.76.9**. `NitroModulesPackage.kt` calls a `ReactModuleInfo`
constructor shape that exists in 0.83 and in neither of the two overloads RN
0.76 publishes (the 6-arg and 7-arg forms named in the error).

**Why it slipped in.** `package.json` declares `"react-native-nitro-modules":
"^0.35.9"`. The caret lets npm resolve forward into releases built for a much
newer React Native. `react-native-fast-tflite@3.0.1` is what pulls nitro in.

**Why it was never caught.** Nothing in CI or the release gates builds Android.
The Mobile gates are typecheck and *bundle* — and a Metro bundle is pure JS, so
it never compiles a line of Kotlin. This is precisely the "a successful bundle
is not runtime proof" gap: the JS bundle has been green all along while the
Android app was unbuildable.

**Fix direction (for the next run, verify — do not assume):**

1. Pin `react-native-nitro-modules` to the newest release whose own
   `devDependencies.react-native` is 0.76.x, and pin `react-native-fast-tflite`
   to the matching major that peers with it.
2. `rm -rf node_modules android/app/build && npm install`.
3. Rebuild Android **and** re-verify iOS — nitro is used by both, so a downgrade
   can break the iOS build that is currently working.
4. **Add an Android assemble step to the gates.** A bundle gate cannot catch this
   class of defect and never will.

### 0.58 Android — tooling is ready; where the build got to



`expo run:android --device nexpec_qa --no-bundler` progressed through: Gradle
configure → **NDK 26.1.10909125 downloaded and installed (3.0 GB)** →
`:app:processDebugResources`. It was still compiling when the session ended.
**It had not failed.** The remaining long pole is C++ compilation for
`react-native-fast-tflite`, `nitro` and `reanimated`.

Resume with:

```bash
export ANDROID_HOME=$HOME/.nexpec-android/sdk
export JAVA_HOME=$HOME/.nexpec-android/jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
emulator -avd nexpec_qa -no-snapshot-load -no-audio -gpu swiftshader_indirect &
cd ~/Desktop/nexpec
set -a; . /Users/ebrahimfeyzi/Desktop/nexpec/.env.staging.local; set +a
EXPO_NO_DOTENV=1 npx expo run:android --device nexpec_qa --no-bundler
```

Then verify at runtime exactly as iOS was verified:

```bash
curl -s "http://localhost:8081/index.bundle?platform=android&dev=true&minify=false" -o /tmp/a.js
grep -c zmzvmgaeovleuvbvwxei /tmp/a.js   # expect >= 1
grep -c sxqpjxhslzzcdrdctatm /tmp/a.js   # expect 0
adb shell am start -n com.nexpec.app/.MainActivity
adb logcat -d | grep -iE "ReactNative|FATAL|Exception" | tail -40
```

### 0.6 Corrections to run 3's report

* **"The old bypass key from run 2 is still on the project"** — wrong. The
  project has **0** protection-bypass keys; run 2's revocation did work.
* **SSO protection is enabled**, despite the v9 project API returning
  `ssoProtection: None`. Proven behaviourally: an anonymous request to the
  Preview 302s to `vercel.com/login?next=/sso-api…`, 481 KB of Vercel login HTML,
  **0** NEXPEC markers. The API field shape was misleading; the behaviour is not.

### 0.7 Still blocked, and exactly why

| Blocker | Evidence | What unblocks it |
|---|---|---|
| **Browser role walks** | Preview needs a bypass key; 0 exist; every documented Vercel create/revoke endpoint 404s on this token | Owner adds one in Dashboard → Settings → Deployment Protection |
| **Resend Custom SMTP** | `vercel env pull` → `[SENSITIVE]`; REST env value empty; Supabase edge secrets `{"secrets":[]}` | Owner supplies the key, or creates a new restricted one in the Resend dashboard |
| **Auth email rate limit** | `PATCH {"rate_limit_email_sent":30}` → **401 Custom SMTP required** | Same as above. Staging stays at **2/hour** |
| **Local dev browser QA** | `next dev` took 80 s to boot, **497 s to compile `/`**; three warm-ups timed out at 240 s | Not a product defect — use the Preview |

---

## 0b. RUN 3 — 2026-08-16, later session

### 0.1 Migration parity — RESOLVED, and the earlier number was wrong

The previous report printed both `202=202` and `207=207`. **`207` was never
counted — it was asserted.** Measured three ways:

| Source | Count |
|---|---|
| `supabase/migrations/*.sql` in the repository | **205** |
| Staging `zmzvmgaeovleuvbvwxei` applied | **205** |
| Local `supabase_migrations.schema_migrations` after a clean reset | **205** |

* remote-only (applied with no file): **none**
* file-only (file never applied): **none**
* timestamp collisions: **none**
* filenames strictly ascending: **yes**

`202=202` was true at the moment it was printed — that was the clean reset
before three later migrations existed. The only genuine discrepancy was that the
**local ledger had fallen 3 rows behind its own schema**: `20260801530000`,
`20260801532000` and `20260801534000` were applied to the local database with
`psql` during development and never written to `schema_migrations`, while the
same three reached Staging properly through `supabase db push`. The objects were
verifiably present locally (`rfq_admin_quotes_view`, 12 storage buckets,
`nx_is_strict_super_admin`) while the ledger said otherwise.

Repaired the correct way: a clean `supabase db reset` replayed all 205 files
from scratch, exit 0. **No migration was edited, none was back-dated, and no
repair migration was needed** — the files were always right; only the local
bookkeeping was stale.

### 0.2 Staging Auth — one real fix

`site_url` pointed at `…-2dqcocmzh-…`, a **dead preview from an earlier run**.
That value alone decides where recovery and confirmation links land, so every
Staging auth email was aimed at a deployment that no longer serves.
Repointed to the live Preview and confirmed by read-back.

### 0.3 Three external walls — evidence, not assumption

| Wall | What was actually tried | Result |
|---|---|---|
| **Resend Custom SMTP** | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` exist in Vercel (preview+production), so the account exists. `vercel env pull` returns `[SENSITIVE]`; the REST env endpoint returns an empty value. Supabase edge secrets on Staging: `{"secrets":[]}` — no copy there either. | **The key is not readable from this position.** Custom SMTP cannot be configured without it, and there are no Resend account credentials here to mint a new one. |
| **Auth email rate limit** | `PATCH /config/auth {"rate_limit_email_sent":30}` | **401** — `"Custom SMTP required to configure SMTP_SENDER_NAME or RATE_LIMIT_EMAIL_SENT"`. Blocked behind the same wall. Staging stays at **2 emails/hour**. |
| **Cloudflare R2** | No `wrangler` CLI, no `~/.wrangler`, no Cloudflare credentials anywhere in the environment. | **No account access.** R2 also requires the owner to confirm billing even on the free tier. |
| **Android emulator** | No `adb`, `emulator`, `sdkmanager`, `avdmanager`; no Android Studio; no `~/Library/Android/sdk`. | **No Android SDK at all.** A full SDK + system image install is multi-GB and needs interactive licence acceptance. |

Also found while looking: the `notify-job-assigned` edge function reads
`Deno.env.get("RESEND_API_KEY")`, and Staging has **zero** edge secrets set — so
that function's email path is inert on Staging today. Recorded, not fixed
(fixing it needs the same unreachable key).

### 0.4 iOS runtime — build in flight at checkpoint time

The Claude iOS Simulator MCP refuses with *"Xcode is installed but not
selected"*, but `xcode-select -p` **is** `/Applications/Xcode.app/Contents/Developer`
and `xcodebuild -version` reports Xcode 26.3. The MCP's own check disagrees with
the machine. Worked around it by driving the simulator directly with
`xcrun simctl` — stated openly rather than switched silently.

* iPhone 16 Pro `0E876197-FBFD-40FA-80B3-5AF5A8E0758F` — **booted**
* `npx expo run:ios --device <udid> --no-bundler` with
  `EXPO_NO_DOTENV=1` + `.env.staging.local` exported — **running**, currently
  compiling React-Fabric. A first clean build of a bare RN 0.76 project takes
  20–45 min here.
* First attempt failed `exit 127` — the background shell could not resolve the
  relative `.env.staging.local`. **Use the absolute path.**

### 0.5 Browser walks — blocked twice, and why

1. **Local dev server is unusable for QA on this machine.** `next dev` on :3001
   took 80 s to boot and **497 s to compile `/`**; three warm-up requests all
   timed out at 240 s. Not a product defect — dev-mode compilation — but it
   makes localhost useless for browser QA here. Server stopped to free CPU.
2. **The deployed Preview needs a bypass secret that no longer exists.** It was
   destroyed during the previous run's cleanup, before browser work was finished.
   The Vercel REST API returns 404 for every documented protection-bypass path on
   this token, so it can be neither revoked nor regenerated from here.
   `tab-1` navigating to the new Preview lands on `vercel.com` (SSO), confirming it.
3. The `seed` tab still holds a valid `_vercel_jwt` for
   **`q6mora96m` (sha `06fdad9`)**, which differs from HEAD only by a docs
   commit — a legitimate surface for the remaining walks. The browser pane went
   unresponsive (300 s timeouts) while Xcode saturated the machine; retry once
   the build finishes.

**Lesson for the next run: do not revoke the bypass key until browser AND mobile
work are both signed off.** Section 8 of the previous run listed browser walks
as outstanding, and cleanup ran anyway.

---

## 1. Physical state (verified 2026-08-16, run 3)

| | |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `43dffe3` (+ this checkpoint commit) |
| Origin | synchronized |
| Working tree | clean (only untracked `.claude/`) |
| Staging Supabase | `zmzvmgaeovleuvbvwxei` — **205 migrations** (see 0.1) |
| Production Supabase | `sxqpjxhslzzcdrdctatm` — **never contacted in any run** |
| Preview (HEAD) | `nexpec-main-platform-pnl2una4x-…` — READY, target `preview`, sha `43dffe3`, **0 Production refs / 1 Staging ref across all 15 chunks** |
| Preview (browser-authorized) | `nexpec-main-platform-q6mora96m-…` — sha `06fdad9`, docs-only delta |
| Vercel Production | **not deployed, not promoted** |
| Owner | sole persistent `super_admin`; **zero synthetic privileged accounts** |

Node note: `@supabase/supabase-js` needs **Node 22** (Node 20 has no native
WebSocket and `createClient` throws):
`export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`

## 2. Defects found, fixed, and verified on Staging

| # | Sev | Defect | Fix | Regression |
|---|---|---|---|---|
| D8 | P1 | `inspector_skills` had two baseline `USING (true)` FOR ALL TO PUBLIC policies; **any authenticated user could forge, edit or delete any inspector's skills**. Reproduced: a client inserted a row carrying the inspector's `user_id` (201), a supplier then PATCHed (200) and DELETEd (200) it. | `20260801528000` — owner-scoped writes, authenticated read, anon revoked | `inspector_skills_write_tamper_test.sql` 13/13, asserting the **class** |
| D9 | **P0** | `supplier_quotes` mixed supplier-owned and broker-owned columns with only row-level scoping. A supplier could **read the platform spread**, **rewrite `client_price_cents`**, **self-award** (`status='accepted'`, the trigger that spawns the job), forge `presented_by`, and overwrite `admin_note`. Mobile shipped the spread to the device via `select('*')`. | `20260801530000` — the `public.jobs` pattern: no table grant, column-level SELECT on the safe set, UPDATE on the bid only, `rfq_admin_quotes_view` for admin | `supplier_quote_broker_columns_test.sql` 18/18 |
| D10 | P2 | `npm run typecheck` runs `--workspaces`, and the Expo app at the repo root is **not a workspace** — nothing under `app/` was ever typechecked. 5 real errors sat in the tree while the gate was green. Inspector dispute tiles read permanently 0. | Fixed both errors; added `typecheck:app` / `typecheck:all` | the new gate itself |
| D11 | P1 | **Ten of eleven storage buckets did not exist.** Every document, evidence, certificate, signature and attachment upload returned `NoSuchBucket` on Staging *and* on a clean local reset. No migration had ever created a bucket. Underneath: `storage.objects` had exactly one INSERT/UPDATE/DELETE policy, all for `avatars`. | `20260801532000` — 12 buckets, private but `avatars`, caps and MIME lists derived from the app's own constants; owner-scoped writes | `storage_buckets_test.sql` 6/6 + 26/26 live storage lane |
| D12 | P1 | **Any `admin` could promote itself to `super_admin`** (`PATCH {role:'super_admin'}` → 204). `guard_profile_privileged_columns` opened with `IF … nx_is_admin() THEN RETURN NEW`, so admins skipped its own escalation branch. | `20260801534000` — super_admin grant/revoke lifted above the admin exemption, gated on a new strict helper (`is_super_admin()` is a misnomer that admits admin and support) | `super_admin_grant_authority_test.sql` 11/11 |

Every fix was pushed to Staging and re-verified there against the original
reproduction (D8+D9: 11/11 · D12: 3/3 · D11: 26/26).

## 3. Gates — all green at `06fdad9`

| Gate | Result |
|---|---|
| Clean `supabase db reset` | PASS — 202 recorded = 202 files, exit 0 |
| Migration chain | PASS — Staging 207 = 207 files |
| **pgTAP (full)** | **PASS — 66 suites, 66 PASS, 0 FAIL** (62 existing + 4 new) |
| vitest | PASS — 13 files, 173/173 |
| `typecheck` (workspaces) | PASS — 0 errors |
| `typecheck:app` (root/Expo) | PASS — 0 errors (was 5) |
| Web production build | PASS — compiled successfully, exit 0 |
| Android Staging bundle | PASS — **0 Production refs, 1 Staging ref** |
| iOS Staging bundle | PASS — **0 Production refs, 1 Staging ref** |
| Deno **2.1.4** edge checks | PASS — 37/37 entrypoints |
| ML tests | PASS — 43 assertions, 5 suites |
| Offline replay (itp/visit/review) | PASS — 54/54 |
| QA guard scripts | PASS — 14/14 (outbox, db-refs, rls-admin, price-blindness ×2, assignment-privacy, jobs-columns, admin-money, sql-schema, admin-routes, model-shas, db-columns, orphans, role-routing) |

> `deno check` run from the repo root reports 12 false failures — `node_modules`
> confuses resolution. Run it **from `supabase/functions/`** with
> `--node-modules-dir=none`. Recorded so it is not refiled as a defect.

## 4. Behavioural coverage against Staging (real JWTs, real RLS)

| Lane | Result |
|---|---|
| Supplier — opportunities, quote, revise, isolation | 24/24 |
| Supplier — markup, award, contract handoff | 17/17 after D9 |
| Storage / documents — upload, metadata, signed-URL download, tamper, cross-tenant, MIME, size | 26/26 |
| Cross-role invariants — escalation, anon, price blindness, silos, self-service money | 46/51 (5 were wrong-path assertions, all resolved — see §7) |
| Talent · Enterprise · Agency | 19/25 (6 were wrong column/constraint literals) |
| **Canonical lifecycle** | see below |

**Canonical lifecycle, proved end to end** with fresh history-free identities:
job created → not born public/dispatched → admin moderation and pricing →
inspector discovery (no client price, no spread) → application with cover note
and counter-bid → **client sees nothing before forwarding** → admin
counter-offer → inspector response → forwarding refused while the counter is
pending → explicit admin forwarding → **identity matrix measured by value**
(protected: no name/email/phone · professional: no email/phone · full: name +
email + phone · full→protected strips PII on the next read · non-vacuous) →
client acceptance (no dispatch) → contract → client signature → inspector
signature → fully executed (**still no dispatch**) → dispatch refused while
unfunded → 20/80 schedule confirmed → initial tranche funded → client and
inspector both refused dispatch → **admin dispatches** → assigned, payout still
`unpaid`, spread = price − payout → senior review round → return with comments →
canonical resubmit → **stale resubmit refused** → approve → **senior and client
cannot deliver** → **delivery refused: `FUNDING_REQUIRED` (Strict Prepay)** →
delivery invoice issued, status `open` → dispute filed → **duplicate dispute
refused (23505)** → audit rows carry actor, role, timestamp, correlation.

## 5. Owner-only actions — NOT failures, and NOT falsely marked PASS

Two RPCs are **explicitly `super_admin`-only** in their own bodies
(`IF v_actor_role IS DISTINCT FROM 'super_admin'`). An `admin` is refused 42501.
This is deliberate and was **not weakened**:

* `admin_mark_payout_processed` — manual inspector settlement
* `admin_resolve_dispute` — dispute resolution

Everything up to and including them was proved; the two actions themselves
require the owner's own session.

## 6. Cleanup — verified

| Resource | State |
|---|---|
| Synthetic `RQ2026-*` jobs / RFQs / quotes / deals | 0 live remaining |
| `qa.supplier2@nexpec.test` | deleted |
| `qa.l2client@` / `qa.l2inspector@` | credential revoked, profile retired — **hard delete refused by `REVIEW_HISTORY_IMMUTABLE`**, which is correct and was not weakened |
| `qa.tempadmin@nexpec.test` | **privilege stripped (role→client), credential revoked** — cannot authenticate. Hard delete refused by the same audit-immutability guard |
| Privileged identities | **exactly one: the owner `super_admin`. Zero synthetic.** |
| Eight standing QA accounts | all 8 sign in — ready for the owner's Manual QA |
| Redirector 127.0.0.1:8791 | stopped |
| Local secret files, bundle dirs | removed |
| **Vercel Preview bypass key** | ⚠ **STILL ACTIVE — owner action required.** The REST API returns 404 for every documented revoke path on this token, and the Vercel MCP needs an OAuth flow unavailable in a non-interactive session. Remove it at **Vercel → nexpec-main-platform → Settings → Deployment Protection → Protection Bypass for Automation → Delete**. SSO protection stays ON (`all_except_custom_domains`), so the Preview is not publicly readable meanwhile. |

## 7. Methodology traps — do not rediscover these

1. **Stale PostgREST schema cache** turns a missing function into a 404 that
   *looks* like a denial. Several "anon cannot execute X" results were false
   until `NOTIFY pgrst, 'reload schema'`. Always confirm the RPC resolves for a
   legitimate caller before recording a denial.
2. **Wrong argument names → PGRST202**, which also looks like a denial.
3. **A zero-row write is not a denial.** Read back with the service role.
4. **Column names are not values.** `jobs_secure_view` exposes the money columns
   to everyone and NULLs the *values* per role. Assert values.
5. **Shared QA accounts have history.** `nx_can_read_profile` legitimately opens
   on a prior shared job, so an identity assertion on `qa.client`/`qa.inspector`
   is meaningless. Use fresh identities.
6. **`curl` cannot sign in** — the sign-in form is a Server Action. A curl
   "session" produces bounces that masquerade as authorization passes. Use the
   browser.
7. **Loose error regex**: `/500/` matches `gray-500`.
8. **Injected `window.fetch` breaks React in that tab only.** Confirm in a clean tab.

## 8. Not covered by this run

* Mobile **runtime on a simulator/emulator** — bundles are proved Staging-only
  and typecheck is clean, but no app was launched on a device. Physical-device
  visual QA remains an owner step.
* Web **UI-level** sweeps for Client/Agency/Enterprise/Talent/Admin: proved at
  the API/RLS layer and, for Client, at the route layer on the deployed Preview
  (5/5 own routes render, 5/5 forbidden routes redirect). Per-route rendered
  content for the other roles was not walked in the browser.
* Performance timings on Preview were not measured.
* `payout_status` is visible to the Client through `jobs_secure_view` (a status,
  never an amount). Minor; recorded as an observation, not fixed.
* `scripts/qa/seed-role-qa.mjs:48` still holds a committed QA password.

## 9. Resume — exact state and next commands

**Do these first, in this order.**

1. **Recreate a Preview bypass secret** (Vercel Dashboard → nexpec-main-platform
   → Settings → Deployment Protection → Protection Bypass for Automation →
   *Add*). Store it at `~/.nexpec-preview-bypass`, write
   `<scratchpad>/bypass-url.txt` containing
   `<preview-url>/sign-in?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`,
   then `node <scratchpad>/qa/redirector.mjs &`. **Do not revoke it until both
   browser and mobile sign-off are done** — that mistake cost this run.
   The OLD key from run 2 is still on the project and still needs deleting.

2. **Finish the iOS runtime check** (build may already be done):

   ```bash
   tail -5 <scratchpad>/qa/ios-build.log          # look for IOS_BUILD_EXIT
   xcrun simctl list devices booted
   xcrun simctl launch 0E876197-FBFD-40FA-80B3-5AF5A8E0758F com.nexpec.app
   xcrun simctl io 0E876197-FBFD-40FA-80B3-5AF5A8E0758F screenshot /tmp/ios.png
   ```

   If the build failed, rebuild with the **absolute** env path:

   ```bash
   set -a; . /Users/ebrahimfeyzi/Desktop/nexpec/.env.staging.local; set +a
   EXPO_NO_DOTENV=1 npx expo run:ios \
     --device 0E876197-FBFD-40FA-80B3-5AF5A8E0758F --no-bundler
   ```

   Then start Metro against Staging and verify at runtime: Staging ref present /
   Production ref absent, login and role routing, marketplace + application,
   counter-offer, assignments, visits, evidence, offline outbox and reconnect,
   Flash Reports, report submission, senior review, agency/supplier dashboards,
   Talent consent, deep links, disclosure policy, no client-price or spread leak,
   zero transform/runtime errors.

3. **Web browser walks** against `q6mora96m` (or a fresh Preview once step 1 is
   done): Supplier forms (quote submit/edit/withdraw, award/contract handoff,
   agreement signature, document upload/preview/download/seal, brokered
   messaging, finance, synthetic withdrawal, cross-supplier isolation), then
   Agency, RFQ Buyer, Enterprise (SSO/SCIM lifecycle), Talent (consent grant /
   withdrawal / offline-failure), Inspector, Senior, temporary Admin.
   **The temporary Admin must be recreated** — run 2 stripped its privilege and
   revoked its credential.

4. **Canonical lifecycle through the real UI**, then reconcile every monetary
   card, table and chart against the database.

5. **Final regression** (all of section 3 below) and cleanup (section 6).

**Blocked, needs the owner — ask at exactly these walls:**

* Resend API key, for Supabase Custom SMTP and the Staging email rate limit (0.3).
* A Cloudflare account with R2 enabled, plus billing confirmation (0.3).
* Android SDK/emulator, or a decision to record Android as physical-device-only (0.3).
* Owner session for `admin_mark_payout_processed` and `admin_resolve_dispute` —
  both are `super_admin`-only **by design** and must not be weakened (section 5).

**Harness** (session scratchpad `qa/`): `harness.mjs` signs real QA users in and
issues PostgREST/RPC calls with their JWT, refusing any non-Staging ref;
`psql.sh` for Staging introspection; `redirector.mjs` + `preview-base.txt` for
bypass-protected browsing without printing the secret. Node 22 is required
(`export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`).

**Standing verification commands**

```bash
cd ~/Desktop/nexpec
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node scripts/qa/run-pgtap.mjs          # 66/66 at 43dffe3
npm run typecheck:all && npm test
cd supabase/functions && for f in */index.ts; do deno check --no-lock --node-modules-dir=none "$f"; done
```
