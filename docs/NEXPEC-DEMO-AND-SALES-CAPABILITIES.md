# NEXPEC — Demonstration and Sales Capabilities

**Compiled at `cd81e43`.** Every claim below is backed by a route, an RPC or a passing
test. The last section lists, explicitly, the things you must **not** claim.

---

## What NEXPEC is

A **brokered third-party inspection marketplace**. Buyers raise inspection requirements;
NEXPEC's Admin brokers the engagement; qualified inspectors execute against a structured
plan; evidence and non-conformances are captured on site; reports pass a senior review; and
the Admin delivers the final signed report to the Client.

Three things distinguish it structurally, and each is enforced by the database rather than
by policy or UI:

1. **The broker sits in the middle by construction.** There is no direct Client↔Inspector
   channel and no way to self-assign. An inspector cannot attach themselves to a job.
2. **Commercial privacy is enforced at the column level.** The Inspector cannot read the
   client price and the Client cannot read the inspector payout — not because a screen hides
   them, but because `has_column_privilege` returns false.
3. **Money never moves by itself.** There is no automatic payout or settlement path
   anywhere. Every release is an explicit, manual, Admin-initiated action.

---

## Capabilities by role

**Client / Buyer** — raise a requirement; fund 20% to authorize work and 80% before final
delivery; follow visits and evidence; receive the delivered report; raise disputes. Never
sees inspector payout or platform margin.

**Inspector** — discover and apply to jobs; carry a verified credential wallet; execute ITP
points including hold points; capture evidence offline; raise NCRs; submit and resubmit
reports; track earnings and request withdrawal. Never sees client price or spread.

**Senior Inspector** — an assigned-review inbox; approve or return with required comments;
an immutable decision history. Structurally cannot deliver to the Client and cannot review
their own report.

**Admin / Broker** — review and publish requirements; run the matching engine; dispatch
teams; assign senior reviewers; deliver reports; configure funding terms; execute manual
settlement; control identity disclosure; operate SSO/SCIM and ERP connectors.

**Agency** *(mobile-first)* — post and track agency-owned work; review applicants and their
credentials. Commercial columns arrive NULL-masked.

**Supplier** *(web portal)* — onboard; respond to RFQs with quotes; sign contracts; maintain
sealed vendor documents; correspond through Admin-brokered messages only.

**Enterprise** — SAML/OIDC SSO with domain verification; SCIM 2.0 provisioning onto the
existing directory; group→role mapping; a deprovisioning archive; a full audit trail.

**Talent Candidate** — a permanent-placement profile gated behind explicit consent. An
employer sees an identity only after the candidate consents, and withdrawal takes effect
immediately rather than being queued.

---

## Verified differentiators — safe to demonstrate

| Claim | What proves it |
|---|---|
| "An inspector cannot see the client's price" | column privilege; `qa:gr2-inspector` |
| "The platform margin never leaks to either side" | `jobs_secure_view` masks it unless admin |
| "No one can pay themselves" | automatic payout triggers detached; Golden Path asserts settlement leaves the inspector untouched |
| "An inspector cannot approve their own report" | `nx_guard_report_no_self_approval` |
| "A Senior Inspector cannot deliver to the Client" | the control is *absent*; delivery is `nx_admin_deliver_report` |
| "Review history cannot be edited or erased" | append-only + statement-level TRUNCATE guard |
| "A credential can only be verified by someone else" | four-eyes rule — not even an admin verifies their own |
| "Work cannot start unfunded" | `nx_guard_dispatch_requires_funding` refuses dispatch |
| "Evidence survives losing signal" | offline outbox; 54 replay assertions |
| "Deprovisioning is reversible" | SCIM archives membership before removing it |
| "Integration failures are recoverable, not lost" | dead-letter queue + idempotent replay |

---

## Demo sequence (~20 minutes)

**1 · The broker model (3 min).** Client posts a requirement → it sits in
`pending_approval`. Show that no inspector can see it yet. Admin reviews and publishes.
*Point:* nothing reaches the market unbrokered.

**2 · Matching and dispatch (3 min).** Run the matching engine — show a verified credential
scoring 25 points. Dispatch an inspector. Then try to dispatch an unfunded job and let the
database refuse it. *Point:* the funding gate is real, not a UI check.

**3 · Commercial privacy (2 min) — the strongest moment.** Open the same job as Client and
as Inspector side by side. The Client sees their price; the Inspector sees their payout;
neither sees the other's, and neither sees the spread. *Point:* enforced in Postgres.

**4 · Field execution (4 min).** Inspector opens the ITP, records results, hits a hold point
that only the buyer or Admin can release, raises an NCR, captures evidence. Put the phone in
airplane mode and keep working — then reconnect and watch the outbox drain.

**5 · Review and delivery (4 min).** Inspector submits. Admin routes to a Senior Inspector.
Senior returns it with comments (comments are required). Inspector resubmits. Senior
approves. **Show that the Senior has no delivery button.** Admin delivers — but only after
the remaining 80% is funded.

**6 · Manual settlement (2 min).** Show the wallet accrue, and show that no automatic credit
occurred. Admin releases manually. *Point:* money moves only when a human decides.

**7 · Enterprise (2 min).** SSO connection, SCIM token issued once, group→role mapping,
deprovision archive, audit trail.

Optional: Supplier RFQ → quote → contract → sealed document; ERP dead-letter with a redacted
payload and a replay verdict; Talent consent grant and immediate withdrawal.

## Recommended demo data

`npm run qa:seed:roles` creates `qa.agency@`, `qa.supplier@`, `qa.rfqbuyer@nexpec.test`
(password `NexpecQA!2026`). Create Admin/Client/Inspector/Senior via Studio and set
`profiles.role`. Use a job with a client price of $1,500 and a payout of $1,000 — the $500
spread makes the privacy demo legible at a glance.

## What to show which audience

- **Client/Buyer** — the broker model, funding gates, delivery gate, dispute path.
- **Inspector** — credential wallet, offline capture, earnings, price blindness.
- **Agency** — mobile dashboard, applicant credentials. Say plainly it is mobile-first.
- **Supplier** — the web portal end to end; brokered messaging.
- **Enterprise** — SSO/SCIM, audit, org isolation, ERP recoverability.

---

## Claims that must NOT be made

1. **Do not claim live SAP or Oracle integration.** The adapters are fixture and
   contract-tested. No tenant credentials exist. Say "adapter-ready, pending tenant
   credentials."
2. **Do not claim the platform is in production.** It has never been deployed; Production
   has not been migrated.
3. **Do not claim App Store or Play Store availability.** Nothing has been submitted.
4. **Do not claim automatic or instant payouts.** The opposite is the design, and it is a
   selling point — say so.
5. **Do not claim live-mode payment processing.** Stripe is exercised in test mode.
6. **Do not claim SOC 2, ISO or any certification.** None has been audited.
7. **Do not claim push notifications are proven end-to-end.** The pipeline exists; delivery
   to a real handset needs APNs/FCM credentials.
8. **Do not quote uptime, scale or performance numbers.** No load testing has been done.
9. **Do not claim a supplier-facing scorecard screen.** Scorecards are Admin-mediated.
10. **Do not present the AI co-inspector as autonomous.** It is assistive; 43 model
    assertions pass, but a human inspector records every result.

## Known limitations to state plainly if asked

- SAP/Oracle: mock/fixture-backed.
- Push delivery: unproven on a physical device.
- Agency: mobile-first, no web portal by design.
- Supplier scorecards: Admin-mediated, computed from evidence with no stored score.
- Localization: 4 locales (en/fr/es/ar) at full key parity; others not started.
