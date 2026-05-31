# NEXPEC Release Runbook (1.0)

End-to-end steps to ship the mobile apps, wire credentials, and turn on the
backend jobs. Config lives in `eas.json` (build/submit profiles) and
`app.config.js` (native config + OTA). Secrets are never committed.

## 0. One-time project link

```bash
npm i -g eas-cli
eas login
eas init            # creates the Expo project, writes the real projectId
```

Set `EAS_PROJECT_ID` (from `eas init`) in your shell / CI and as an EAS secret so
`app.config.js` resolves `eas.projectId` and the OTA `updates.url`. Then:

```bash
eas update:configure   # confirms runtimeVersion + updates.url in app.config.js
```

## 1. Build-time secrets (EAS)

Every `EXPO_PUBLIC_*` value the bundle needs must exist as an EAS secret before
the first production build (they are intentionally NOT in the repo):

```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL            --value https://<ref>.supabase.co
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY       --value <anon-key>
eas secret:create --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY  --value pk_live_...
eas secret:create --name EXPO_PUBLIC_SENTRY_DSN              --value https://...ingest.sentry.io/...
# Optional — only to OVERRIDE the public key pinned in flags.ts (emergency rotation):
# eas secret:create --name EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM --value "$(cat nexpec_model_signing.pub.pem)"
```

Sentry source-map upload (CI only): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT` (web) / `SENTRY_PROJECT_MOBILE` (native) as repo/CI secrets.

## 2. Apple credentials (iOS)

Easiest, least-manual path is an **App Store Connect API key** — EAS uses it to
create signing certs, provisioning profiles, and to submit, with no manual
portal clicks.

1. App Store Connect → Users and Access → Integrations → **App Store Connect API**
   → generate a key with **App Manager** role. Download the `.p8` **once**.
2. Create the app record in App Store Connect (bundle id `com.nexpec.app`); note
   its **ascAppId** (the numeric Apple ID of the app).
3. Fill `eas.json → submit.production.ios`: `appleId` (your Apple account email),
   `ascAppId`, `appleTeamId` (Membership → Team ID).
4. Let EAS manage signing:

```bash
eas credentials            # iOS → set up the ASC API key (.p8), let EAS manage certs/profiles
```

EAS stores the key; certs/profiles are generated on first build. (Manual
certificates work too via `eas credentials`, but the API key is recommended.)

## 3. Android credentials

```bash
eas credentials            # Android → let EAS generate & store the upload keystore
```

For `eas submit`, create a **Google Play service account** (Play Console → Setup
→ API access), grant it release permissions, download the JSON, and point
`eas.json → submit.production.android.serviceAccountKeyPath` at it (gitignored —
it is a secret). `track: internal`, `releaseStatus: draft` are set for a safe
first upload.

## 4. Build & submit

```bash
# QA build (TestFlight / internal Play): production code path, internal dist
eas build --profile preview    -p ios
eas build --profile preview    -p android

# Store builds
eas build --profile production -p ios       # Release, autoIncrement buildNumber
eas build --profile production -p android   # AAB, autoIncrement versionCode
eas submit --profile production -p ios
eas submit --profile production -p android
```

`autoIncrement` + `appVersionSource: remote` mean build numbers never collide
with a prior submission. Bump `version` in `app.config.js` for a user-facing
release (this also moves `runtimeVersion`, so OTA bundles stay matched to native).

## 5. OTA updates (between native releases)

JS-only fixes ship without a store review, but ONLY to a build with the same
`runtimeVersion`:

```bash
eas update --channel production --message "hotfix: ..."
```

If you changed native code (a new config plugin, a native dep), you must do a
full store build — OTA cannot deliver native changes.

## 6. Backend: migrations, OTS cron, model registration

```bash
# Apply DB migrations (first push needs --include-all to backfill ordering)
supabase db push --include-all

# Deploy the timestamping functions
supabase functions deploy anchor-inspection-seals
supabase functions deploy confirm-inspection-anchors

# Schedule them with pg_cron (anchor often, confirm hourly — Bitcoin is slow):
#   select cron.schedule('ots-anchor',  '*/10 * * * *', $$ select net.http_post('<func-url>/anchor-inspection-seals',  '{}', 'application/json') $$);
#   select cron.schedule('ots-confirm', '17   * * * *', $$ select net.http_post('<func-url>/confirm-inspection-anchors','{}', 'application/json') $$);

# Register + publish the signed on-device model (signing box only — holds the key)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ./scripts/ml/register-corrosion-detector.sh
```

## 7. Pre-flight checklist

- [ ] `EAS_PROJECT_ID` set; `app.config.js` `eas.projectId` no longer the placeholder
- [ ] All `EXPO_PUBLIC_*` EAS secrets created; Sentry DSN supplied
- [ ] `submit.production.ios` ids filled; ASC API key in `eas credentials`
- [ ] Android keystore + Play service-account JSON in place
- [ ] `supabase db push --include-all` applied; `supabase test db` green
- [ ] `node scripts/ml/prove-loop.mjs` and `node scripts/ml/prove-ots.mjs` pass
- [ ] Burned key `nexpec_signing_v1.pem` purged from history (see KEY_CUSTODY.md)
- [ ] Model registered & published; a sealed report shows `bitcoin_confirmed` after a few hours
```
