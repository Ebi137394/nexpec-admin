# NEXPEC — Owner Manual Mobile Test Checklist

Screen-by-screen testing for the iOS and Android app. Do the "Test once" sections on each platform, then repeat the role section for every account. Capture a screenshot/video on any failure.

**Severity:** 🔴 BLOCKER · 🟠 IMPORTANT · 🟡 MINOR.

---

## Test once on iPhone
- [ ] **Fresh install** (iOS) — install the TestFlight build → opens. Must not: crash on launch. 🔴
- [ ] **Splash** (iOS) — logo/splash shows briefly then the app. Must not: white screen / stuck. 🔴
- [ ] **Sign up / sign in** (iOS) — create/sign in. Must not: fail silently. 🔴
- [ ] **Apple/Google/LinkedIn login + deep link** (iOS) — each returns to the app via `nexpec://oauth-callback`. Must not: stuck in Safari. 🔴
- [ ] **Password reset link** (iOS) — reset email opens `reset-password` in-app. Must not: dead link. 🟠
- [ ] **Permissions in context** (iOS) — camera/photo/location/notifications prompt only when you use that feature, with clear NEXPEC wording. Must not: prompt at launch. 🟠
- [ ] **Camera** (iOS) — open capture → camera works. 🔴
- [ ] **Photo library** (iOS) — attach existing photo. 🟠
- [ ] **Microphone** (iOS) — record a voice note in chat. 🟡
- [ ] **Location** (iOS) — job map / on-site check uses location. 🟡
- [ ] **Face ID / biometric** (iOS) — enable → next sign-in offers Face ID. 🟡
- [ ] **AI model loads** (iOS) — open AI Co-inspector → model loads, no crash. 🟠
- [ ] **AI overlay** (iOS) — capture a photo → segmentation/detection overlay appears on-device. 🟠
- [ ] **Rotation/iPad** (iOS) — if using iPad, check layout; app is portrait-locked on phone (expected). 🟡

## Test once on Android
- [ ] **Fresh install** (Android) — internal-testing build installs → opens. 🔴
- [ ] **Splash + launch** (Android). 🔴
- [ ] **OAuth + deep link** (Android) — providers return to app. 🔴
- [ ] **Permissions** (Android) — camera/photo(media)/location/notifications prompt in context. 🟠
- [ ] **Hardware back button** (Android) — press Back through a modal and a chat → sensible navigation, no crash. 🟠
- [ ] **Notifications** (Android 13+) — POST_NOTIFICATIONS prompt; receive a push; tap routes to the item. 🟠
- [ ] **Adaptive icon** (Android) — check the launcher icon is centered and not clipped (see `ANDROID_ADAPTIVE_ICON_SPEC.md`). Must not: cropped/zoomed logo. 🟠
- [ ] **Keyboard** (Android) — typing in chat/forms doesn't cover the input. 🟡
- [ ] **Small phone layout** (Android) — on a small device, nothing clipped. 🟡

## Offline & sync (either platform)
- [ ] **Offline mode** — turn on Airplane mode → app still opens, cached data shows. Must not: blank/crash. 🔴
- [ ] **Airplane-mode capture** — capture 2 photos + save a flash report offline → queued (outbox badge). Must not: lost captures. 🔴
- [ ] **Reconnect sync** — turn Airplane mode off → queue drains, items sync; verify a photo is non-zero and appears on web. Must not: 0-byte / stuck queue. 🔴

## Repeat for every role (Inspector, Client, Supplier, Agency, Enterprise; Admin if mobile-supported)
- [ ] **Role selection** — after signup, pick the role → correct dashboard. 🟠
- [ ] **Role screens** — open the main screens for the role (jobs, reports, wallet, chat, messages, disputes) → load, own data only. 🔴 (data isolation)
- [ ] **Image + document upload** — upload from this role → non-zero, appears. 🟠
- [ ] **Chat** — send a message → delivered; only admin-brokered rooms exist. 🟠
- [ ] **Contracts** — view/sign a contract → "payment hold" wording. 🟠
- [ ] **Reports** — inspector submits → goes to admin review. 🔴
- [ ] **Invoices/payments** — amounts correct, own data. 🔴
- [ ] **Wallet/payouts** — payout-only figures; request payout. Must not: mint money. 🔴
- [ ] **Account deletion** — Profile → Security → Danger Zone → Delete Account (use a THROWAWAY account) → blocks if you have obligations, else anonymizes + signs you out. Must not: delete with an open job/balance. 🔴
- [ ] **Deleted/banned session cleanup** — after a test deletion, the app signs out and you cannot log back in; no repeated error popups. 🟠

## App resume / stability (either platform)
- [ ] **Background & resume** — background the app, reopen → resumes without re-login loop. 🟠
- [ ] **Crash/restart recovery** — force-quit and reopen → returns cleanly. 🟠
- [ ] **App version/build display** — check the version shown in the app matches the build you installed. 🟡
- [ ] **Privacy/Terms/Support links** — open from the app → load in-app or browser. 🟠
- [ ] **Loading / empty / error states** — screens show spinners/empty/error, never a blank crash. 🟡

---

## Launch blockers (must all pass on BOTH platforms)
1. Fresh install opens without crashing.
2. Sign-in (email + at least one OAuth) works and deep-links return to the app.
3. Camera capture → offline queue → reconnect sync, with non-zero photos.
4. Reports route to admin review; wallet cannot mint money.
5. Account deletion blocks on obligations and otherwise anonymizes + signs out.
6. Data isolation: a role never sees another user's/org's data.

## Bug Report Template
```
Title:
Web or mobile: mobile
Platform: iOS / Android + version
Device:
Role used:
Screen:
Steps to reproduce:
Expected:
Actual:
Screenshot/video:
Severity: BLOCKER / IMPORTANT / MINOR
```
