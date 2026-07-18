# NEXPEC — Owner Manual Web Test Checklist

Plain-English testing you can do yourself in a browser. No SQL needed. Test in order. Mark each box. If something fails, note the severity and capture a screenshot.

**Severity:** 🔴 BLOCKER (stop launch) · 🟠 IMPORTANT (fix soon) · 🟡 MINOR (post-launch).
**Accounts you'll need:** an Inspector, a Client, a Supplier, an Agency owner, an Enterprise member, an Admin, and (for owner tests) the Platform Owner. See `TEST_ACCOUNT_PLAN.md`.

Tip: open DevTools → Console (F12) and watch for red errors as you go (test 44).

---

## 1. Landing & shell
- [ ] **Landing page** (`/`) — Anyone → visit → see hero, marketing sections, footer. Must not: blank screen, broken images. 🔴
- [ ] **Header/nav** — Anyone → click each nav item → correct pages load. Must not: dead links. 🟠
- [ ] **Footer + legal links** — Anyone → click Privacy, Terms, Support/Contact → each opens. Must not: 404. 🟠 (capture if 404)
- [ ] **Production badge** — Admin → look at header + sidebar footer → header says "PRODUCTION", footer shows `build-<sha>` (NOT `build-local`). Must not: "DEVELOPMENT" or "build-local" in prod. 🟠

## 2. Auth
- [ ] **Sign up** — New email → complete signup → account created, routed to role home. Must not: silent failure. 🔴
- [ ] **Email verification** — check inbox → link verifies. Must not: no email / dead link. 🟠
- [ ] **Sign in** — existing user → sign in → lands in correct portal. Must not: wrong portal / loop. 🔴
- [ ] **Forgot/reset password** — request reset → email link → set new password → sign in with it. Must not: link broken. 🔴
- [ ] **OAuth login** — click Google, then Apple, then LinkedIn → each returns signed-in. Must not: stuck on provider / error. 🔴 (screenshot the error URL)
- [ ] **Sign out** — click Sign out → back to sign-in, session cleared. Must not: still logged in. 🟠

## 3. Portals load (data isolation)
- [ ] **Inspector portal** — Inspector → dashboard loads own data only. Must not: see other users' data. 🔴
- [ ] **Client portal** — Client → dashboard loads. 🔴
- [ ] **Supplier portal** — Supplier → dashboard + supplier menu. 🟠
- [ ] **Agency portal** — Agency owner → `/client` portal, agency scope. Must not: another org's data. 🔴
- [ ] **Enterprise portal** — Enterprise member → `/client` portal + org surfaces. 🟠
- [ ] **Admin portal** — Admin → admin console loads. Must not: non-admin can open `/admin/*`. 🔴
- [ ] **Super Admin** — Super Admin → full admin access. 🔴
- [ ] **Platform Owner** — Owner → full admin access retained. Must not: owner locked out. 🔴

## 4. Profile & settings (+ the new section)
- [ ] **Settings load** — each role → open Settings → page renders with your data. Must not: "Couldn't load your profile" error card (if you see it, that's a real recoverable-error state — screenshot it, severity 🟠; it means the profile query failed and the page correctly shows an error instead of hiding settings). 🟠
- [ ] **Account and privacy section** — Inspector/Client/Supplier/Agency/Enterprise → scroll to the very bottom of Settings, below Two-factor authentication → see the "Account and privacy" heading and a red "Delete account" card. Must not: missing, or appear for Admin/Super Admin. 🔴
- [ ] **Delete button routes** — click "Delete account" → lands on `/account/delete` page (do NOT confirm deletion on a real account). Must not: 404 / dead button. 🔴
- [ ] **Admin has no delete** — Admin/Super Admin → Settings has NO "Account and privacy"/Delete section. Must not: a delete control appears. 🔴

## 5. Uploads & core flows
- [ ] **Upload files** — Inspector → upload avatar + a document → image shows, file saved. Must not: 0-byte / broken image / 403. 🟠
- [ ] **Job creation** — Client → post a job → goes to review (not public yet). Must not: publishes unreviewed. 🔴
- [ ] **Job approval** — Admin → approve the job → it publishes to open. Must not: stuck / stays hidden. 🔴
- [ ] **Job discovery** — Inspector → see the open job. Must not: see the client's price or platform margin anywhere. 🔴
- [ ] **Applications/bids** — Inspector → submit a bid → Admin/Client sees it. 🟠
- [ ] **Contracts** — Client → sign & fund contract → copy says "payment hold" (not "escrow"). Must not: "escrow" in user text. 🟠
- [ ] **Reports** — Inspector submits report → goes to Admin first, Client sees it only after Admin confirms. Must not: client sees pre-review. 🔴
- [ ] **Findings/NCRs** — create a flash report / NCR → appears for the right roles. 🟠
- [ ] **Chat** — send a message client↔admin and inspector↔admin → delivered. Must not: a direct client↔inspector room exists. 🔴
- [ ] **Notifications** — trigger one (e.g., approval) → bell updates; tap routes to the item. Must not: no route / duplicate. 🟠

## 6. Money
- [ ] **Invoices** — Client → view invoices → correct amounts, own invoices only. 🔴
- [ ] **Wallet & payouts** — Inspector → wallet shows payout-only figures; request a payout. Must not: any "mint money" / auto-payout. 🔴
- [ ] **Stripe payment** — Client → pay with Stripe **test** card `4242 4242 4242 4242` → succeeds. Must not: charge error. 🔴
- [ ] **Disputes** — Client → file a dispute → it says payout **release** is paused. 🟠

## 7. Org & supplier
- [ ] **Organization/team** — Agency/Enterprise owner → view team, roles. Must not: cross-org leak. 🟠
- [ ] **Supplier quote + contract** — Supplier → submit a quote (client sees an administered offer, not raw price) → sign supplier contract. Must not: raw price leaked. 🔴

## 8. Legal & deletion
- [ ] **Legal viewer** — any role → Profile/Settings → open Terms, Privacy, your role agreement → they render; Supplier sees a Supplier Agreement. Must not: blank / wrong version. 🟠
- [ ] **Account deletion (safe test)** — use a THROWAWAY test account → `/account/delete` → sign in → type DELETE → confirm → you're signed out and can't log back in. Must not: it deletes when you have an open job/wallet balance (it should block with a clear reason). 🔴 (do NOT delete your real accounts)

## 9. Robustness
- [ ] **Refresh & back button** — mid-flow, refresh and press back → no crash, state sane. 🟠
- [ ] **Mobile-browser width** — resize to phone width (or use your phone browser) → layout readable, nothing clipped. 🟠
- [ ] **Loading states** — slow pages show a spinner/skeleton, not blank. 🟡
- [ ] **Empty states** — a brand-new account shows friendly empty states, not errors. 🟡
- [ ] **Error states** — force an error (e.g., open a bad URL) → friendly message, not a raw crash. 🟠
- [ ] **Broken links / 404** — visit a made-up URL → a proper 404 page. 🟡
- [ ] **Accessibility basics** — Tab through a form → focus is visible and ordered; text has decent contrast. 🟡
- [ ] **Console errors** — with DevTools open, repeat a few flows → no red console errors. Must not: uncaught exceptions. 🟠

---

## Bug Report Template (copy, fill, send back)
```
Title:
Web or mobile:
Role used:
Page / route:
Steps to reproduce:
  1.
  2.
  3.
Expected result:
Actual result:
Screenshot/video:
Device / browser:
Severity: BLOCKER / IMPORTANT / MINOR
```
