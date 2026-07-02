# Security Settings — End-to-End QA Checklist

Screen: `app/profile/security.tsx` (single shared screen → identical for **Client, Inspector, Agency, Enterprise**; Admin/super-admin use the admin console but the same auth ops apply).

Epic commits: `16971d8` (Set 1) · `fed1526` (Set 2) · `a4b239d` (Set 3) · `bee7976` (Set 4).

---

## 0. Preconditions (deployment)

- [ ] `supabase migration list` shows applied: `…160000`, `…162000`, `…164000` (safe delete), `…166000` (sessions).
- [ ] `supabase functions list` shows **delete-account** deployed.
- [ ] App rebuilt/reloaded so the latest JS bundle is running.
- [ ] Have at least 2 test accounts per role you want to cover, and (ideally) a 2nd device or simulator for multi-session tests.

> Tip (simulator biometrics): **Features → Face ID → Enrolled**, then **Features → Face ID → Matching Face / Non-matching Face** to simulate success/failure.

---

## 1. Change Password (reauthentication)

- [ ] Security → **Change Password** opens the modal with **three** fields: Current, New, Confirm.
- [ ] Wrong current password → **"Current password is incorrect."** (no change made).
- [ ] New password < 8 chars → **"Use at least 8 characters."**
- [ ] New password == current → **"Reuse Blocked."**
- [ ] New ≠ Confirm → **"passwords do not match."**
- [ ] Correct current + valid new → **"password updated securely"**; modal closes.
- [ ] Sign out → sign in with the **new** password succeeds; old password rejected.
- [ ] Closing the modal (X) clears all three fields.

## 2. Two-Factor Authentication (TOTP)

**Enroll**
- [ ] Toggle **Two-Factor Authentication** ON → setup modal shows a secret key.
- [ ] Add the key to an authenticator app (Google Authenticator/Authy) → enter the 6-digit code → **"Secured!"**; toggle stays ON, subtitle reads "Active, authenticator app".
- [ ] The **Recovery Codes** card appears once 2FA is on.

**Enforcement (the critical part — was "enrolled but toothless")**
- [ ] Fully **sign out**, then sign in with **email + password** → you are held on the **Two-Factor Verification** screen (cannot reach the app).
- [ ] Wrong code → error + re-prompt (and it silently re-issues a fresh challenge).
- [ ] Correct code → lands on your role's home.
- [ ] **Relaunch the app** while logged in at AAL1 (kill + reopen) → you're sent back to the Two-Factor Verification screen (session-restore path is enforced too).
- [ ] **Biometric login** path (if enabled) also lands on the challenge before the app.
- [ ] "Sign out" on the challenge screen returns to login.

**Disable / negative**
- [ ] Toggle 2FA OFF → confirm → next sign-in has **no** challenge.
- [ ] A user with **no** 2FA signs in normally (no challenge, no redirect loop).

## 3. Biometric Login (persist + real sign-in integration)

- [ ] Toggle **Biometric Login** ON → OS Face ID/Touch ID prompt → success → **"Enabled"**.
- [ ] Leave the screen and **return to Security** → the toggle is still **ON** (persisted — the old bug reset it to OFF).
- [ ] Sign out → the **sign-in screen shows "Sign in with Face ID/Touch ID"** → tap → authenticates → logs in.
- [ ] If 2FA is also on → after biometric you still hit the 2FA challenge (defense in depth).
- [ ] Toggle Biometric OFF → sign-in no longer offers it.
- [ ] Cancel the biometric prompt during enable → toggle stays OFF, no error spam.

## 4. Active Sessions (real list + revoke)

- [ ] Active Sessions shows **this device** with a **Current** badge (device name, "Active now", IP).
- [ ] Sign in on a **second device/simulator** with the same account → return + reopen Security → the **second session appears** (non-current) with a **log-out (trash) icon**.
- [ ] Tap trash on the other session → confirm → it disappears; that other device is signed out (its next action forces re-login).
- [ ] The **Current** session has **no** trash icon (protected).
- [ ] **Log out of all other devices** → all non-current sessions disappear; current stays signed in.
- [ ] DB spot-check: `select id, user_agent, ip, updated_at from auth.sessions where user_id = '<uid>';` matches what's shown.

## 5. Delete Account (guarded soft-delete + anonymize + ban)

**Guards (must BLOCK)**
- [ ] With an **active job** (status open/assigned/in_progress/pending_approval/disputed as client, contractor, or agency) → Delete → blocked: **"You have N active job(s)…"**. Account untouched.
- [ ] With **wallet funds** (available/pending/escrow/pending_payouts > 0) → Delete → blocked: **"wallet still holds funds…"**. Account untouched.

**Clean deletion (should SUCCEED)**
- [ ] Account with no active jobs and an empty wallet → Delete → confirm → signed out → routed to sign-in.
- [ ] Try to log back in with that account → **blocked** (banned).
- [ ] DB check — anonymized + retained:
  - `select full_name, email, status, deleted_at, anonymized_at from profiles where id='<uid>';` → `Deleted user`, `deleted+…@deleted.nexpec.invalid`, `suspended`, timestamps set.
  - `select count(*) from jobs where client_id='<uid>' or contractor_id='<uid>';` → **rows still present** (records retained).
  - `select banned_until from auth.users where id='<uid>';` → far-future timestamp.

## 6. Cross-role + regression

- [ ] Repeat §1–§5 (at least Change Password, 2FA enforce, Delete guard) signed in as **Client**, **Inspector**, and one org role (**Agency/Enterprise**) — behavior identical.
- [ ] Screen is reachable from each role's Profile → Settings/Security.
- [ ] App is **dark-only** — no Dark Mode toggle on Profile or Settings (earlier change); normal navigation has no redirect loops for non-2FA users.

---

### If something fails
Note the exact toast/alert text + which step. The most likely environment issues (not code): biometrics not enrolled in the simulator (§3), authenticator clock drift (§2 wrong code), or a migration/function not deployed (§0).
