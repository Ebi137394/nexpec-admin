# NEXPEC — Release QA SOP & Store Review Playbook

*Fast-execution checklist for launch day. Companion to `LAUNCH_PLAYBOOK.md` and `docs/MASTER_RELEASE_RUNBOOK.md`. Written 2026-07-18 against commit `f1e14d6` + the terminology-sweep working tree.*

---

## Part 1 — Core Flows: Fast Manual QA (run before every build)

### 1.0 Automated gate battery (5 min, non-negotiable)

```bash
cd ~/Desktop/nexpec \
  && (cd apps/web && npm run typecheck && npm run lint) \
  && npx tsc --noEmit \
  && npm run qa:outbox && npm run qa:gr2 && npm run qa:rls-admin && npm run qa:db-refs
```

All seven must exit 0. **Status 2026-07-18: all green.** Any red = stop, no build.

### 1.1 AI capture → offline outbox → sync (the flagship loop, ~8 min, real device)

| # | Step | Pass criteria |
|---|---|---|
| 1 | Sign in as inspector, open an active job, start capture | Camera permission prompt shows the NEXPEC usage string; camera opens |
| 2 | Capture a photo of corroded metal (or the test target) | Segmentation overlay renders on-device; no network spinner (inference is local) |
| 3 | **Enable Airplane Mode**, capture 2 more photos + save a flash report | Saves succeed instantly; outbox badge/queue increments; zero error toasts |
| 4 | Kill the app, relaunch still offline | Queued items persist (SQLite); screens show cached data, not blank/error states |
| 5 | Disable Airplane Mode | Outbox drains automatically; queue → 0; photos appear in the job's evidence on web within ~1 min |
| 6 | Verify one uploaded photo on web admin | File is non-zero size and renders (guards the 0-byte `fetch().blob()` regression class) |
| 7 | Check the evidence seal | Report/pack shows signed status; verifier passes (Provable-AI loop) |

Sync-conflict spot check: edit the same record on web while mobile is offline, then reconnect — mobile should surface a conflict state, not silently clobber (offline-sync hardening #56).

### 1.2 Money flow, Stripe test mode (~10 min, two browsers + device)

Golden path: **post → approve → bid → counter → contract → fund (payment hold) → report → admin confirm → client approve → payout request → admin Mark-as-Paid.**

| # | Step | Pass criteria |
|---|---|---|
| 1 | Client posts a job with budget | Job goes to admin review, not public |
| 2 | Admin approves | Job auto-publishes to `open` (DB invariant, migration 268000) |
| 3 | Inspector bids; admin counters; inspector accepts | Whole-USD validation copy; negotiation loop closes |
| 4 | Client signs contract + funds | Stripe test card `4242…` succeeds; payment-hold state visible to client |
| 5 | **Price-blindness check (Golden Rule 2)** | Inspector sees ONLY payout; client sees ONLY their price; no spread/margin anywhere in either UI or network tab |
| 6 | Inspector submits report | Report goes to admin, NOT client (`admin_confirmed_at` gate) |
| 7 | Admin confirms → client approves → inspector requests payout | Admin payout board shows request; Mark-as-Paid completes it (payouts are 100% manual — no auto-Stripe transfer should fire) |
| 8 | Dispute branch (1 min) | Client files dispute → payout release pauses; admin sees it; wording says "payout release paused" |
| 9 | Webhook health | Stripe CLI/test event hits `stripe-payments-webhook` → 200; event lands in the webhook ledger exactly once (idempotency) |

### 1.3 RBAC / portal isolation (~5 min)

- Six roles: admin, client, agency, enterprise, inspector, supplier. Log into each (or at minimum inspector + client + admin) and confirm: correct dashboard, no cross-portal URL access (paste `/admin/...` as inspector → redirect), `admin` == `super_admin` everywhere (god-mode rule).
- Chat silos: client↔admin and inspector↔admin rooms only; verify a client can never open a thread with an inspector directly and identity stays pseudonymous (NX-handle) pre-reveal.
- Public surfaces (`/p/[id]`, `/talent`, `/agency`, `/discover`): zero PII in page AND network responses.

### 1.4 Auth surface (~4 min, real device)

Email sign-in ▸ Apple ▸ Google ▸ LinkedIn OIDC — each must round-trip through `nexpec://oauth-callback` and land signed-in (PKCE). Password reset e2e. Biometric re-login. **Account deletion visible and working** (Profile → Security → delete/anonymize) — this is a hard store requirement, see 2.2/2.3.

---

## Part 2 — App Store & Google Play: What Reviewers Will Actually Probe

### 2.1 Apple — payments (Guideline 3.1.1 vs 3.1.5(a)) — YOUR #1 TOPIC

- **You are safe using Stripe** for the core marketplace: inspection jobs are **real-world services consumed outside the app**. Guideline 3.1.5(a) explicitly permits purchase methods other than IAP for physical goods and services. Uber/Fiverr/TaskRabbit precedent. No IAP needed for job funding or payouts.
- **The one genuine 3.1.1 trap in your product: the Named-Disclosure identity-unlock fee.** That is arguably a *digital* unlock (paying to reveal information inside the platform). You already built it **web-only, by design** — keep it that way. Before submitting, verify the iOS binary contains **no button, banner, or link that steers the user to the web to pay that fee** ("go to nexpec.com to unlock") — steering language is what triggers 3.1.1/3.1.3 rejections, not the feature existing on web. If mobile mentions it at all, it may only describe the state ("identity is revealed after engagement confirmation"), never route to payment.
- Wallet top-ups: fine under 3.1.5(a) as long as balance is only spendable on real-world services. Never present wallet credit as usable for any digital feature.

### 2.2 Apple — the rest of the rejection surface, ranked by likelihood

| Guideline | Trap | Your status / action |
|---|---|---|
| 2.1 Completeness | Crash, blank screen, or a demo account that hits empty/broken states | TestFlight smoke on a real device FIRST. `apple_tester@nexpec.com` must be pre-seeded (run `supabase/seed_apple_reviewer.sql`), password in review notes, and every tab it can reach must render non-empty |
| 5.1.1(v) Account deletion | Apps with account creation MUST offer in-app account deletion — reviewers check this every time now | Implemented (delete-account edge fn + Security screen). Verify the button is reachable in ≤3 taps and actually completes |
| 4.8 Sign in with Apple | Third-party login without Apple login | Satisfied — Apple offered alongside Google/LinkedIn. Verify it works on the review build, not just dev |
| 5.1.1 Permissions | Purpose strings missing/generic, or requesting at launch instead of in context | Strings are specific and trimmed (NX-PERM sweep). Ensure no permission prompt fires before the user does something that needs it |
| 1.2 UGC | Chat + photo upload = UGC. Reviewers look for report/flag + block + moderation | Your structural story is strong (all rooms are admin-brokered and monitored; no open user↔user contact). Put that sentence in the review notes; if there's no in-chat "report message" affordance, the admin-in-every-room model is your compensating control — state it explicitly |
| App Privacy labels | Labels contradicting observed traffic (Sentry!) | Declare: contact info, user content (photos/docs), identifiers, crash/usage data (Sentry). All "linked to user", none "tracking" → no ATT prompt |
| 2.3 Metadata | Screenshots showing states the reviewer can't reach, or mentioning Android/beta | Screenshot only what the demo account can reproduce |
| 3.1.1 (redux) | "Escrow"/financial wording implying you're a money transmitter | See Part 3 — user-facing copy now says "payment hold", legal says Stripe is the licensed handler. Review notes: "Payments processed by Stripe; NEXPEC is not an MSB" |

**Review notes to paste:** demo credentials; "two-sided industrial inspection marketplace; payments are for real-world professional services via Stripe (3.1.5(a)); all chat rooms include platform staff (moderation by construction); reviewer account is pre-seeded with jobs, chats, and a fundable test contract on Stripe test rails."

### 2.3 Google Play — different failure modes

- **Data safety form** must mirror reality (same answers as Apple's labels + Sentry crash data). Mismatches are the top Play rejection.
- **Account deletion**: Play additionally requires a **web URL** where users can request deletion without reinstalling the app. Have `https://<domain>/account/delete` (or support page) live before submitting the form.
- **App access**: provide the same reviewer credentials — Google does log in.
- **Permissions**: you request no background location and no SMS/call-log — keeps you out of every sensitive-permission review queue. `RECEIVE_BOOT_COMPLETED` + `WAKE_LOCK` are unremarkable.
- **Pre-launch report** (automatic robo-crawl on real devices) will flag crashes and blank screens across ~10 devices — check it in Play Console before promoting past internal testing.
- **Target audience 18+**, ads = none, "News" = no.
- Rollout: internal → production at **20% staged**, watch ANR/crash vitals 24–48h, then 50% → 100%. First-ever review can take 1–3 days — submit the moment the .aab is up.

---

## Part 3 — The "Escrow" Identifier Question: Definitive Answer

**Question:** are internal identifiers like `heldInEscrowCents`, `escrow_status`, `EscrowPanel`, `case 'escrow'` a store-review or regulatory risk if left unrenamed?

**Answer: No. Renaming them would be pure risk with zero benefit. Here is the precise reasoning:**

1. **App Review never sees source code.** Apple and Google review the compiled binary's *behavior* and *metadata*: screens, flows, permission prompts, store listing, privacy forms. They do not decompile Hermes bytecode or read minified JS, and no review guideline on either store concerns itself with internal symbol names. There is no mechanism in the review process by which `heldInEscrowCents` reaches a reviewer's eyes.
2. **Regulators evaluate representations and money flows, not variable names.** Money-transmitter exposure is determined by (a) what you tell users (UI copy, Terms, marketing), and (b) who actually holds the funds (Stripe, a licensed processor — stated in your Terms). A JSON key travelling over TLS between your own app and your own database has no legal significance. Your Terms explicitly say NEXPEC is not a bank/MSB and Stripe handles processing — that is the document that matters.
3. **The only real risk was user-facing copy — and it is now closed.** As of today's sweep: every client, inspector, and public/SEO surface says "payment hold"; the signed legal texts use their defined term ("payout hold", PAYOUT-001); zero user-visible "escrow" remains outside your own admin console (visible only to you, invisible to reviewers using demo accounts).
4. **Renaming DB columns/identifiers the night before launch is the actual danger** — schema migrations, RPC signatures, RLS policies, and 200+ call sites for cosmetic benefit nobody can observe. (Today's audit caught exactly this failure mode: the sweep had renamed `case 'escrow'` in `app/(admin)/financial.tsx` and silently broke transaction icons. Reverted.)

**Confidence: as absolute as engineering honesty allows — this is a non-issue.** The caveat is not a hedge on the identifiers; it's a pointer to the one adjacent thing that *does* matter: keep future UI copy, store metadata, and marketing aligned with "payment hold / Stripe processes payments," and never let an internal term leak back into a user-facing string. The `qa:gr2`-style greps in the gate battery are your tripwire.

---

## Part 4 — Launch-Day Order of Operations (compressed)

1. Gate battery (Part 1.0) → green
2. Commit the working tree (terminology sweep + fixes) → push → Vercel deploys web
3. Console prep per `LAUNCH_PLAYBOOK.md` Part 0 (OAuth redirect URIs, provider keys, edge-fn secrets, reviewer account, **eas.json submit credentials — still placeholders as of today**, EAS production env vars — the white-screen guard)
4. Edge functions deploy → `eas build -p ios` + `-p android` → TestFlight/internal smoke (Parts 1.1–1.4 on the release build)
5. Submit both stores
6. **`supabase db push` LAST** (through `20260801276000`), then runbook post-push verification queries
7. Monitor: Sentry (mobile + web), Stripe webhook dashboard, Play vitals, App Store review thread

*Rollback: OTA `eas update --channel production` for JS-only fixes; runbook §Rollback for anything native or DB.*
