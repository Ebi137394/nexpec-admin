# NEXPEC — Owner Final Report (Finance / Stripe release work → rendered review)

Date: 2026-08-22 · Branch `release/identity-replacement` · HEAD `b398df0` (pushed, clean)
Gate status: **STOPPED at the Owner Gate. Nothing submitted, no screenshot lock, no final GO.**

---

## A. Product changes

**Finance (buyer side — Client / Agency / Enterprise)**
- New settlement dashboard on web (`SettlementSummary`) and mobile (`SettlementDashboard`):
  four cards (Contract value / Paid / Awaiting confirmation / Outstanding), an overall
  **Settlement progress** bar with % paid and color legend (green paid, blue confirming,
  amber outstanding), per-job stacked mini-bars, per-job status chips
  (Payment required / Awaiting confirmation / **Partially paid** / Paid / Not priced),
  and **Payment history** (method · reference · date · amount) from the settlement ledger.
- Posture copy everywhere: "NEXPEC settles by bank transfer / invoice…"; payment methods
  card shows **Manual payment — AVAILABLE NOW** and **Online card payment — COMING SOON**
  (the one owner-approved coming-soon: it is honest, nothing is hidden behind it).
- Mobile finance tab is role-aware (Payments & Funding / Wallet & Earnings / Earnings &
  Payouts headers); buyers no longer see the duplicate legacy "Recent Transactions" wallet
  feed (it stays for providers); buyer "Deposit" CTA and Payment Methods hidden while the
  online-payments flag is off.

**Manual buyer settlement (first-class flow)**
Payment required → (admin records, optionally `pending`) → Awaiting confirmation →
Partially paid / Paid. Partial payments are supported and rendered (proved live: $400 of
$1,000 → "Partially paid", 2% overall progress).

**Manual provider payout**
Inspector/Supplier see Earned / Paid / Due per job plus payout history and a
payout_status chip (due / payout_scheduled / part_paid / paid / in_progress). Proved live:
an $800 recorded payout flipped the job to part_paid with last-payout date.

**Admin controls**
`Record a manual payment` form on Admin → Payouts: Job UUID, Direction (Buyer payment
received / Provider payout sent), Amount, Method (bank/wire/cheque/cash/other), Payment
date, Reference, Internal note, Status (Settled / Pending confirmation / Recorded).
Server action → `admin_record_manual_payment` RPC. Every entry lands in
`manual_payment_records` with `recorded_by` + `recorded_at` (audit).
Legacy "Mark as paid" payout queue retained (reference audit-captured verbatim).

**SSO / Enterprise sign-in — restored**
Commit `5bbaa05` (2026-08-20, before this release session) had replaced the pressable
🔐 SSO and 🏢 Enterprise buttons with inert "Coming soon" chips. Restored to live buttons
wired to the original flow: email → `lookup_sso_for_email` (reads `enterprise_domains`) →
`signInWithSSO({domain})` → browser handoff; unregistered domains get an honest alert, no
dead end. `qa:payments` §5 now **fails** if these are ever demoted again.
Status honesty: Production currently has **zero** SSO registrations
(`auth.sso_providers`=0, `org_sso_connections`=0, `org_sso_domains`=0,
`org_scim_tokens`=0). The feature is real and sound but **unprovisioned** — enabling a
customer IdP is config, not code. Web sign-in never had SSO buttons (pre-existing gap,
not cleanup damage — your call whether web gains them this cycle).

**Other regressions found & fixed during the rendered review (all web)**
1. **Admin payouts/disputes actions crashed at request time** — `'use server'` files
   exported initial-state constants; Next.js rejects non-function exports, so recording a
   payment threw and the page fell into its error boundary. States moved to
   `lib/actions/actionStates.ts`. (Found by actually submitting the form.)
2. **Inspector "Earnings by job" never rendered** — the component had been mounted inside
   the `Banner` *helper component* instead of the page body. Re-mounted in the main flow;
   verified rendering with real rows.
3. **Stale Stripe Connect copy on Admin payouts** ("Stripe + manual", "Stripe Connect
   transfer", `tr_…` placeholder) contradicted the manual-only architecture — reworded to
   bank-reference language.
4. **Finance breadcrumb said "Client Portal" for Agency/Enterprise viewers** — now
   role-aware via shared `portalLabelForRole` (sidebar + page can't drift).

**Store-build toolchain defect found & fixed**
iOS store build 8 (`c59b97a1`) **ERRORED** on EAS: the current `image: "latest"` is
Xcode 26.4/26.5 (Apple Clang 21), which rejects the fmt 11.0.2 library RN 0.76 pins
(consteval strictness; upstream fixed only on RN ≥ 0.83.9). Fix committed (`4a841ee`):
the fmt pod compiles as C++17 inside the existing `withNexpecNitroBuild` Podfile plugin —
no version bump, no behaviour change, cannot be clobbered by the C++20 pin. **Not yet
proven on EAS** — launching a production-profile build was blocked by the environment's
permission layer and is in any case the first post-approval step (it becomes store
build 9 from the corrected HEAD).

## B. Finance architecture

- **Table** `manual_payment_records`: job_id, direction (`client_payment` |
  `inspector_payout`), amount_cents, currency, paid_on, method (`bank_transfer` | `wire` |
  `cheque` | `cash` | `other`), reference, notes, status (`pending` | `recorded` |
  `paid_manually`), recorded_by, recorded_at.
- **Write authority**: user INSERT/UPDATE/DELETE revoked; the **only** write path is
  `admin_record_manual_payment(p_job_id, p_direction, p_amount_cents, p_method, p_paid_on,
  p_reference, p_notes, p_status)` (admin-gated, audited). Nobody can mark their own
  payment received (F15/F16 prove it).
- **Read model** (owner-rights views, `security_barrier=true`, explicit predicates —
  required because the anon-grant lockdown removed user-level SELECT on jobs):
  - `my_job_settlement_view` — buyer: total/paid/pending/outstanding_cents +
    settlement_status (not_priced|payment_required|part_paid|awaiting_confirmation|paid).
  - `my_earnings_view` — provider: earned/paid/pending/due_cents + payout_status.
  - `my_settlement_activity` — per-party ledger rows (buyer sees only client_payment,
    provider only inspector_payout).
- **RLS party-read policy** on the table mirrors the same boundary
  (buyer ↔ `nx_job_buyer_principal(job_id)`, provider ↔ `jobs.contractor_id`).
- **Privacy (GOLDEN_RULE_2)**: direction is the boundary — buyers never see payouts or
  margins; providers never see buyer pricing or spread. F6/F12 prove the other side's
  columns are absent from each view; `qa:client-privacy` guards the UI surface.
- **Partial payments**: N ledger rows per job; views SUM FILTER by status; part-paid
  states surface on both sides.
- **Audit**: recorded_by/recorded_at on every row + admin audit_events for disabled
  Stripe endpoints (NX-STRIPE-004/005).

## C. Rendered UI (verified by driving the real product)

| Role | Finance shown | Available actions | What changed | Verdict |
|---|---|---|---|---|
| Client (web, staging) | 4 cards · progress bar 2% paid · open settlements with per-job bars & chips · payment history (method/ref/date) · funding rail · YTD stats · net-terms · invoices | Post/fund jobs, approve reports, apply for trade credit; **no card/Stripe CTA** | Settlement dashboard + progress visuals + history; posture copy | ✅ verified live |
| Agency (web) | Same buyer dashboard scoped to its own jobs ($6,000 contract value, own settlements) | Same as client + roster/Team Missions | Role-aware "Agency Portal" branding incl. finance eyebrow | ✅ verified live |
| Enterprise (web) | Same buyer dashboard, honest $0 empty states | Same as client + org features | "Enterprise Portal, Finance" eyebrow (was "Client") | ✅ verified live |
| Inspector (web) | Wallet: legacy cleared-funds cards + **Earnings by job** (Earned/Paid/Due per job, Paid $800 · part_paid chip, totals row) | Request payout when funds clear; no Connect | Earnings section actually renders now (was mounted in wrong component) | ✅ verified live |
| Supplier (web) | Finance: Contracted value $12,000 · Settled to you · Outstanding (brokered) · In-bid pipeline · "Admin-brokered settlement" explainer · Withdrawable balance with **Manual payouts** badge | Bid on RFQs, contracts, docs; no self-service balance | — | ✅ verified live |
| Admin (web) | Payouts: **Record a manual payment** form + reconciliation queue + treasury | Record buyer payment / provider payout (partial or full, 5 methods, 3 statuses); mark-as-paid queue | use-server crash fixed; stale Connect copy reworded | ✅ verified live (both directions recorded) |
| iOS (simulator) | — | — | — | build in progress; section updated when the pass completes |

**The proof loop the owner asked for**: as admin, recorded $400 partial buyer payment
(WIRE-NXREV-0821-01) and $800 provider payout (BACS-NXREV-0821-02) through the real form →
client Finance moved to Paid $400 / Outstanding $19,400 / 2% paid / "Partially paid" chip /
history row; inspector wallet moved to Paid $800 / Due reduced / "Partially paid" on the
same job. Ledger rows carry recorded_by = the admin, timestamps, method, reference, note.

## D. Security / testing

- pgTAP battery: **83/83 suites, 1,360 assertions, 0 failures** (canonical runner,
  plan==ran, anti-vacuous). No SQL has changed since that run — the only changes since are
  TSX/JS UI and a Podfile plugin — so the result stands; battery not re-run per your
  "affected qualification only" instruction.
- `qa:payments` (12 checks incl. SSO-live guard), `qa:payment-dead-ends`,
  `qa:client-privacy` — **all green, re-run after every fix above**.
- Typechecks: mobile `tsc` clean; web `tsc` clean (re-run after each fix).
- Role boundaries re-proven in the rendered pass: middleware portal gates enforced
  per-role (client/agency/enterprise → buyer portal with role branding; inspector;
  supplier; admin console); `my_earnings_view` queried as the inspector returns only
  their jobs.
- Defects discovered during this work: the 4 web defects in §A (all fixed, committed);
  staging data debt — 11 orphan org-member profiles without auth users ("Database error
  loading user"), staging-only, listed in §H.

## E. Stripe

- **LIVE config preserved**: pk_live in EAS/Vercel env; STRIPE_SECRET_KEY +
  STRIPE_PAYMENTS_WEBHOOK_SECRET set as Supabase secrets (owner-run script, never echoed);
  6 payment functions deployed 2026-08-21 17:40Z; live webhook created. Nothing deleted,
  nothing reverted to test.
- **Disabled for users**: `platform_settings.online_payments_enabled=false` (Production);
  every intent-creating function guards via `assertOnlinePaymentsEnabled()` → 403
  `ONLINE_PAYMENTS_DISABLED` before any provider call; payout family (process-payout,
  create-stripe-payout, create-supplier-payout) hard-refuses and audit-logs
  (NX-STRIPE-004); create-stripe-connect-link refuses with CONNECT_DISABLED
  (NX-STRIPE-005). **No Connect, no auto-payouts, ever** (architecture decision, not just
  the pause).
- **Rendered posture verified**: no TEST MODE, no PaymentSheet, no Deposit/Add-Card dead
  ends, no 403s reaching users, no review-status language, no misleading card capability.
  The only card mention is the honest "Online card payment — COMING SOON".
- **Release works without Stripe**: full lifecycle proven on live Production (10-step
  rolled-back probe) + the manual settlement loop proven rendered (above).
- **Later activation**: verify Stripe account restored → smoke a $1 LIVE intent →
  confirm webhook delivery → flip `online_payments_enabled=true`. UI is flag-driven; no
  rebuild required for mobile/web surfaces (they read the flag at runtime).

## F. Deployment / build state

- **Staging** (zmzvmgaeovleuvbvwxei): migrations current (incl. settlement backbone);
  used for the rendered role review; QA accounts refreshed; temp `qa.reviewadmin`
  created for this review (remove after — listed in §H).
- **Production** (sxqpjxhslzzcdrdctatm): 235 migrations, parity verified; flag OFF;
  reviewer job hidden via audited RPC and accessible to the reviewer account
  (`apple_tester@nexpec.com` — verified signing in live today).
- **Web**: Vercel production (`nexpec-main-platform`) runs the **pre-correction** build.
  The corrected build (settlement visuals + 4 fixes) is committed and typechecked but
  **not deployed** — held at your gate. Deploy is one action post-approval.
- **iOS**: store b7 = stale toolchain (DTXcode 16.2 — below Apple's 2026 floor);
  b8 = ERRORED (fmt/Clang 21, root-caused, fix committed); **build 9 from corrected HEAD
  is the post-approval step**. Local simulator build of the corrected UI: in progress
  under launchd at the time of writing (three prior attempts were killed by session
  restarts; current one is restart-proof).
- **Android**: v13 AAB verified from binary (targetSdk 35, prod refs, no service-role
  JWT, settlement view present, signed) — but it predates the SSO restore + Finance
  visual pass, so a **v14 from the corrected HEAD** is required post-approval for parity.
- **HEAD `b398df0`**, pushed to origin, working tree clean.
  Correction commits: `2b6dfd8` (SSO + finance visuals) → `4a841ee` (fmt fix) →
  `768d196` (rendered-review fixes) → `b398df0` (portal eyebrow).

## G. Store state

Prepared (in `NEXPEC-Store-Submission-Ready/`): ASC + Play console field-by-field
answers, privacy questionnaires, review notes with demo account, rejection-risk audit,
QA matrix, framed 6.9" phone screenshot set + captions, iPad first capture, verified
v13 AAB, verify/package scripts, owner-only action list.
**Not finalized**: final screenshots (current set predates the corrected UI — recapture
after your approval), iOS build 9 + Android v14 from corrected HEAD, MANIFEST sha256s for
those, iPad set completion, uploads, submissions. **Play 16 KB alignment** remains the
one open store risk (31/40 libs 4 KB-aligned; Expo SDK 52 prebuilts; pre-launch report
will give the definitive answer; SDK 53 upgrade is the fix if blocked).

## H. Remaining issues (complete list)

1. iOS build 9 unproven on the new toolchain until one EAS build runs (fmt fix is
   committed and syntax-validated; launching the build is gated).
2. Android v14 + fresh screenshots needed post-approval (current artifacts predate the
   corrected UI).
3. Play 16 KB ELF alignment risk (documented; decision comes from the pre-launch report).
4. Web production still on pre-correction build (deploy post-approval).
5. Web sign-in has no SSO/Enterprise buttons (pre-existing; decide add now or later).
6. `ClientProfileView.tsx:313` "Settings panel coming soon" alert — pre-existing stub,
   predates release work; decide: implement, or leave (it is reachable from the client
   profile screen).
7. Staging data debt: 11 orphan `qa.*` profiles without auth users; several stale
   tmpadmin accounts (role client, harmless); remove `qa.reviewadmin@nexpec.test`
   (temporary, created for this review).
8. Admin payouts "Payouts Reconciliation" legacy queue coexists with the new manual
   form — functional, but consider merging into one settlement surface next cycle.
9. Next dev warning: one form passes encType/method with a function action (harmless,
   dev-only console noise).
10. Production has only a CLIENT demo account (`apple_tester@nexpec.com`). Creating an
    inspector demo for provider-side review was blocked by the session's permission
    layer (Production account creation) — owner decision: create
    `inspector_tester@nexpec.com` yourself, or approve me doing it post-gate. The
    provider-side money flow is fully proven rendered on staging web regardless; the
    hidden reviewer job also carries no contractor/pricing, so attaching demo provider
    data properly (via the real dispatch flow, not raw writes) is a small post-approval
    task if reviewers should see the provider side.

---

## FINAL STATUS — owner approved, release finished to the console door

The owner reviewed the rendered iOS Finance screen and said
"OWNER UI APPROVED — CONTINUE RELEASE" (2026-08-22). After approval the iOS
rendered pass completed on the final build (sign-in with live SSO/Enterprise,
honest SSO copy verified, Finance settlement dashboard, jobs/docs/tools/profile
sweeps, no dead ends), final screenshots were captured natively from the
running simulator (phone 1320×2868 + iPad 2064×2752), web production was
deployed, and iOS build 9 + Android versionCode 14 were built from HEAD
02d5e62 and verified from their binaries. See ../01-Release-Artifacts/MANIFEST.txt
and ../06-Owner-Only-Actions/OWNER-ACTIONS.md for what remains (console
uploads only).
