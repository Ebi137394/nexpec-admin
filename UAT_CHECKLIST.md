# NEXPEC — User Acceptance Testing (UAT) Checklist

Manual click-through QA for Web + Mobile before store submission. Check each box as you verify it. **W** = do on Web portal, **M** = do on Mobile app, **W+M** = both.

**Recommended test accounts** (create in advance): one Client, one Inspector, one Agency, one Supplier, plus your Admin. Have the Apple/Play reviewer account (`apple_tester@nexpec.com`) seeded too.

**Legend for expected result:** each step ends with → what you should see. If it doesn't match, note the screen + what happened.

---

## 1. Authentication

### 1.1 Email / password
- [ ] **W+M** Sign up with a new email → lands on **choose-role** (not a dashboard), role persists after selection, no redirect loop.
- [ ] **W+M** Sign out, sign back in with the same credentials → lands on the correct role home.
- [ ] **W+M** Sign in with a **wrong password** → clear error message, no crash, no infinite spinner.
- [ ] **M** Force-quit and reopen the app while signed in → session restores straight to the dashboard (no re-login).

### 1.2 Password reset
- [ ] **W** Click "Forgot password?" on sign-in → enter email → success state ("check your email").
- [ ] **W** Open the reset link from the email → `/reset-password` loads, set a new password → success → sign in with the new password works.
- [ ] **M** Trigger reset from the app → email link opens `reset-password` **in-app** (deep link), new password sets, sign-in works.
- [ ] **W+M** Open a reset link that's expired/already used → friendly "link expired" message with a path back to request a new one (no blank screen).

### 1.3 Social — Google
- [ ] **W+M** Tap **Continue with Google** → Google sheet opens → authorize → returns to app with a live session on the right home.
- [ ] **W+M** Start Google sign-in then **cancel / close** the sheet → returns to sign-in silently (NO error alert).
- [ ] **M** New Google account (first time) → routes to choose-role → role persists.

### 1.4 Social — Apple (Apple review-critical)
- [ ] **M (iOS device)** Tap **Continue with Apple** → native Apple sheet appears (Face ID / password) → authorize → live session, correct home.
- [ ] **M (iOS)** First-ever Apple sign-in → your name is captured (check profile shows it); second sign-in still works (Apple only sends the name once).
- [ ] **M (iOS)** Cancel the Apple sheet → returns silently, no error.
- [ ] **W** Apple sign-in from web → browser OAuth flow completes and returns a session.
- [ ] **M (Android)** Apple button (if shown) → falls back to browser OAuth, completes.

### 1.5 Social — LinkedIn
- [ ] **W+M** Tap **Continue with LinkedIn** → OIDC flow → returns a live session; profile name/avatar populated from LinkedIn.

### 1.6 MFA (if enabled on the account)
- [ ] **M** With TOTP enabled, sign in → app blocks on the MFA challenge screen until the 6-digit code is entered → then reaches home.

---

## 2. Role-specific experience & routing

### 2.1 Client / EPC
- [ ] **W+M** Sign in as Client → lands on the **client dashboard** (not inspector/admin).
- [ ] **W+M** Confirm the nav shows client-appropriate items only (post job, my jobs, contracts, messages) — no admin console, no inspector "discover".
- [ ] **W+M** Try to open an inspector-only or admin-only URL/deep link directly → redirected away (no access, no crash).

### 2.2 Inspector
- [ ] **W+M** Sign in as Inspector → **inspector dashboard**; assigned jobs list populates with correct counts.
- [ ] **M** Open **Discover** and **My Applications** from the dashboard → both open (no bounce back to dashboard).
- [ ] **W+M** On any job card, confirm the inspector sees a **payout figure only** — never the client's budget or the platform spread.

### 2.3 Agency & Supplier
- [ ] **W+M** Sign in as Agency → agency dashboard; team/roster visible.
- [ ] **W+M** Sign in as Supplier → supplier dashboard; RFQ/quotes area reachable.

### 2.4 Admin
- [ ] **W** Sign in as Admin → admin console; job moderation, dispatch, payouts, disputes all load.
- [ ] **M** Admin on mobile → admin group screens load (jobs, users, payouts, verification).

---

## 3. Core functionality — the job lifecycle

- [ ] **W+M** As **Client**, create a job (title, scope, budget) → success → it appears in the client's own job list as **pending approval**.
- [ ] **W** As **Admin**, see the new job in moderation → set pricing (client price + inspector payout) → **approve & dispatch**.
- [ ] **W+M** As **Inspector**, the dispatched job appears in Discover/assigned → apply / accept per the flow.
- [ ] **W** As **Admin**, confirm the spread cockpit shows client price, inspector payout, and platform spread — and that the client/inspector never see the spread.
- [ ] **M** As **Inspector**, submit a report with a photo (do this **offline** to test the outbox) → reconnect → report syncs (no duplicate, no 0-byte photo).
- [ ] **W** As **Admin**, review the submitted report → release it (`is_published`).
- [ ] **W+M** As **Client**, open the job → the report is now visible **only after** admin release; the evidence photo renders (signed URL, not broken).
- [ ] **W+M** As **Client**, try to open a report deep link **before** admin release → blocked / "pending review" (never shows an unreviewed report).
- [ ] **W+M** As **Client**, submit a review/rating after acceptance → saves without error.

### 3.1 Realtime & messaging
- [ ] **W+M** Open a Client↔Admin chat and an Inspector↔Admin chat → send a message → it appears instantly for the recipient; the **inbox preview + unread badge update immediately**.
- [ ] **W+M** Confirm there is **no** direct Client↔Inspector chat channel anywhere.
- [ ] **M** Send an image attachment in chat → uploads and renders (signed URL).
- [ ] **W+M** Trigger a Flash Report / NCR on a job → admin is notified; critical findings escalate.

### 3.2 Disputes
- [ ] **W+M** As Client, file a dispute on an active job → job freezes (status shows disputed), confirmation shown, admin notified.

---

## 4. Payments (Stripe) & Treasury

- [ ] **W+M** As Client, add funds / pay for a job via Stripe → payment sheet uses the **live** publishable key → completes → wallet/treasury balance reflects it.
- [ ] **W+M** Confirm the charged amount matches the job's set price (server-authoritative — you can't alter it client-side).
- [ ] **W** As Admin, an inspector requests a withdrawal → it appears in the payout queue → **Mark as Paid** (manual, admin-brokered — there is NO automatic payout).
- [ ] **W** Confirm the inspector's wallet updates only after the manual "Mark as Paid".
- [ ] **W** (If testing) Re-send/replay a Stripe webhook event → balance does **not** double-credit (idempotency).
- [ ] **W** VIP Named Disclosure (if used): identity reveal only unlocks **after** the fee payment settles.
- [ ] **W+M** Supplier flow: RFQ → quote → admin award → admin release → supplier wallet reflects the release; supplier never sees the buyer's price.

---

## 5. Storage & document access (privacy)

- [ ] **M** Inspector: own receipt, CV, and certifications render (signed URLs).
- [ ] **W+M** Client: own vault / compliance document opens; **another** client's document does NOT open.
- [ ] **W+M** Contract PDF opens full-screen in-app (not routed through an external Google viewer).
- [ ] **W** Client viewing an inspector application pre-hire: sees **no** raw "View CV" link; sees expense **amounts** but **no** raw receipt image.
- [ ] **W** Admin verification console: inspector ID documents render.

---

## 6. Navigation & edge cases

- [ ] **M** Cold-start a deep link into a job detail → the back button lands on a real screen (not a dead end / blank).
- [ ] **W+M** Hit every primary back arrow / header close on 8–10 screens → each returns somewhere valid.
- [ ] **M** Open the Map screen and the in-app document viewer → both have a working back control.
- [ ] **W+M** Open a modal (filter, attachment picker, confirm dialog) → the close/cancel button and (Android) hardware back both dismiss it.
- [ ] **W+M** Visit a list with no data yet (empty applications, empty inbox, empty payouts) → a proper **empty state** shows (not a spinner forever, not a raw error).
- [ ] **M** Deny a permission when prompted (camera, photos, location) → the app handles it gracefully with a clear message, no crash.
- [ ] **M** Grant camera/photos and capture → upload works.
- [ ] **W+M** **Log out** → returns to sign-in; protected screens are no longer reachable via back button or direct URL.
- [ ] **M** Turn on Airplane Mode mid-session → field screens still work (offline-first); actions queue and sync on reconnect.
- [ ] **W+M** Rotate device / resize browser on a couple of key screens → layout holds.

---

## 7. Brand & polish spot-check

- [ ] **W+M** Accent color is **#7C3AED** (purple), background **#020420** — no leftover cyan on buttons/badges/headers.
- [ ] **W+M** No visible "test", "debug", "dummy", or placeholder text on any user-facing screen.
- [ ] **M** Debug/diagnostic screens are **not reachable** in the production build.
- [ ] **W+M** App icon and splash screen render correctly on launch (real brand mark, correct background).

---

## 8. Cross-platform parity spot-check

- [ ] A job created on **Web** appears on **Mobile** (same account) and vice versa.
- [ ] A message sent on **Mobile** shows on **Web** in the same thread.
- [ ] Wallet balance matches between Web and Mobile for the same user.
- [ ] Notification marked read on one platform reflects on the other (bell count).

---

### Sign-off
- [ ] All P0 flows (auth, job lifecycle, payments, report gate) pass on **both** platforms.
- [ ] Any bug found is logged with: screen, steps, expected vs actual, platform.
- [ ] Re-tested every fix before final submission.

*Tip: run §1–§4 first (the blockers). If those are clean, you're in submit-ready shape; §5–§8 are polish confirmation.*
