# NEXPEC Release Qualification — Checkpoint

> **Status: IN PROGRESS — NOT COMPLETE.** Section 00 is the newest work and the
> exact resume point; everything below it is earlier runs and remains accurate
> except where a newer section corrects it.

---

## 00000. RUN 8 — 2026-08-17, latest session. READ THIS FIRST.

**HEAD `74520ea`, branch `release/identity-replacement`, clean, origin 0/0.
Disk 28 GB. Docker UP. Preview `nexpec-main-platform-gidxw25ow-…` verified:
anonymous 302 → SSO with 0 NEXPEC bytes, Staging ×1 / Production ×0, and the
app footer renders `build-74520ea` = current HEAD.**

Job **`e2859bf6-9cdb-4861-99cb-ee31d99b9ba3`** — re-verified intact before any
action. No duplicate created.

### 00000.1 THE INSTRUCTION TO "SET CLIENT PRICE IN SPREAD EDITOR NOW" IS NOT EXECUTABLE YET

This is the single most important correction in this run. It is **not a defect**
and must not be filed as one.

The Spread Editor (`/admin/dispatch`) states its own scope on screen:

> *"Every job in **open** status **with at least one CLIENT_SELECTED applicant**.
> Pick an inspector, set the client charge and inspector payout, and fire the
> atomic dispatch RPC."* — and it showed **QUEUE IS CLEAR**.

Confirmed in the schema: `client_price_cents` is writable by exactly three RPCs,
and **two of them require `p_application_id`**:

* `admin_dispatch_job(p_job_id, **p_application_id**, p_client_price_cents, p_payout_cents, …)`
* `admin_generate_job_contract(**p_application_id**, p_client_price_cents, …)`
* `admin_present_quote(p_quote_id, …)` — the supplier/RFQ lane, not this one

**So the client price is set at contract-generation / dispatch, AFTER an
inspector applies and the client selects them — never before.** Forcing it now
would require a raw SQL write, i.e. faking a lifecycle step, which the brief
forbids. The negative generated spread (D14) therefore persists legitimately
until dispatch, and **that is where it must be re-checked for +120000**.

### 00000.2 Lifecycle steps advanced this run — all through the real UI

| # | Step | Evidence |
|---|---|---|
| — | New uniquely-named temp admin | `qa.tmpadmin.r8mp6z9@` (the run-7 pair is banned, emails permanently taken) |
| 8/9 | **Inspector Marketplace shows the job, price-blind** | `/inspector/jobs` renders "Available, 6" incl. QA5-LIFECYCLE-A showing **`INSPECTOR PAYOUT $3,600`**. Rendered-text assertions: `$4,800` **absent**, `$1,200` **absent**. |
| 10/11 | **Inspector applies with a real cover note** | 470 chars typed with the real keyboard into `coverNote` |
| 12 | **Counter-bid submitted** | `bidDollars` = 3950 typed, form submitted |
| — | DB read-back | application **`f8d0024a-ce47-48c6-b2d9-e31e10e699f4`**: `applicant_id=a7556734`, `bid_amount_cents=**395000**`, `cover_note` = the typed text, `status=pending`, **`forwarded_to_client_at=null`** |
| 15 | **Client sees NOTHING before forwarding** | as QA Client, `/client/jobs/<id>/applications` renders **"0 applications"**; inspector name, cover-note text, `3,950` and `3,600` are **all absent from the rendered page** |

The client-side empty state is **truthful, not a disguised error**: *"No vetted
applications available yet. NEXPEC reviews every applicant — credentials,
specialty fit, experience and availability — before sharing a candidate with
you."* That is the required behaviour, not a swallowed failure.

### 00000.3 Browser-pane rule confirmed again (do not re-diagnose)

Soft (client-side) navigation inside the admin area frequently leaves the
Suspense boundary unresolved — `main.innerText.length === 0` with a spinner —
even at a valid viewport. **A FRESH TAB loading the URL directly always renders.**
Both `/admin/dispatch` and `/inspector/jobs` reproduced this exactly.
**Always: new tab per surface, assert `window.innerWidth > 0`, then judge.**

### 00000.4 Resume point — Admin forwarding

Next: sign in as `qa.tmpadmin.r8mp6z9@nexpec.test`, open the job's moderation /
applications surface, review the inspector's qualifications, exchange a
counter-offer, then **forward the application to the client** and re-run the
client-visibility check (it must flip from 0 to 1). Then identity-disclosure
modes, client acceptance, contract, signatures, funding, dispatch — and at
dispatch verify `client_price_cents=480000`, `inspector_payout_cents=360000`,
`platform_spread_cents=+120000`.

```bash
cd ~/Desktop/nexpec && export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
S=<scratchpad>
cd $S && node make-temp-admin2.mjs     # unique-stamped admin+super
node $S/redirector.mjs &               # 127.0.0.1:8791, secret never printed
# JOB e2859bf6-9cdb-4861-99cb-ee31d99b9ba3   APPLICATION f8d0024a-ce47-48c6-b2d9-e31e10e699f4
```

### 00000.5 Cleanup obligations (cumulative)

* Job `e2859bf6-…` + application `f8d0024a-…` and everything downstream.
* Temp identities `qa.tmpadmin.r8mp6z9@` / `qa.tmpsuper.r8mp6z9@` — revoke via
  `cleanup-temp-admin.mjs` (it now bans when the delete is FK-refused).
* Run-7's `qa.tmpadmin@` is already stripped+banned; it cannot be deleted
  (audit FK) and that is correct.
* Preview bypass key — still active, needs **rotation** at the very end.

---

## 0000. RUN 7 — 2026-08-17, previous session.

**HEAD `27eeea4`, branch `release/identity-replacement`, clean tree, origin 0/0.**
Run 6's checkpoint commit did complete and push. Disk 28 GB free.
**Docker recovered on its own — local Supabase is UP again** (run 6 said it was
wedged; physical state overrode the note).

### 0000.1 State re-verified before touching anything

QA Job **`e2859bf6-9cdb-4861-99cb-ee31d99b9ba3`** still exists, **6/6 expected
values intact** (`pending_review`, `public_listable=false`, `contractor_id=null`,
480000 cents, `Calgary, Alberta`, `["ndt-ut"]`). No duplicate was created.

Preview at HEAD: `nexpec-main-platform-3sraaphi2-…` — anonymous **302 → SSO,
0 NEXPEC bytes**; Staging **×1** / Production **×0**; and the app footer renders
**`build-27eeea4`**, read out of the live DOM after sign-in.

### 0000.2 Canonical lifecycle — steps 3–10 now PASS through the real UI

| # | Step | Evidence |
|---|---|---|
| 3 | Sign in as temporary Staging Admin | real typed credentials → `/admin/dashboard`, header "QA Temp Admin" |
| 4 | Open the moderation queue | `/admin/jobs` renders "Jobs Moderation", 9 rows; QA job row shows `OPEN · QA Client · — · $4,800.00 BUDGET · payout —` |
| 5 | Review the submitted Job | **real click on the row** opened the moderation drawer: `OPEN` + `MODERATION, PENDING_REVIEW`, the exact description typed in run 6, `Client budget (not yet priced) $4,800.00`, `INSPECTOR APPLICATIONS, 0` |
| 6 | Pricing | inspector payout **3600** typed with the real keyboard, plus a 152-char moderation note |
| 7 | Approve | `Confirm approval` submitted → db read-back: `moderation_status=approved`, `moderation_reviewed_by=8a649186` (the temp admin), `moderation_reviewed_at`, `moderation_notes` all persisted |
| 8 | Public only after approval | job now visible to the Inspector; **see the caveat below** |
| 10 | Inspector sees NO client price / spread | **column-level proof**, below |

**Step 10, proven by value not by column name** — everything money-ish the
inspector can read through `jobs_inspector_secure_view`:

```
client_price_cents      = null      platform_spread_cents  = null
price_cents             = null      budget_min/max_cents   = null
inspector_payout_cents  = 360000    payout_amount_cents    = 360000
payout_status           = "unpaid"  budget_type            = "fixed"  (a label, not money)
```

`budget_cents` is not even present in the view. **Price blindness holds.**

> **Caveat on step 8, stated rather than glossed:** the inspector was only
> queried *after* approval. The "only after" half — that the same inspector
> could NOT see it while `pending_review` — was never captured as a
> before/after control. Redo that on the next job.

### 0000.3 TWO false alarms this run — both nearly became fabricated P0s

**1. "Every admin page renders blank."** `/admin/jobs` and `/admin/dashboard`
showed nothing: `main.innerText.length = 0`, stuck on a Suspense spinner
(`<template id="B:2">`), across reloads. The cause was **`window.innerWidth ===
0 && innerHeight === 0`** — the Browser pane had collapsed to zero size, so
React bootstrapped into a viewport with no layout and its Suspense boundary
never painted. The same URL fetched **122,190 bytes containing the QA job**.
**Opening a FRESH TAB fixed it completely** (a resize on the broken tab did
not — the React root was already poisoned).
**Rule: assert `window.innerWidth > 0` before trusting any "page is empty".**

**2. "The Inspector cannot see the approved job."** True of
`jobs_secure_view` — but that is **not the marketplace surface**. `fetchOpenJobs`
(`apps/web/src/lib/data/openJobs.ts:83`) reads **`jobs_inspector_secure_view`**.
Against the correct view the job is visible immediately. A specialty-gating
hypothesis was raised and **disproved** first (granting the inspector `ndt-ut`
changed nothing), which is what forced the search for the real surface.
**Rule: find the query the page actually runs before calling a view a defect.**

### 0000.4 Finding D14 (P2) — `platform_spread_cents` can be stored NEGATIVE

After admin approval the job holds:

```
budget_cents           = 480000
client_price_cents     = 0          ← never set by the moderation flow
inspector_payout_cents = 360000
platform_spread_cents  = -360000    ← GENERATED ALWAYS AS (client_price - payout)
```

`platform_spread_cents` is a **stored generated column**
(`00000000000000_remote_baseline.sql:3685`) and is **indexed**
(`idx_jobs_platform_spread`).

**Not a broken flow** — `JobModerationPanel.tsx:155` documents that
`client_price_cents` is the admin's marked-up price, set later in the **Spread
Editor** (`/admin/dispatch`), while the client's posted figure lives in
`budget_cents`. So payout-before-price is a legitimate intermediate state.

**Still a real gap:** nothing forces the Spread Editor step, and any admin money
view that SUMs `platform_spread_cents` will read a negative platform margin for
every approved-but-unpriced job. **Do not "fix" this by clamping the generated
column** — decide instead whether approval should require a client price, or
whether spread should be NULL (not negative) until priced.
**Verify against the Spread Editor first**: set the client price to 4800 and
confirm the spread becomes **+120000**, before filing this as a defect to fix.

`public_listable=false` is **NOT** a defect and must not be filed as one: it is
only ever *read*, by the anonymous public SEO teaser feeds. Marketplace
visibility is `status='open'` + `moderation_status='approved'`.

### 0000.5 Cleanup obligations added by this run

* Synthetic job `e2859bf6-…` (now approved + priced) — delete at the end.
* `qa.inspector@nexpec.test` had `profiles.specialty_slugs` set to `["ndt-ut"]`
  by the disproved hypothesis test. It was empty before — **restore to `[]`**.
* Temporary `qa.tmpadmin@` / `qa.tmpsuper@` — revoke (script exists).
* Preview bypass key — still active, still needs **rotation**, not just deletion.

### 0000.55 Cleanup defect found IN THE CLEANUP ITSELF — fixed

Revoking the temp identities reported the invariant as OK **while
`qa.tmpadmin@nexpec.test` could still sign in (HTTP 200)**. The script's own
non-vacuous "does the credential still authenticate?" check is what caught it —
the invariant check alone would have passed and lied.

Cause: once that admin approved the QA job it became the actor in
`jobs.moderation_reviewed_by`, so `DELETE` fails with **23503 foreign-key
violation**. That guard is **correct** — an audit trail must keep its actor —
so deleting an audited QA identity is impossible by design.

Remediation applied and re-verified: password rotated to a secret nobody holds
+ `ban_duration` to **2126**, leaving the audit row intact. The known QA
password now returns **400**. `cleanup-temp-admin.mjs` now does this
automatically whenever the delete is refused, instead of only logging it.

**Lesson: "privilege stripped" is not "credential revoked". Always assert the
credential cannot authenticate, not just that the role is gone.**

### 0000.6 Resume at lifecycle step 6/11

Next actions, in order: price the job in the **Spread Editor** and re-check the
spread sign (resolves D14); capture the step-8 before/after control on a second
job; then step 11 onward — Inspector applies with a cover note.

```bash
cd ~/Desktop/nexpec && export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
S=<scratchpad>
cd $S && node make-temp-admin.mjs && node set-temp-password.mjs
node $S/redirector.mjs &     # 127.0.0.1:8791, secret never printed
# ALWAYS open a fresh tab and confirm window.innerWidth > 0 before judging a page
```

---

## 000. RUN 6 — 2026-08-16, previous session.

**HEAD `46cd258`, branch `release/identity-replacement`, clean tree,
origin SYNCHRONIZED (0/0).** Run 5's four commits are now pushed.

### 000.1 Recovery tasks — all DONE

| Task | Result |
|---|---|
| Push run 5's 4 unpushed commits | **DONE** — `6840a1d..46cd258`, origin 0/0 |
| Free disk to ≥20 GB | **DONE** — 16 GB → **28 GB**. Deleted only reproducible caches (Yarn cache 10 GB — this project uses npm, `.next`, `android/app/build`, `.cxx`, npm cache). Source, 205 migrations, `patches/`, credentials all verified intact. |
| Preview from current HEAD, Staging-targeted | **DONE** — see 000.2 |
| **D8 patch survives clean install** | **DONE — PROVEN** — see 000.3 |

### 000.2 Preview at HEAD — verified four ways

`https://nexpec-main-platform-g9ynbggha-ebi137394s-projects.vercel.app`
(auto-deployed by the push; target `preview`, status Ready)

1. **Anonymous is SSO-protected** — `GET /sign-in` → **302**, 15 bytes,
   **0** NEXPEC markers.
2. **Staging-only** — 13 served `_next/static` chunks + HTML:
   `zmzvmgaeovleuvbvwxei` **×1**, `sxqpjxhslzzcdrdctatm` **×0**; the only
   `*.supabase.co` host in the whole bundle is the Staging one.
3. **Built from HEAD** — the app's own footer renders **`build-46cd258`**
   (read out of the live DOM after signing in, not inferred from the API).
4. **D13 fix is live** — `/talent/*` and `/agency/*` return **404**, not the
   500 they returned before the fix. `/discover`, `/inspectors`, `/feed.xml`
   still 200; `/inspections/[slug]` still 404.

### 000.3 D8 — the patch survives a true clean install

`npm ci` (wipes `node_modules`, installs from lock):

```
> nexpec@1.0.0 postinstall
> patch-package
patch-package 8.0.1
Applying patches...
react-native-nitro-modules@0.35.9 ✔
added 1314 packages ... NPM_CI_EXIT=0
```

Re-read from disk afterwards: the positional-argument form is present and
**`canOverrideExistingModule = ` (the named form) occurs 0 times**. The fix is
durable across a dependency wipe.

### 000.4 Canonical lifecycle — steps 1 and 2 PASS through the real UI

**Job `e2859bf6-9cdb-4861-99cb-ee31d99b9ba3`**, title
`QA5-LIFECYCLE-A Ultrasonic thickness survey, 12 inch process line`.

Created by signing in as `qa.client@nexpec.test` with **real clicks and real
keyboard input** on the deployed Preview (`/client/jobs/new`), then submitting
the actual form. Verified by **database read-back**, not by the UI's own claim:

| Field | Value | Meaning |
|---|---|---|
| `client_id` | `0d06d2ba…` | the signed-in QA client |
| `budget_cents` | **480000** | the `4800` typed into BUDGET (USD) |
| `location_city` | **"Calgary, Alberta"** | typed into CITY |
| `specialty_slugs` | **`["ndt-ut"]`** | set by a real click on the checkbox |
| `moderation_status` | **`pending_review`** | **step 2: not auto-approved** |
| `public_listable` | **`false`** | **step 2: not auto-published** |
| `contractor_id` | **`null`** | **step 2: not auto-dispatched** |
| `payout_status` / `escrow_status` | `unpaid` / `pending` | no money moved |
| `client_price_cents` / `platform_spread_cents` | `0` / `0` | admin has not priced it yet |

The submit button is labelled **"Post for moderation"**, which matches the
guard behaviour rather than contradicting it.

### 000.5 Environment problems that cost this run, and how to avoid them

* **The Browser pane hides itself intermittently.** When hidden, every
  `computer` action (click/scroll/key) times out after 30 s, while
  `read_page` / `javascript_tool` keep working. Coordinate clicks are also
  scaled: the click frame is **800×505** while CSS is **1440×900**, so
  `frame = css × 0.5556`. Reliable pattern that worked:
  **focus the element via JS, then type with the real keyboard**; for the final
  submit use `form.requestSubmit(button)` (the browser's real submission path,
  including validation and submitter) when a click cannot be landed.
* **Docker was wedged.** The VM had been up 11 h with a ~10 h-stale console log
  and the daemon refused connections. A quit + `pkill` + relaunch did **not**
  bring the VM back within ~15 min. **Local Supabase is therefore DOWN**, so
  pgTAP, clean `db reset` and local migration-parity could not run this session.
  Fix Docker Desktop first on resume.

### 000.6 EXACT RESUME COMMANDS

```bash
cd ~/Desktop/nexpec
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
S=<scratchpad>            # qa-lib.mjs, staging.env, make-temp-admin.mjs live here

# 1. privileged QA identities (they were REVOKED at the end of run 6)
cd $S && node make-temp-admin.mjs && node set-temp-password.mjs

# 2. browser access (bypass secret is at ~/.nexpec-preview-bypass, 0600)
node $S/redirector.mjs &        # 127.0.0.1:8791 -> Preview, secret never printed

# 3. resume the lifecycle at STEP 3 (admin moderation) on this job
#    e2859bf6-9cdb-4861-99cb-ee31d99b9ba3   (moderation_status = pending_review)

# 4. fix Docker, then the local-only gates
open -a Docker && supabase start && node scripts/qa/run-pgtap.mjs
```

### 000.7 What run 6 did NOT do — the honest list

Everything in the brief beyond the above is still outstanding: lifecycle
**steps 3–46**; exhaustive per-role clicking of every button/form/modal/filter/
table/pagination/chart/notification; the file/media/link matrix; messaging and
notifications; Resend email delivery; **all** mobile QA (no Android or iOS build
or run this session, no TFLite inference); the five Expo Router helper-file
warnings and their regression check; and the full final gate set (pgTAP, Deno
2.1.4, ML/replay, db reset, migration parity, guards, secret scan, orphan scan).

---

## 00. RUN 5 — 2026-08-16, previous session

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

### 00.9 D8 IS FIXED — a real APK exists, installs, and RUNS on the emulator

Committed as **`9aac6b9`** (local; see 00.14 — the push was blocked).

| Step | Evidence |
|---|---|
| Gradle | **BUILD SUCCESSFUL in 2m 59s**, `GRADLE_EXIT=0` |
| APK | `android/app/build/outputs/apk/debug/app-debug.apk` — **131 MB / 137,638,284 bytes** |
| The task that used to fail | `:react-native-nitro-modules:compileDebugKotlin` now **compiles**, through to `bundleDebugAar` |
| Install | `adb install -r` → **Success**; `pm list packages` shows `com.nexpec.app` |
| Emulator | `nexpec_qa`, API 35, **`ro.product.cpu.abi = arm64-v8a`** |
| Launch | `am start -n com.nexpec.app/.MainActivity` → **pid 3535, still alive**, no `FATAL EXCEPTION`, no `dlopen failed` |
| New Architecture at RUNTIME | `ReactNativeJS: Bridgeless mode is enabled` and `Running "main" with {…,"fabric":true}` |

**The native libraries that prove the fix are real** — these ship inside the APK
and are exactly what a broken-nitro / Old-Architecture build can never produce:

* **`libNitroModules.so` — 1,201,936 B** ← the library that would not compile
* **`libNitroTflite.so` — 483,704 B** ← fast-tflite's nitrogen module
* **`libtensorflowlite_jni.so` — 4,320,472 B**
* **`libtensorflowlite_gpu_jni.so` — 2,501,208 B**
* `librnskia.so` 16.2 MB, `libreanimated.so`, `libworklets.so`, `libhermes.so`

**Android bundle, Staging-only:** 34,031,275 bytes, **5,062 modules**,
`zmzvmgaeovleuvbvwxei` **×1**, `sxqpjxhslzzcdrdctatm` **×0**,
`Unable to resolve module` ×0.

> Two build lessons worth keeping. (1) The first attempt died at **[143/145] C++
> linking on ENOSPC** — the disk was 100% full — *after* it had already proven
> the Kotlin fix by getting that far. Read a build failure's *position* before
> its exit code. (2) It was compiling **four ABIs**. The emulator is arm64-v8a.
> `-PreactNativeArchitectures=arm64-v8a` cut a 69-minute build to **2m59s**.
> Keep that flag for QA builds only — release builds still need every ABI.

### 00.10 DEFECT D13 — `/talent/[handle]` and `/agency/[handle]` return HTTP 500 (P1)

**Reproducible on every handle, real or not**, on the deployed Preview:

```
GET /talent/qa-talent        -> 500  FUNCTION_INVOCATION_FAILED  (96-byte body)
GET /talent/NX-DOESNOTEXIST  -> 500
GET /agency/qa-agency        -> 500
GET /discover                -> 200   ← and /discover LINKS TO these pages
```

Runtime log: `digest: 'DYNAMIC_SERVER_USAGE'`, `page: '/talent/…'`.

**Mechanism.** `apps/web/src/i18n/request.ts` calls `await cookies()`. The root
layout calls next-intl's `getLocale()`/`getMessages()`, so that runs for every
page. `public_supply_feed` is **empty on Staging** (0 inspector, 0 agency_pool),
so `generateStaticParams()` returns `[]` → nothing is prerendered → every
request renders **on demand while the route still declares
`export const revalidate = 60`**, i.e. in static-generation mode, where a
dynamic API throws. `/discover` and the feeds never hit this because they were
prerendered at build time.

**FIXED and verified behaviourally on two real Preview deployments** (`4d73786`):

| Route | Before | After |
|---|---|---|
| `/talent/qa-talent` | **500** | **404** |
| `/talent/NX-DOESNOTEXIST` | **500** | **404** |
| `/agency/qa-agency` | **500** | **404** |
| `/agency/NX-NOPE` | **500** | **404** |
| `/inspections/[slug]`, `/discover`, `/inspectors`, `/feed.xml` | 404/200/200/200 | unchanged |

and the 404 is a **real rendered page (20,586 bytes)**, not a bare error string.

**The first attempt failed, and that is worth recording.** Making the
`cookies()` read optional in `i18n/request.ts` only changed the error text —
from digest `DYNAMIC_SERVER_USAGE` to
`Page changed from static to dynamic at runtime, reason: cookies`. **Next
records the dynamic access in its request store, not only by throwing**, so
swallowing the throw can never make a page statically renderable. That change
was reverted and a comment left in place so nobody retries it.

The real fix is on the pages: replace the false `export const revalidate = 60`
with `export const dynamic = 'force-dynamic'`. `generateStaticParams` is kept so
paths are still enumerated for SEO when the feed is non-empty.

> The build gate would have let this ship. A local production build compiled
> clean and classified both routes as **● (SSG)** *while the deployed Preview
> was still returning 500*. Build success is not behavioural proof — the brief
> is right about this, and it cost a full deploy cycle to see it.

**Honest caveat, still open:** `public_supply_feed` is **empty on Staging**, so
404 is the correct answer for every handle today. That the crash is gone is
proven. **That a POPULATED profile renders 200 is NOT proven** and needs a
seeded feed row on resume.

### 00.11 Findings from the Android runtime (new, from real device logs)

1. **Five files inside `app/` are not routes but Expo Router treats them as
   such**, warning on every boot: `(admin)/financial/_shared.tsx`,
   `(super-admin)/financial/_shared.tsx`, `(inspector)/reviews/reviewClient.ts`,
   `(inspector)/reviews/roundState.ts`,
   `(inspector)/legal/verification-screen.tsx`. All five have **0 default
   exports**. Four are genuine co-located helpers (imported by 5, 5, 2 and 2
   siblings). **`verification-screen.tsx` (445 lines) has zero importers — dead
   code.** A leading `_` does *not* exclude a file from Expo Router; the fix is
   to move non-route modules out of `app/`. P3, but they are reachable routes.
2. `[RootLayout] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY not set, using hard-coded
   test fallback. Production builds MUST override.` — a hard-coded Stripe test
   key fallback exists in the app. P2 config risk; the warning is correct but
   the fallback should fail closed for production builds.
3. `--- RUNNING ON SIMULATOR --- / Generating Mock Token for database testing…`
   (`src/core/notifications/hooks/usePushNotifications.ts:128`) — alarming
   wording, but it is an **Expo push token**, not an auth token, and it is gated
   on `!Device.isDevice`, so it cannot fire on real hardware. Verified
   **`push_tokens` is empty on Staging** — nothing was persisted. P3 (rename).

### 00.12 Security regressions re-proved at HEAD — 8/8, non-vacuous

`<scratchpad>/security-regressions.mjs`. Every negative is paired with a
positive control so "refused" cannot secretly mean "wrong path":

* admin **cannot** self-promote to `super_admin` (D12 holds) — control: the same
  admin reads its own profile fine, and the role is **re-read with the service
  role** afterwards, because a zero-row write is not a denial.
* plain `admin` **refused** by `admin_mark_payout_processed` with the guard's own
  message — and the call is asserted to have **resolved** (not `PGRST202`).
* `super_admin` **passes the role gate** and fails on the job instead.
* inspector sees **no** client-price/spread **values**; client sees **no**
  payout/spread **values**.
* a client **cannot** forge an `inspector_skills` row for an inspector.
* anonymous **cannot** list profiles.

> Trap hit and fixed mid-run: the first draft called the RPC with `p_reference`.
> The real signature is `(p_job_id, p_stripe_reference, p_notes)`. Wrong argument
> names give **PGRST202**, which reads exactly like a denial — and it made the
> super_admin control **vacuously pass**. The assertions now require
> `code !== 'PGRST202'`. `inspector_skills` likewise has no `skill`/`level`
> column; it is `category`/`brand_name`/`model`/`years_experience`.

### 00.13 Secret scan — clean

* `AuthKey_CNYPT4NG28.p8` (Apple) sits in the repo root but is **untracked and
  gitignored** (`.gitignore:64 *.p8`). No leak.
* Remaining regex hits are a placeholder (`re_xxxx…` in a deploy example), PEM
  header string-manipulation in `generate-vca`, and the **well-known public
  Supabase local-dev demo anon key** inside a curl comment. No real key material
  in tracked files.
* Fixed: `scripts/qa/seed-role-qa.mjs` no longer hard-codes the QA password; it
  requires `QA_SEED_PASSWORD` and exits if unset.

### 00.14 Environment problems that are NOT product defects

* **The disk hit 100%** (`ENOSPC`) and killed both the first Android build and
  the first web production build. Freed ~16 GB (Xcode DerivedData, `.next`,
  `.cxx`, npm cache). **Re-check free space before any build on this machine.**
* `git push origin release/identity-replacement` was **blocked by the sandbox
  permission classifier**. Commit `9aac6b9` exists locally and is **not pushed**.
  The owner needs to either allow the push or run it manually.
* The emulator showed a **"System UI isn't responding"** ANR under
  `swiftshader_indirect` while Gradle saturated the CPU. That is the emulator's
  SystemUI, not `com.nexpec.app` — the app's pid stayed alive throughout.
* The Claude iOS-Simulator and Android-emulator MCPs are both disabled by
  rollout flag in this build, so `xcrun simctl` / `adb` were driven directly.
  Stated openly rather than switched silently.

### 00.15 Gates re-run after this run's fixes

| Gate | Result |
|---|---|
| Workspace + Expo typechecks (`typecheck:all`) | **0 errors, exit 0** |
| Vitest | **13 files · 173/173 pass, exit 0** |
| Web production build | **✓ Compiled successfully in 19.4 min**, 0 prerender errors |
| Native **Android** build | **BUILD SUCCESSFUL, exit 0, 131 MB APK** |
| Android runtime | **installed, launched, pid alive, Bridgeless + fabric:true, no FATAL** |
| Security regressions | **8/8**, non-vacuous |
| Secret scan | clean |

**NOT re-run this session** (no reason to believe they regressed, but they are
not re-proved at `4d73786`): pgTAP 66, Deno 2.1.4 37/37, ML tests, offline
replay, the 14 QA guard scripts, clean `supabase db reset`, migration parity.

### 00.16 CLEANUP — what was done, and what is deliberately LEFT

**Done and verified by re-reading, not assumed:**

* `qa.tmpadmin@nexpec.test` and `qa.tmpsuper@nexpec.test` — privilege stripped,
  auth user deleted, profile deleted.
* **Invariant re-proved: exactly ONE privileged identity remains — the owner
  `super_admin` (email sha `f6ac53c2b120`).** Zero admins, zero synthetic.
* Both temp credentials now **refuse sign-in (400)** — a non-vacuous check.
* No synthetic jobs/RFQs/contracts/reports were created this run (the canonical
  lifecycle was not reached), so there is no synthetic business data to remove.
* `push_tokens` confirmed **empty** — the simulator mock token never persisted.

**DELIBERATELY LEFT IN PLACE — the owner must decide:**

* ⚠ **The Vercel Preview protection-bypass key is still active.** The brief says
  delete it after testing, but **testing is not finished**, and run 3's
  checkpoint records exactly this mistake: revoking it before browser and mobile
  sign-off cost that run its remaining work. Anonymous access **is** still
  protected (SSO `all_except_custom_domains`, verified 302 → `vercel.com/sso-api`
  with 0 NEXPEC bytes), so nothing is publicly readable meanwhile. Delete it at
  **Vercel → nexpec-main-platform → Settings → Deployment Protection** once QA
  is genuinely complete, then re-verify anonymous protection.
* The secret is at `~/.nexpec-preview-bypass` (0600). It was **read once into a
  tool call early in this run** while enumerating project settings — it should
  be **rotated**, not merely deleted, when the owner next touches it.

### 00.17 Preview deployments created this run (Preview only — never `--prod`)

| URL | Contents |
|---|---|
| `…-i3ko4l8mz-…` | HEAD `6840a1d`, the pre-fix baseline used for all role walks |
| `…-g3owoju0t-…` | first (failed) D13 attempt — kept as evidence |
| `…-dqqghtagq-…` | **D13 fixed**, Staging-verified (1 Staging ref / 0 Production refs) |

**Vercel Production was never deployed, never promoted. Production Supabase
`sxqpjxhslzzcdrdctatm` was never contacted — it is not even linked to the CLI.**

### 00.8 All ten roles walked — final matrix

Real UI sign-in on the deployed Preview each time; UI sign-out between roles
**does** clear the session cookie, so the isolation is genuine. Forbidden-route
blocks were confirmed against Vercel's own middleware logs
(`portal gate: role check failed … allowedRoles=[…] roleFromDb=…`), so these are
real guard decisions, not just redirects.

| Role | Landing | Own routes | Forbidden |
|---|---|---|---|
| Client | `/client/dashboard` | **22/22** | **16/16 blocked** |
| Inspector | `/inspector/dashboard` | **18/18** | **14/14 blocked** |
| Senior | `/inspector/reviews` | **8/8** | **8/8 blocked** |
| Supplier | `/suppliers/dashboard` | **11/11** | **8/8 blocked** |
| Agency | `/client/dashboard` | **10/10** | **8/8 blocked** |
| Enterprise | `/client/dashboard` | **12/12** | **8/8 blocked** |
| Talent | `/inspector/dashboard` | **7/7** | **6/6 blocked** |
| RFQ Buyer | `/client/dashboard` | **9/10** (`/agreements` redirects) | **6/6 blocked** |
| Admin (temp) | `/admin/dashboard` | **56/56** | — |
| Super Admin (temp) | `/admin/dashboard` | **12/12** | — |

**~165 route renders and ~74 forbidden-route blocks verified. Zero 500s** other
than D13.

**This is route-level coverage, NOT the full brief.** What section 5 of the brief
asks for and this run did **not** do: clicking every button, form, modal, filter,
table and chart; populated-vs-empty states; refresh/back/direct-URL/session
persistence per route; per-route console and network sweeps.

### 00.18 Remaining P3 / unexplained items

* **Missing per-route metadata is systematic, not incidental.** Whole route
  groups serve the generic site `<title>`: all 15 `/admin/ai-platform/*`,
  7 of 11 `/suppliers/*`, `/admin/rfqs`, `/rfqs`, `/rfqs/new`, `/directory`,
  `/inspector/ai-coinspector`, `/inspector/tools`. SEO/UX only.
* `OPTIONS /` → **400** (aborted) on the Preview, correlating with
  `[NotificationBellLive] realtime degraded, falling back to 25s polling`.
  Not root-caused. Degrades gracefully to polling, so not user-breaking.
* Five non-route files live inside `app/` and are treated as broken routes —
  see 00.11. `(inspector)/legal/verification-screen.tsx` (445 lines) has **zero
  importers**: dead code.
* `qa.talent@` carries role `inspector` and `qa.rfqbuyer@` carries role
  `client`. Probably intended sub-roles, **not confirmed**.
* `/agreements` redirects for RFQ Buyer — probably intentional, not confirmed.

### 00.19 THE BIG ONE STILL NOT DONE — the canonical lifecycle

**Section 6 of the brief (the 46-step lifecycle through the real UI) was not
started.** No synthetic Job was created, so nothing downstream of it — pricing,
forwarding, the three identity-disclosure modes, contract, signatures, funding,
dispatch, evidence, Flash Report, senior review, delivery, Credit Release,
dispute, payout, reconciliation — was exercised through the browser this run.
The previous run proved that chain at the **API/RLS layer** (§4 below); it has
still never been driven through the UI.

Also untouched this run: section 7 (file/media matrix), section 8 (financial
dashboard reconciliation), section 9 (mobile per-role runtime QA beyond boot),
section 10 (Resend email delivery).

**iOS was NOT rebuilt this run.** The nitro patch is Android-only
(`NitroModulesPackage.kt` is in `android/`), so iOS is not affected by it — but
the brief asks for an iOS rebuild after any nitro change and that is still owed.
Xcode DerivedData was deleted to free disk, so the next iOS build is a cold one.

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
