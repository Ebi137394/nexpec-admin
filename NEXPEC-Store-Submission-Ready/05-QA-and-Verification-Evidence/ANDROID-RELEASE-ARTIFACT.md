# Android release artifact — first successful production build

| Field | Value |
|---|---|
| Build ID | `ac6dcb7a-ae5f-4427-90bd-209281819ec2` |
| Status | **FINISHED** |
| Commit | `420696cd311f147147e2e9138559623291528314` |
| Version / versionCode | `1.0.0` / **11** |
| Profile / distribution | `production` / STORE (app-bundle) |
| Expo SDK | 52.0.0 |
| Started → completed | 2026-08-20 22:18:41Z → 22:46:04Z (27m 23s) |
| AAB | https://expo.dev/artifacts/eas/lUzgCrlh4S1VODyJ_-a-LdzceIF88pgRutdJYabniDQ.aab |
| Size / SHA-256 | 266 MB / `a0038d2f144380b051fef552006acc01e73f774d05b97ca35c34e7c7a444c465` |

Eight prior production builds failed, every one since 2026-06-06.

## What actually fixed it

The owner's diagnosis: the build passed prebuild, credentials, JS bundling and
native compilation, and failed only in the **optional Sentry source-map upload**
with *"An organization ID or slug is required (provide with --org)"*.

Corroborated by the config — `app.config.js` passes
`organization: process.env.SENTRY_ORG` and `project: process.env.SENTRY_PROJECT_MOBILE`
to `@sentry/react-native/expo`, and neither variable existed in the EAS
environment, so `organization` resolved to `undefined`.

Fix applied: **`SENTRY_DISABLE_AUTO_UPLOAD=true`, EAS Production environment only.**
Verified absent from `preview` and `development`. **No repository change** — no
Gradle, Expo SDK, native module, TFLite, application or database code was
touched for this.

Runtime Sentry is untouched and still in the artifact: `Sentry.init()` remains in
`src/observability/sentry.native.ts`, and the shipped manifest contains
`com.nexpec.app.SentryInitProvider`. Only symbolication upload is skipped.

## Verified against the artifact, not the config

Extracted `base/assets/index.android.bundle` (Hermes, 9.6 MB) and
`base/manifest/AndroidManifest.xml` from the AAB:

| Check | Result |
|---|---|
| Supabase endpoint | `https://sxqpjxhslzzcdrdctatm.supabase.co` — **Production**, 1 occurrence |
| Staging endpoint | **0 occurrences** of `zmzvmgaeovleuvbvwxei` |
| `EXPO_PUBLIC_ML_RUNTIME` | `=1` in the Production EAS environment; 2 references in the bundle; 16 native `libNitroTflite`/`libNitroModules` entries |
| Online payments | "Coming Soon" / "Available Now" / "Manual payment" / "Online card payment" / "card payment isn't available in-app" all present |
| Stripe key | only `pk_test_…` (110 chars). A `pk_live_72b` fragment appears but is 19 chars and sits mid-sentence in Hermes' concatenated string table — an accidental substring, **not key material**. Zero `pk_live_` followed by 30+ chars. |
| Package | `com.nexpec.app` |
| `usesCleartextTraffic` | **present in the shipped manifest** — confirming the earlier fix, which had set it on an invalid Expo `android` key where prebuild silently dropped it |
| Signing | `META-INF/E8DB6183.RSA` + `.SF` + `MANIFEST.MF` (EAS keystore `euHbHmVpHS`) |

## Not done

**Not submitted to Google Play.** Production database untouched — still 188
migrations, newest `20260801500000`, 18 users / 18 profiles / 23 jobs.

## Follow-up for a later release

Source maps are not being uploaded, so Sentry will report unsymbolicated stacks
for this build. The permanent fix is to set `SENTRY_ORG`,
`SENTRY_PROJECT_MOBILE` and `SENTRY_AUTH_TOKEN` in the EAS Production
environment and remove `SENTRY_DISABLE_AUTO_UPLOAD` — deliberately out of scope
for this release.
