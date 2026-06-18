# NEXPEC 1.0 Launch Roadmap — Web · Google Play · App Store

Brutally honest assessment as of 2026-06-17. The platform is technically strong:
the money perimeter is hardened (pgTAP 70/70 + staging E2E gate), RLS is swept,
Stripe inbound webhooks are hardened, the web build type-checks clean, and the
mobile app already has Sign in with Apple, in-app account deletion, and iOS
permission strings. `service_role` is server-only (no client leak found).

So 1.0 is **not** a "build everything" problem. The gap to launch is a focused
set of items, and the riskiest ones are **legal/financial and store-process,
not code**. Don't let the engineering polish create false confidence: you can
have a flawless app and still be rejected by Apple or exposed by a payments
regulator.

Effort tags: **S** ≤1 day · **M** a few days · **L** 1–2 weeks · **XL** needs
an outside party (lawyer/accountant/Apple review cycle), elapsed time you don't
fully control.

---

## The five brutal truths

1. **You are moving other people's money manually. That is the single biggest
   launch risk, and it is legal, not technical.** Clients pay your live Stripe;
   you hold the balance in an internal ledger; you manually wire payouts and
   click "Mark Paid." Operating a custodial balance + payouts between third
   parties can be regulated as **money transmission / money services business**
   in several jurisdictions. This needs a lawyer's sign-off before you take real
   client money at scale. (XL)
2. **Apple/Google approval is a process with its own clock.** Even with a
   perfect build you should budget 1–3 review cycles. Start the developer
   accounts and a TestFlight/Internal-testing build now, in parallel with
   everything else.
3. **"Mark Paid" with no reconciliation is an accounting time-bomb.** A manual
   payout flow with no daily ledger-vs-Stripe reconciliation will silently
   drift, and you won't notice until someone's balance is wrong. You need a
   reconciliation report before real volume.
4. **You just made audit logs + seals mutable by admin.** That was your call,
   but it removes the "tamper-evident" defense in any dispute or compliance
   review. If you ever need that defense, add an append-only mirror before 1.0.
5. **Tax + payouts.** Paying inspectors/suppliers means tax reporting (1099-NEC
   in the US / T4A in Canada), W-9/W-8 or equivalent collection, and banking
   details capture. None of that is in the app today.

---

## P0 — Launch blockers (cannot ship without these)

### Legal & financial (mostly XL — start immediately, they gate everything)
- [ ] **Money-transmission / MSB legal review** of the custodial-ledger +
      manual-payout model. Get written guidance on whether you can hold balances
      and pay out, in which regions, and under what license/partner. This may
      push you toward Stripe Connect (managed payouts) later, but for 1.0 confirm
      the manual model is lawful for your launch geography. (XL)
- [ ] **Terms of Service, Privacy Policy, Acceptable Use, Refund/Dispute policy**
      — published, linked in app + web + store listings. Privacy Policy URL is a
      hard requirement for both stores. (M + lawyer)
- [ ] **Payout tax + onboarding**: collect payee tax forms (W-9/W-8/equivalent)
      and banking details; define year-end reporting. Today payouts have no tax
      capture. (L)
- [ ] **Chargeback / dispute handling runbook** for inbound Stripe payments —
      who responds, within Stripe's deadline, with what evidence. (S, but real)
- [ ] **Stripe account hardening**: business verification complete, live keys in
      server env only (confirmed not in client), webhook signing secret rotated
      for prod, radar/fraud rules on. (S)

### Payments correctness (M–L)
- [ ] **Daily reconciliation report**: internal ledger (wallets + supplier_earnings
      + withdrawal_requests) vs Stripe balance/transactions. Flag any drift. Build
      as an admin page or scheduled job. (M)
- [ ] **Run the staging E2E money gate against a Stripe test-mode end-to-end**
      (inbound payment → ledger credit → request_withdrawal → Mark Paid), not just
      the DB RPC chain. (M)
- [ ] **Refund path**: a real way to refund a client via Stripe + reverse the
      ledger entry. Confirm this exists or build it. (M)

### Mobile build & store submission (M, plus XL review clocks)
- [ ] **Mobile typecheck green + un-gate CI.** CI currently runs mobile tsc as
      `continue-on-error` (known pre-existing errors). Burn those down and make it
      blocking before cutting a store binary. (L)
- [ ] **EAS production builds + signing**: iOS distribution cert/provisioning,
      Android keystore / Play App Signing, correct bundle IDs, version/build
      numbers. (M)
- [ ] **Verify Sign in with Apple is NATIVE on iOS.** It exists, but via Supabase
      web-OAuth redirect; Apple generally requires the native ASAuthorization flow
      for the iOS app. Swap to `expo-apple-authentication` (the code comment
      already notes this TODO). (M)
- [ ] **Verify account deletion actually deletes server-side.** The UI exists
      (`app/profile/security.tsx`); confirm it calls a real deletion RPC/edge
      function that removes auth user + PII, not just a client alert. Both stores
      require functional deletion. (S–M)
- [ ] **Store compliance forms**: Apple Privacy Nutrition labels + App Privacy;
      Google Play Data Safety form; content rating; ATT prompt if you track;
      background-location justification + demo video IF you use it (you only
      declare WhenInUse today — keep it that way unless truly needed). (M)
- [ ] **Demo/review account** with full functionality for Apple/Google reviewers,
      plus reviewer notes explaining the brokered/manual flows. (S)

### Web production (S–M)
- [ ] Confirm production env separation (no service_role exposed; no `NEXT_PUBLIC_`
      secret leakage), custom domain + SSL, security headers. (S)
- [ ] Final `npm run typecheck -w @nexpec/web` + `next build` + `next lint` green
      on the release commit. (S)

---

## P1 — Should fix before real users (not strictly blocking, but you'll regret skipping)

- [ ] **Mobile admin routing (god-mode Phase D)** — admin dashboards/route guards
      that still exclude `admin`. The DB surface is sealed; the mobile UI isn't. (M)
- [ ] **`inspection_items` RLS bug** — RLS on, zero base policies, yet read
      client-side (`seal-report.tsx`) → returns no rows for normal users. Add a
      correct owner/participant policy. (S)
- [ ] **Append-only audit mirror** (if you want dispute defensibility back after
      the god-mode override). (M)
- [ ] **Observability**: confirm Sentry on web + backend (mobile already has it),
      alerting on payment/auth/RPC errors, and a health dashboard. (M)
- [ ] **Supabase production plan**: PITR/backups on, connection pooling sized,
      RLS on every new table (the CI guard now enforces admin coverage). (S)
- [ ] **Rate limiting / abuse protection** on auth + sensitive RPCs. (M)
- [ ] **Cross-platform parity sweep** for all 6 roles' core journeys (the v2
      north-star) — at minimum the critical paths: sign-up → job → report →
      pay-in → payout. (L)
- [ ] **Push notification consent + delivery** verified end to end on real
      devices (APNs prod cert, FCM). (M)

## P2 — Polish / GTM (post-soft-launch is fine)

- [ ] Store listings: icon, screenshots per device class, descriptions, keywords. (M)
- [ ] Onboarding/empty/error/offline states audit. (M)
- [ ] Accessibility + i18n completeness pass. (M)
- [ ] Marketing site + support channel + status page. (M)

---

## Critical path (what to start in what order)

1. **Today, in parallel (longest clocks first):**
   (a) engage a fintech/payments lawyer on the MSB question + ToS/Privacy;
   (b) create Apple Developer + Google Play accounts and push a first
   TestFlight/Internal build (even rough) to start the review relationship;
   (c) start mobile tsc burndown.
2. **Week 1–2:** reconciliation report + refund path + Stripe test-mode E2E;
   native Apple auth; verify server-side account deletion; store compliance forms.
3. **Week 2–3:** mobile CI green + signed production builds; web prod hardening;
   P1 security (admin routing, inspection_items, rate limiting).
4. **Soft launch:** web first (fastest to ship, no store gate), then a closed
   mobile beta (TestFlight / Play Internal) with a handful of real deals run
   end to end through the live Stripe + manual payout flow, watching the
   reconciliation report daily.
5. **Public 1.0:** submit to both stores once beta is clean and legal sign-off
   is in hand.

## Honest bottom line

The engineering risk is largely retired. The launch is now gated by **legal/financial
clearance on the manual money model** and **the store-submission clock** — both
of which involve parties outside your control, so start them first. Everything
else on this list is a few weeks of focused work you already know how to do.
