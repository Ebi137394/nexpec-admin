# NEXPEC — Manual QA Guide: Identity Disclosure + Inspector Replacement

Scope of this build (Workflow A only): `jobs → applications → job_contracts → signatures`.
Everything else (auth, base marketplace, payments, Supplier/Brokered) should behave **unchanged** — verify, don't re‑learn.

**Environment:** development only. Apply first with `./scripts/qa/validate-identity-replacement.sh` (local stack) or `TARGET=linked …` (linked dev project). Never production.

**Key routes**
- Client contract: `/client/contracts/job/{contractId}`
- Inspector contract: `/inspector/contracts/job/{contractId}`
- Admin job (controls live here): `/admin/jobs/{jobId}` → “Inspection controls” panel
- Inspector open queue / apply: inspector dashboard → Browse open jobs

---

## A. Automated first (must be green before manual)
Run `./scripts/qa/validate-identity-replacement.sh`. It applies migrations, runs pgTAP (`rls_identity_replacement_test.sql`, 31 assertions), all QA guards, web + mobile typecheck, lint, unit tests. Fix any failure before manual QA.

---

## B. Setup fixtures (once)
1. Have (or create) 1 client, 3 inspectors (I1, I2, I3), 1 admin.
2. Client creates a job; admin approves so it’s `open`.
3. I1, I2, I3 each **Apply**.
4. Admin (`/admin/jobs/{id}`) generates a contract for I1; client signs; I1 signs → job `in_progress`. This is the baseline assignment for the tests below.

---

## C. Identity modes (the core new behaviour)
Set the mode in the admin **Inspection controls → Project policy → Identity disclosure → Save policy**, then open the **client** contract page and check the “Inspector details” block.

| Mode | Client MUST see | Client MUST NOT see |
|---|---|---|
| **Protected** (default) | NX‑handle only | name, résumé, certs, qualifications, email, phone |
| **Professional** | name, headline, résumé summary, résumé link, certifications, qualifications | email, phone |
| **Full** | all Professional fields **+ email + phone** | — |

Checks:
- [ ] Protected → only the `NX‑…` handle; no name/contact anywhere on the page.
- [ ] Professional → real name + résumé/certs/qualifications appear; **email & phone still absent**.
- [ ] Full → email + phone now appear.
- [ ] Change mode Protected→Full→Protected: the **active** contract’s disclosure follows the current policy live (policy affects the active relationship).
- [ ] Client never sees inspector payout or platform spread in any mode (the price shown is the client’s own price).
- [ ] **Shortlist / pre‑assignment** surfaces stay Protected (no identity before a contract exists).
- [ ] Snapshot immutability: with a fully‑executed contract, note the mode; later change the job policy — a **voided/historical** contract row keeps the mode it executed under (not the new one). (Backstopped by pgTAP.)

---

## D. Contract flow — all signature orders
- [ ] Client signs → Inspector signs → `fully_executed`, job `in_progress`.
- [ ] (Defensive) Inspector‑then‑client ordering resolves to `fully_executed` without leaving the job stuck.
- [ ] Audit: a `contract.client_signed`, `contract.inspector_accepted`, and `contract.fully_executed` event is recorded (admin audit view).

## E. Replacement — client_reapproval
Admin panel → Replacement mode = **Client re‑approval** → **Replace inspector** (pick I2’s application, enter payout, reason).
- [ ] Old contract becomes **voided** (still visible in history — not deleted).
- [ ] New contract exists for **I2**, status `pending_client_signature`.
- [ ] Job stays **in_progress** (no new status).
- [ ] Exactly **one** active (non‑voided) contract on the job.
- [ ] Client price is **preserved** (panel shows it read‑only; re‑pricing is rejected).
- [ ] Client re‑signs, then I2 signs → executes again.
- [ ] Previous applications (I1’s) remain in history.

## F. Replacement — admin_authorized
Admin panel → Replacement mode = **Admin‑authorized** → replace (pick I3, reason required).
- [ ] New contract status `pending_inspector_signature` (skips client signature).
- [ ] `client_signed_*` stay **NULL**; `client_approval_type = admin_authorized`; admin actor + timestamp + reason recorded.
- [ ] I3 must still **review & sign**; only then executes.
- [ ] Client sees an informational “inspector replaced” notice (no signature demanded).

## G. Former‑inspector restrictions (after E/F, I1 is the former)
- [ ] I1 can still **read** their own historical contract, captures, reports, AI detections.
- [ ] I1 **cannot** create/update captures or reports on the job (write cut off).
- [ ] I1 **cannot** read the replacement inspector’s deliverables.
- [ ] I1 **cannot** read the replacement’s conversation, and **cannot** post new messages on the job after void.
- [ ] I1 cannot reach future job activity via a broad `job_id` path.

## H. Replacement‑inspector permissions (I2/I3 active)
- [ ] Active inspector can create captures/reports, submit AI detections, and message on the job.
- [ ] Sees the job as their active assignment.

## I. Messaging permission matrix
Verify each actor on the job conversation(s):
- [ ] Active inspector: can send.
- [ ] Former inspector: **cannot** send after void; can still read their own prior thread only.
- [ ] Replacement inspector: can send in their own (separate) conversation.
- [ ] Client: unchanged — can send/read their own thread.

## J. Derived replacement‑progress states (admin panel banners)
- [ ] After a standalone **Void** (no replacement yet): “Awaiting replacement” banner; job `in_progress`, no active contract.
- [ ] After replace in client_reapproval: “Awaiting client signature”.
- [ ] After replace in admin_authorized: “Awaiting inspector acceptance (admin‑authorized)”.

## K. Finance — no duplication / no accidental mutation
- [ ] Void does **not** release, reverse, or duplicate any payout.
- [ ] Replacement does **not** copy the old inspector’s payout rows; no new transactions/escrow/invoice/wallet rows are created by void or replace.
- [ ] Old vs new inspector payout records stay isolated.
- [ ] No client endpoint/view exposes internal pricing. Existing payment‑hold / escrow / transactions / payout‑request / admin payment confirmation flows behave as before.

## L. RFQ / Supplier workflow unchanged
- [ ] Open a supplier‑RFQ‑spawned job in admin → the “Inspection controls” panel is **not** shown (guarded by `source_rfq_id`).
- [ ] Attempting inspector‑replacement on an RFQ job is rejected server‑side.
- [ ] RFQ → deals → agreements → engagements flow works exactly as before (create RFQ, quote, award, client_select_inspector, sign_agreement).

## M. Cross‑cutting (verify unchanged)
- [ ] **Auth:** sign up, login, logout, password reset, email verification, session recovery.
- [ ] **Marketplace:** client create/edit/cancel/archive job; inspector browse/apply/withdraw; admin review/dispatch/generate contract.
- [ ] **Inspection:** captures, reports, AI detections, findings, offline sync (active inspector).
- [ ] **Web:** admin job page, client contract page (the two changed screens) render and act correctly.
- [ ] **Mobile:** buyer pipeline / contract screens (shared `PipelineSection`) render; no regression from the view’s appended columns (mobile selects only existing columns).

---

### Notes for the tester
- Identity redaction is decided **entirely in the database** (`client_job_contracts_view`). If a field is hidden, the API never sent it — you cannot “inspect element” your way to it.
- All admin actions are audited (`audit_events`) and produce in‑app notifications; none touch money tables.
- If any step fails, capture the route + action + expected/actual; fixes are applied one at a time, the affected pgTAP/guard re‑run, then testing resumes.
