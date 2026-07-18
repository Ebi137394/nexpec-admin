# NEXPEC — App Store & Google Play Launch Plan

Based on the **real** mobile config (`app.config.js`, `eas.json`). Status = what the repo already provides vs what you must supply.

## Config readiness snapshot (from repo)

| Item | Status | Evidence / action |
|---|---|---|
| Bundle ID (iOS) / Package (Android) | ✅ Ready | `com.nexpec.app` (consistent both platforms) |
| App name | ✅ Ready | `NEXPEC` |
| Version | ✅ Ready | `1.0.0` (`app.config.js`) |
| Build number / versionCode | ✅ Auto | `autoIncrement: true` (preview+production EAS profiles) |
| App icon | ✅ Present | `assets/icon.png` (384 KB) |
| Adaptive icon (Android) | ✅ Present | `assets/adaptive-icon.png` — ⚠️ identical bytes to icon.png; confirm it's a proper foreground layer |
| Splash | ✅ Present | `assets/splash-logo.png`, bg `#020420` |
| Sign in with Apple | ✅ Configured | `usesAppleSignIn: true` (Guideline 4.8) |
| Export compliance | ✅ Baked | `ITSAppUsesNonExemptEncryption: false` |
| iOS permission strings | ✅ Present | camera, photo, location-when-in-use, FaceID, calendar, reminders, microphone (all with real usage copy) |
| Android permissions | ✅ Trimmed | camera, record_audio, fine/coarse location, biometric, calendar, media_images, post_notifications, boot, vibrate, wake_lock; sensitive perms blocked |
| New Architecture | ✅ On | Nitro/Skia/fast-tflite |
| OTA (EAS Update) | ✅ Config | runtimeVersion `appVersion`; bound projectId |
| **iOS submit credentials** | ❌ Missing | `eas.json` has `REPLACE_WITH_APPLE_ID / ASC_APP_ID / APPLE_TEAM_ID` |
| **Android service account** | ❌ Missing | `google-service-account.json` (gitignored) must be placed + Play "Release manager" |
| **Screenshots** | ❌ Missing | must be produced (see below) |
| **Store listing text** | ⚠️ Draft below | not in repo |
| **Privacy Policy URL** | ✅ Content ready | `https://nexpecapp.com/legal/privacy` (must be live) |
| **Account-deletion URL** | ✅ Ready | `https://nexpecapp.com/account/delete` (Play requirement) |
| **Reviewer account** | ⚠️ Seed step | `apple_tester@nexpec.com` via `supabase/seed_apple_reviewer.sql` |

---

## APPLE APP STORE

### Prerequisites
Apple Developer Program membership · App ID `com.nexpec.app` with Sign In with Apple capability · a Services ID for the Supabase web-OAuth return URL · App Store Connect app record (version 1.0.0) · distribution cert + provisioning (let EAS manage).

### Files/assets required
6.7" (iPhone 15 Pro Max) + 6.5" screenshot sets (min); iPad set if `supportsTablet` stays true (it is `true`) — **either produce iPad screenshots or set `supportsTablet: false`**; app icon (from binary); privacy policy URL; support + marketing URLs.

### Submission sequence
1. Fill `eas.json` submit.ios (Apple ID, ASC App ID, Team ID). **[SECRET]**
2. `eas build -p ios --profile production` → `eas submit -p ios --latest`.
3. App Store Connect → TestFlight: wait processing, add internal testers, **smoke on a real device**.
4. Fill App Privacy questionnaire (below), App Review Information (reviewer account + notes), screenshots, description/keywords/URLs.
5. Attach build → Submit for Review.

### App Privacy questionnaire answers
Data collected: **Contact Info** (email, name), **User Content** (photos, documents), **Identifiers** (user ID), **Usage/Diagnostics** (crash data if Sentry enabled). All **linked to user**, **none used for tracking** → no ATT prompt. Note the De-Identified Technical Data / AI retention is disclosed in the Privacy Policy.

### Likely rejection reasons → avoidance
- **3.1.1 (IAP)** — core marketplace is a real-world service → Stripe is allowed (3.1.5(a)). **Do not** let the iOS binary link/steer to the web to pay the Named-Disclosure identity-unlock fee (that fee is web-only by design). Verify no such CTA ships.
- **5.1.1(v) Account deletion** — in-app delete exists (Security → Delete Account) + web `/account/delete`. Reachable in ≤3 taps.
- **2.1 Completeness** — reviewer account must be pre-seeded with jobs/chats so no empty states.
- **5.1.1 Permissions** — strings are specific; ensure prompts fire in-context, not at launch.
- **1.2 UGC** — chat + photos: state in notes that all chat rooms include platform staff (moderation by construction) and disputes/flagging exist.
- **2.3 Metadata** — screenshot only reproducible states; no Android/beta mentions.

---

## GOOGLE PLAY

### Prerequisites
Play Console account · app `com.nexpec.app` · upload key / Play App Signing · `google-service-account.json` with Release-manager access.

### Files/assets required
Phone screenshots (min 2) + 7"/10" tablet if declared · 512×512 icon · 1024×500 feature graphic · privacy policy URL · **account-deletion web URL** `https://nexpecapp.com/account/delete` · data-safety form.

### Submission sequence
1. Place `google-service-account.json` at repo root. **[SECRET]**
2. `eas build -p android --profile production` (.aab) → `eas submit -p android --latest` (internal track).
3. Play Console → App content: privacy policy, **data safety** (mirror Apple answers + Sentry crash), content rating (target 18+), ads = none, News = no.
4. **App access**: provide reviewer credentials. **Account deletion**: enter the web URL.
5. Internal testing → smoke (incl. hardware back through modal + chat) → promote to Production, **staged 20%**.

### Likely rejection reasons → avoidance
- **Data-safety mismatch** — must match observed traffic (Stripe, Supabase, Sentry). #1 Play rejection.
- **Missing account-deletion URL** — provide the web URL (works without reinstall).
- **Permissions** — no background location / SMS / call log → stays out of sensitive-permission review.
- **Pre-launch report** crashes — check the robo-crawl results before promoting.

---

## Drafted store copy (no unsupported claims)

**App Store description (≤4000 chars):**
> NEXPEC is the trust infrastructure for industrial inspection. It connects asset owners and EPCs with vetted, independent inspectors through a brokered, contract-first marketplace — and gives inspectors a professional field app with an on-device AI co-inspector.
>
> For inspectors: discover jobs, submit bids, sign contracts, capture evidence in the field (even offline), and get paid through a protected payout-hold ledger. An on-device AI assists with defect detection — no cloud dependency, evidence stays on your device until you sync.
>
> For clients and enterprises: post an inspection scope, let NEXPEC broker a vetted specialist, monitor progress, and receive expert-reviewed reports. Every price is protected by structural blindness — you see your price, the inspector sees their payout.
>
> • Brokered, contract-first engagements
> • On-device AI co-inspector with offline capture
> • Cryptographically signed evidence packs
> • Admin-reviewed reports before delivery
> • Protected payments via Stripe; manual, reviewed payouts
> • Full account controls, including in-app account deletion
>
> Payments are processed by Stripe. NEXPEC is not a bank or money-services business.

**Google Play short description (≤80 chars):**
> Brokered industrial inspection marketplace with an on-device AI co-inspector.

**Google Play full description:** (reuse the App Store body above; Play allows 4000 chars.)

**Keyword suggestions (iOS ≤100 chars, comma-sep):**
> inspection,NDT,industrial,inspector,QA,QC,asset integrity,field inspection,corrosion,reports

**Reviewer notes (both stores):**
> Two-sided industrial inspection marketplace. Demo account: apple_tester@nexpec.com (password provided separately). It is pre-seeded with an inspector profile, sample jobs, and chat threads. Payments use Stripe test rails. All in-app chat includes NEXPEC staff (moderation by construction). Account deletion is available in-app under Profile → Security → Delete Account, and on the web at nexpecapp.com/account/delete. Sign in with Apple is offered alongside Google and LinkedIn.

**Test-account instructions:** create/seed `apple_tester@nexpec.com` (Auto-Confirm ON) → run `supabase/seed_apple_reviewer.sql` → verify it can browse a job, open a chat, and reach the Delete Account screen (do not actually delete the reviewer account).

## Final submission checklist
- [ ] `eas.json` Apple submit fields filled · `google-service-account.json` placed
- [ ] Privacy Policy + account-deletion URLs live
- [ ] Reviewer account seeded + verified (not deletable state)
- [ ] Screenshots (phone + tablet/iPad or `supportsTablet:false`)
- [ ] App Privacy + Data-safety forms completed and consistent
- [ ] Real-device TestFlight / internal-testing smoke passed
- [ ] No iOS CTA steering to web payment (Named-Disclosure)
- [ ] Staged rollout configured (Android 20%)
