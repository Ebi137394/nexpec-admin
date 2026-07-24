# NEXPEC — Release Candidate Manual QA Checklist (Development environment only)

Execute against **Development** after `supabase db reset` + app deploy to dev. Do **not** run against production.
Each case: capture the stated evidence and mark Pass/Fail. Negative sub‑checks must also hold.

Legend — roles: **CL**=client, **IN**=inspector, **IN2/IN3**=replacement inspectors, **ADM**=platform admin, **AG**=agency/org owner, **MGR**=org non‑viewer (project_lead), **VW**=org viewer, **UX**=unrelated authenticated user, **ANON**=logged out.

---

## Identity & contract

**ID‑1 Direct identity — Protected (default)**
Role: CL. Prereq: job with `identity_mode='protected'`, fully‑executed contract to IN.
Steps: open `/client/contracts/job/{id}`. Expected: only the `NX‑…` handle; no name/résumé/certs/email/phone. Negative: inspect network payload — none of those fields present (DB‑redacted). Evidence: screenshot + `client_job_contracts_view` row (`inspector_display_name IS NULL`). Pass/Fail: ___

**ID‑2 Professional**
Role: ADM then CL. Steps: ADM sets identity_mode=Professional (admin job page → Save policy); CL reloads contract page. Expected: name, headline, résumé summary, résumé link, certifications, qualifications shown; **email & phone still absent**. Negative: no `inspector_email`/`inspector_phone` in payload. Evidence: screenshot + view row. Pass/Fail: ___

**ID‑3 Full**
Role: ADM then CL. Steps: ADM sets Full; CL reloads. Expected: professional fields **+ email + phone**. Negative: still no `inspector_payout_cents`/spread anywhere. Evidence: screenshot + view row. Pass/Fail: ___

**ID‑4 Snapshot immutability**
Role: ADM. Prereq: a fully‑executed contract executed while job was (say) Full. Steps: change job identity_mode to Protected. Expected: the **executed/voided** contract still renders under its execution‑time mode (Full) for historical rows; the **active** relationship follows the new live mode. Evidence: `job_contracts.effective_identity_mode` unchanged. Pass/Fail: ___

**ID‑5 Client price‑blindness (all modes)**
Role: CL. Steps: in every mode, inspect contract page + payload. Expected: `inspector_payout_cents`, `platform_spread_cents` never present. Evidence: payload capture. Pass/Fail: ___

**ID‑6 Shortlist stays protected**
Role: CL. Steps: before a contract exists, view any pre‑assignment inspector surface. Expected: no identity disclosure. Pass/Fail: ___

## Signing & activation

**SG‑1 Client → inspector order**
Role: CL then IN. Steps: CL signs; IN signs. Expected: contract `fully_executed`, job `in_progress`; audit events `contract.client_signed`, `contract.inspector_accepted`, `contract.fully_executed`. Evidence: `job_contracts.status`, `audit_events`. Pass/Fail: ___

**SG‑2 Interrupted signing / stale tab / refresh**
Role: CL. Steps: CL signs in tab A; in stale tab B attempt to sign again; refresh. Expected: second attempt rejected (`not awaiting client signature`); no double state; page reflects real status after refresh. Pass/Fail: ___

**SG‑3 Relogin recovery**
Role: IN. Steps: log out mid‑flow, log back in. Expected: contract state intact, resumable. Pass/Fail: ___

## Brokered / admin‑authorized

**BR‑1 Admin‑authorized replacement**
Role: ADM. Prereq: job `replacement_mode='admin_authorized'`, an active contract, an eligible application for IN2. Steps: Replace inspector with reason. Expected: new contract `pending_inspector_signature`, `client_approval_type='admin_authorized'`, `admin_authorized_by/at/reason` set, `client_signed_* NULL`; client sees informational notice (no signature demanded). Negative: client is NOT asked to sign. Evidence: `job_contracts` row. Pass/Fail: ___

**BR‑2 Admin‑authorized still requires inspector acceptance**
Role: IN2. Steps: IN2 signs. Expected: only now `fully_executed`. Negative: before IN2 signs, job is not executed. Pass/Fail: ___

**BR‑3 Prohibited direct contract creation**
Role: IN/CL. Steps: attempt a direct `job_contracts` insert via REST. Expected: denied (RLS admin‑mutate only). Pass/Fail: ___

## Replacement

**RP‑1 client_reapproval replacement**
Role: ADM→CL→IN2. Steps: ADM replaces (mode client_reapproval); CL re‑signs; IN2 signs. Expected: old contract `voided` (retained), new contract for IN2, job stays `in_progress`, exactly one non‑voided contract, job pointers (`contractor_id/hired_inspector_id/contract_id`) = IN2, client price preserved. Evidence: `job_contracts` rows + `jobs` pointers. Pass/Fail: ___

**RP‑2 Repeated replacement / replacement‑of‑a‑replacement**
Role: ADM. Steps: replace IN2→IN3. Expected: still exactly one active contract; IN2's contract voided; history retains IN, IN2, IN3 contracts + applications. Pass/Fail: ___

**RP‑3 No new job; supplier/brokered untouched**
Steps: after any replacement, count jobs for the id (unchanged) and confirm no `deals`/`agreements` row created. Evidence: `select count(*) from deals where job_id=…` = 0. Pass/Fail: ___

**RP‑4 RFQ/brokered job cannot be replaced via inspection flow**
Role: ADM. Steps: on a `source_rfq_id`‑spawned job, attempt admin_replace_inspector. Expected: rejected (42501). Also: the admin Inspection‑controls panel is not shown for such a job. Pass/Fail: ___

**RP‑5 Concurrency / duplicate submission / idempotency**
Role: ADM (two tabs). Steps: submit two replacements simultaneously; resubmit the same replace. Expected: at most one succeeds per active contract (partial unique index); the other errors cleanly; no partial state. Pass/Fail: ___

**RP‑6 Derived progress state (no new job status)**
Steps: after a standalone void, observe admin panel. Expected: "Awaiting replacement" (job `in_progress`, no active contract); after client_reapproval replace: "Awaiting client signature"; after admin_authorized: "Awaiting inspector acceptance". Evidence: no new `jobs.status` value introduced. Pass/Fail: ___

## Former‑inspector cutoff (after RP‑1, IN is former)

**FI‑1 Loses operational write**
Role: IN. Steps: attempt to create a capture / edit a report / submit AI detection on the job. Expected: denied. Evidence: RLS/`is_active_contract_inspector`=false. Pass/Fail: ___

**FI‑2 Retains own historical read**
Role: IN. Steps: read own past contract, captures, reports, AI detections. Expected: visible (authorship‑scoped). Pass/Fail: ___

**FI‑3 Cannot read replacement's records**
Role: IN. Steps: attempt to read IN2's deliverables / conversation. Expected: nothing. Pass/Fail: ___

**FI‑4 Cannot post messages after void (RPC + raw)**
Role: IN. Steps: `send_message` on the job conversation; then a raw `messages` insert. Expected: both denied (send_message cutoff + blocklist restrictive policy). Negative: an **active** inspector CAN post. Pass/Fail: ___

## Messaging silo & ghost mode

**MS‑1 Client↔inspector direct chat prohibited where required**
Steps: attempt cross‑party post outside allowed threads. Expected: denied. Pass/Fail: ___

**MS‑2 Team‑internal chat**
Role: MGR (post), VW (read‑only), UX (blocked). Expected: MGR posts, VW cannot post, UX sees nothing. Pass/Fail: ___

**MS‑3 Ghost admin**
Role: ADM. Steps: read internal thread (allowed, no trace) then attempt to post via `send_message` and via raw insert. Expected: reads leave no `ghost_read_internal` audit; posts denied (42501) both ways. Pass/Fail: ___

## Audit visibility (migration 290000)

**AU‑1 Own‑read**
Role: any authenticated actor. Steps: read `audit_events_public` filtered to own `actor_id`. Expected: own rows visible (redacted, inspectors anonymized). Pass/Fail: ___

**AU‑2 Job‑party read**
Role: CL. Steps: read `audit_events_public` for own job. Expected: that job's audit rows visible. Pass/Fail: ___

**AU‑3 Org‑member read**
Role: MGR/AG. Steps: read `audit_events_public` for an org‑tagged event. Expected: visible. Pass/Fail: ___

**AU‑4 Unrelated denial**
Role: UX. Steps: read `audit_events_public`. Expected: nothing. Pass/Fail: ___

**AU‑5 Anonymous denial**
Role: ANON. Steps: read `audit_events` (raw) and `audit_events_public`. Expected: raw → privilege error; view → empty. Pass/Fail: ___

**AU‑6 Inspector anonymization + price redaction**
Role: CL (non‑self reader of an inspector actor). Expected: inspector actor shown as `NX‑` handle; no payout/spread/margin in delta/metadata. Pass/Fail: ___

## Authorization & direct‑URL

**AZ‑1 Direct‑URL isolation**
Role: UX. Steps: hit contract/report/message/document/audit URLs for a job they aren't party to. Expected: no data. Pass/Fail: ___

**AZ‑2 Document/report/capture authorization follows active contract**
Role: IN (former) vs IN2 (active). Expected: former blocked from new writes/minting; active permitted. Pass/Fail: ___

**AZ‑3 Notification recipient correctness**
Steps: run a replacement. Expected: former inspector gets only "assignment ended"; new inspector gets "action required"; client gets sign/informational per mode; admins notified. No former‑inspector notification for ongoing work. Pass/Fail: ___

## Whole‑app smoke (regression from shared migrations/types)

**SM‑1** Auth: sign‑up, login, logout, password reset, email verify, session recovery. Pass/Fail: ___
**SM‑2** Client posts job → admin approves → job `open` + `approved`. Pass/Fail: ___
**SM‑3** Inspector browses open jobs (RFQ jobs excluded), applies, withdraws. Pass/Fail: ___
**SM‑4** Admin reviews/forwards application; client sees only forwarded ones. Pass/Fail: ___
**SM‑5** Payment hold / money‑flow authorization unaffected; no duplicate payout on void/replace. Pass/Fail: ___
**SM‑6** Report create/approve; payout request; admin payment confirmation. Pass/Fail: ___
**SM‑7** Supplier RFQ → deal → quote → award → engagement → sign_agreement works unchanged. Pass/Fail: ___
**SM‑8** Offline outbox recovery: duplicate RPC submission is idempotent; no double writes. Pass/Fail: ___
**SM‑9** AI Co‑Inspector: model loads on web (WDA), detections record via `pi_record_ai_detection`. Pass/Fail: ___
**SM‑10** Account deletion, document upload/download authorization. Pass/Fail: ___

---
Capture for each: actor account, timestamp, request/response or SQL result, screenshot where UI. Do not mark a case Pass without the stated evidence.
