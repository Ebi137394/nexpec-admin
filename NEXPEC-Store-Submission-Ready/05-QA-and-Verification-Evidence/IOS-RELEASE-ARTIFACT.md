# iOS release artifact — verified

| Field | Value |
|---|---|
| Build ID | `326d0134-e514-4274-9d27-b2c4954c394c` |
| Status | **FINISHED** |
| Commit | `b13d77e22b0cb04622291cb106cdc5bae23d7c17` (current HEAD) |
| Version / build | `1.0.0` / **5** |
| Profile / distribution | `production` / STORE |
| Expo SDK | 52.0.0 |
| Duration | 2026-08-20 23:20:23Z → 23:31:36Z (11m 13s) |
| IPA | https://expo.dev/artifacts/eas/73OGXEhhTJ0dQ9b_jh4i8hWyt1Mv-pMTUBxyxIMDJM4.ipa |
| Size / SHA-256 | 142 MB / `44ac563149c36dfa4b41add9d6f7aff753bbbd7265c4526683e99a0b4a94a7a7` |

Built from `b13d77e`; Android from `420696c`. The delta is **one documentation
file** — `git diff --name-only` between them returns no application code, so the
two artifacts carry identical app code.

## Signing and provisioning

| Check | Result |
|---|---|
| Authority chain | `iPhone Distribution: Technologies NEXPEC inc (CLR47V4LDP)` → Apple WWDR CA → Apple Root CA |
| `codesign --verify --deep --strict` | **valid on disk**, satisfies its Designated Requirement |
| Sealed resources | 526 files, format `app bundle with Mach-O thin (arm64)` |
| Profile | `*[expo] com.nexpec.app AppStore …` — App Store distribution (no `ProvisionedDevices`, no `ProvisionsAllDevices`) |
| Team | `CLR47V4LDP` · Technologies NEXPEC inc · expires **2027-08-20** |
| `application-identifier` | `CLR47V4LDP.com.nexpec.app` |
| `aps-environment` | **production** |
| `get-task-allow` | **false** (release, not debuggable) |
| `beta-reports-active` | true (TestFlight) |
| Sign in with Apple | present — required because the app offers Google sign-in |

## Bundle identity

`com.nexpec.app` · NEXPEC · 1.0.0 (5) · MinimumOSVersion 15.1 ·
iPhoneOS · UIDeviceFamily [1,2] · **arm64 only** (no simulator slice) ·
`ITSAppUsesNonExemptEncryption = false`

## App Review surface

- **14 `NS*UsageDescription` strings**, all populated.
- **`PrivacyInfo.xcprivacy` present** at app level, declaring FileTimestamp,
  UserDefaults and SystemBootTime API reasons, plus **11 SDK privacy bundles**.
- **ATS: `NSAllowsArbitraryLoads = false`** — HTTPS enforced. iOS counterpart to
  the Android cleartext fix.
- URL schemes registered: **`nexpec`** and `com.nexpec.app` — so
  `nexpec://reset-password` resolves.
- App icon: 2 AppIcon entries + `Assets.car` (3.0 MB).

## Payload verified, not assumed

Extracted `main.jsbundle` (Hermes, 9.6 MB) and the Mach-O binary:

| Check | Result |
|---|---|
| Supabase endpoint | `https://sxqpjxhslzzcdrdctatm.supabase.co` — **Production**, 1 occurrence |
| Staging endpoint | **0 occurrences** |
| Embedded Supabase JWT | exactly one, `role=anon`, `ref=sxqpjxhslzzcdrdctatm` |
| **service_role JWT** | **0** — none in iOS or Android |
| ML runtime | `EXPO_PUBLIC_ML_RUNTIME` ×2; **342 TFLite** and 38 NitroModules symbols |
| Sentry runtime | **1232 symbols** — crash reporting intact (only source-map upload is disabled) |
| Payment posture | "Coming Soon" / "Available Now" / "Manual payment" / "Online card payment" all present |
| Stripe publishable key | only `pk_test_…` (110 chars) |

### The `pk_live_` string — checked, not waved through

A 171-character `pk_live_…` run appears in the iOS bundle (Android's was 19).
It is **not a key**. Its context reads:

```
…stepChart1hypcn5o pk_live_61gmhf 7c53c47a66934504fcbc7cc164895a7
Unternehmensprivilegien forceRange…
```

Hermes stores string-table entries back-to-back with no delimiter, so a greedy
`[A-Za-z0-9]{30,}` match merges unrelated neighbours — here a fragment, a hex id,
then German i18n text. The run terminates inside `supabase_service_role_key`,
which is a **variable name**, not a value. The same `1hypcn5o` neighbour precedes
`pk_live_` in the Android bundle. Real Stripe publishable keys are ~107
characters and contiguous; this is 171 and runs into prose. Confirmed by the
JWT decode above: the only credential in either artifact is the public `anon`
key, which is designed to ship in clients.

## Runtime configuration

EAS Update is **enabled**: channel `production`, runtime version `1.0.0`,
`EXUpdatesCheckOnLaunch: ALWAYS`, `EXUpdatesLaunchWaitMs: 0`. OTA delivery is
live, which is worth knowing before review — an OTA push can change JS after
approval.

## Not done

Not submitted to App Store. Not rebuilt. Production database untouched.
