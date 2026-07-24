# NEXPEC — Manual QA Checklist

**Release:** Identity Disclosure (Protected / Professional / Full) + Inspector Replacement + audit own-read fix + WDA AI decoders
**Environment:** LOCAL (local Supabase) — start with `npm run qa:local`
**Tester:** ______   **Date:** ______   **Build/commit:** ______

Mark a case **PASS** only after you performed it and saw the expected result. Use **FAIL** + notes otherwise. `N/A` = not applicable, `SKIP` = blocked.

Status key: `[ ]` pending · `[P]` pass · `[F]` fail · `[N]` n/a · `[S]` skip

---

## 0 · Setup & environment
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| SU-1 | — | `npm run qa:local` | Prints local API URL + `http://localhost:3000`; app loads; Supabase calls hit 127.0.0.1; aborts if not local | [ ] | |
| SU-2 | — | Create local accounts (client, inspector1-3, agency, manager, viewer, unrelated) via /sign-up + onboarding; promote admin via Studio SQL `update public.profiles set role='admin' …` | Each logs in with its role; admin sees admin nav | [ ] | |

## 1 · Authentication & registration
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| AUTH-1 | Client | Register client (sign-up → verify in Inbucket if required → onboarding role=client) | Account+profile created; lands on client area; bad input rejected | [ ] | |
| AUTH-2 | Inspector | Register inspector | profile role=inspector; inspector dashboard | [ ] | |
| AUTH-3 | Agency | Register agency + org; add manager (project_lead) + viewer | org + org_members created; roles correct | [ ] | |
| AUTH-4 | Any | Login valid | authenticated session, correct landing | [ ] | |
| AUTH-5 | Any | Login wrong password | clear error, no session, no trace leak | [ ] | |
| AUTH-6 | Any | Logout | session cleared; protected route → /sign-in | [ ] | |
| AUTH-7 | Any | Session recovery (refresh; reopen tab) | session persists; resumes | [ ] | |
| AUTH-8 | Any | Password reset (/forgot-password → Inbucket link → /reset-password) | new password works; old fails | [ ] | |

## 2 · Job lifecycle
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| JOB-1 | Client | Create job | pending_approval/moderation | [ ] | |
| JOB-2 | Admin | Approve job | status=open, moderation=approved | [ ] | |
| JOB-3 | Inspector | Browse open-jobs feed | approved job visible; RFQ jobs excluded | [ ] | |
| JOB-4 | Inspector | Apply | application created; cannot apply to RFQ/non-open | [ ] | |
| JOB-5 | Inspector | Withdraw application | withdrawn | [ ] | |
| JOB-6 | Admin | Forward application to client | forwarded_to_client set | [ ] | |
| JOB-7 | Client | View applications | sees ONLY forwarded; un-forwarded hidden | [ ] | |
| JOB-8 | Admin | Generate contract | job_contracts pending_client_signature; RFQ job rejected | [ ] | |

## 3 · Contracts & signing
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| CT-1 | Client | Sign | → pending_inspector_signature; job open→assigned; hired_inspector_id set | [ ] | |
| CT-2 | Inspector | Sign | → fully_executed; job → in_progress | [ ] | |
| CT-3 | Both | Interrupted/stale-tab sign + refresh | second attempt rejected; state consistent; no double execution | [ ] | |
| CT-4 | Any | Relogin mid-flow | state intact/resumable | [ ] | |
| CT-5 | Admin | Signing audit events | client_signed / inspector_accepted / fully_executed recorded | [ ] | |

## 4 · Identity modes
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| ID-1 | Client | Protected | handle only; NO name/résumé/certs/quals/email/phone (not even in payload) | [ ] | |
| ID-2 | Admin→Client | Professional | name/headline/résumé/certs/quals; NO email/phone | [ ] | |
| ID-3 | Admin→Client | Full | + email + phone; still no payout/spread | [ ] | |
| ID-4 | Admin | Snapshot immutability (change mode post-execution) | executed/voided keeps execution-time mode; active follows new | [ ] | |
| ID-5 | Client | Price-blindness (all modes) | no payout/spread in any payload | [ ] | |
| ID-6 | Client | Shortlist/pre-assignment | stays Protected | [ ] | |
| ID-7 | Client/Admin | Open OLDER job/contract | loads; defaults Protected/client_reapproval; no missing-column error | [ ] | |

## 5 · Inspector replacement
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| RP-1 | Admin | client_reapproval replace | old voided (kept); new pending_client_signature; ONE active; pointers=new; price preserved; job in_progress | [ ] | |
| RP-2 | Client→Insp2 | complete client_reapproval | new fully_executed | [ ] | |
| RP-3 | Admin | admin_authorized replace | new pending_inspector_signature; client_signed NULL; admin metadata set; client informational | [ ] | |
| RP-4 | Insp3 | admin_authorized needs inspector sign | executes only after inspector signs | [ ] | |
| RP-5 | — | side-effects | NO new job; deals/agreements untouched; history retained | [ ] | |
| RP-6 | Admin | repeated / replacement-of-replacement | always one active; chain retained | [ ] | |
| RP-7 | Admin | concurrency (2 simultaneous) | one succeeds; other errors cleanly; no partial state | [ ] | |
| RP-8 | Admin | duplicate/stale submit | safely rejected; no duplicate | [ ] | |
| RP-9 | Admin | RFQ/brokered job replace | rejected (42501); panel hidden | [ ] | |
| RP-10 | — | derived progress state | awaiting-replacement / awaiting-client-sig / awaiting-inspector-accept; no new job status | [ ] | |

## 6 · Former-inspector restrictions
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| FI-1 | Former | new capture | denied | [ ] | |
| FI-2 | Former | edit report / AI detection | denied | [ ] | |
| FI-3 | Former | post via send_message | denied (42501); active inspector can | [ ] | |
| FI-4 | Former | raw messages insert | denied by blocklist policy; legit posters unaffected | [ ] | |
| FI-5 | Former | read replacement's work/conversation | nothing | [ ] | |
| FI-6 | Former | read own history | own contract/captures/reports/detections readable | [ ] | |

## 7 · Permissions matrix
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| PM-1 | Client | own-only visibility | no other client's data; no payout/spread; direct-URL to other's contract → nothing | [ ] | |
| PM-2 | Active Insp | operational access | works assigned job | [ ] | |
| PM-3 | Agency | org-scoped | own org only | [ ] | |
| PM-4 | Admin | god-mode | full access | [ ] | |
| PM-5 | Manager | non-viewer actions | allowed | [ ] | |
| PM-6 | Viewer | read-only | cannot post internal | [ ] | |
| PM-7 | Unrelated | no access to others | blocked | [ ] | |
| PM-8 | Anon | anonymous | redirected; no protected data | [ ] | |

## 8 · Messaging & organization workspace
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| MS-1 | Active Insp | inspector↔admin | works | [ ] | |
| MS-2 | Client | client↔admin | works; client↔inspector direct prohibited where required | [ ] | |
| MS-3 | MGR/VW/Out | team-internal | manager posts; viewer read-only; outsider blocked | [ ] | |
| MS-4 | Ghost Admin | read internal | can read; NO ghost_read_internal trace | [ ] | |
| MS-5 | Ghost Admin | post (send_message + raw) | both denied (42501) | [ ] | |

## 9 · Notifications
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| NT-1 | — | recipients after replacement | former=only 'assignment ended'; new='action required'; client per mode; admins notified | [ ] | |
| NT-2 | — | reminder cron | only notifies; never auto-void/select/replace/sign | [ ] | |

## 10 · Audit logs & security
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| AL-1 | Actor | own audit read (view) | own rows visible, redacted/anonymized | [ ] | |
| AL-2 | Client | job-party audit read | job's rows visible | [ ] | |
| AL-3 | Org member | org-member audit read | org-tagged rows visible | [ ] | |
| AL-4 | Unrelated | audit read | nothing | [ ] | |
| AL-5 | Anon | audit read | raw → privilege error; view → empty | [ ] | |
| AL-6 | Non-admin | raw audit_events | admin-only; nothing for non-admin | [ ] | |
| AL-7 | Client | anonymization + redaction | inspector→NX handle; no payout/spread/margin | [ ] | |
| AL-8 | Unrelated | direct-URL isolation | contract/report/message/doc/audit for non-party → nothing | [ ] | |

## 11 · Documents & inspection work
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| DC-1 | Active Insp | create capture | saved; former denied | [ ] | |
| DC-2 | Insp/Client | report create + approve | works; former cannot edit | [ ] | |
| DC-3 | Party | upload/download document | authorized party ok; non-party/former blocked | [ ] | |

## 12 · Payments / holds (if affected)
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| PY-1 | Admin | void contract | NO auto payout release/reverse/duplicate; money tables unchanged | [ ] | |
| PY-2 | — | replacement vs finance | no copied payout; old/new transactions isolated | [ ] | |
| PY-3 | Client | payment surfaces | no internal pricing/margin | [ ] | |
| PY-4 | — | payment hold / money-flow authz | unchanged | [ ] | |
| PY-5 | Insp/Admin | payout request + confirmation | unchanged; no duplication | [ ] | |

## 13 · Search / filters / dashboards
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| SF-1 | Inspector | open-jobs search+filters | correct results | [ ] | |
| SF-2 | Client | dashboard widgets | load | [ ] | |
| SF-3 | Inspector | dashboard/pipeline | loads; reflects active contract | [ ] | |
| SF-4 | Admin | dashboard/job list/detail | loads; Inspection-controls only on inspection jobs | [ ] | |

## 14 · Error handling & resilience
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| EH-1 | Any | invalid input | clear validation; no crash | [ ] | |
| EH-2 | Any | stale/concurrent edit | safe rejection | [ ] | |
| EH-3 | Any | refresh + back/forward | consistent state | [ ] | |
| EH-4 | Mobile | offline outbox recovery | idempotent replay; no double writes | [ ] | |
| EH-5 | Any | network/API error mid-action | graceful; no white screen | [ ] | |

## 15 · Whole-app regression smoke
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| SM-1 | Any | onboarding & role selection | works all roles | [ ] | |
| SM-2 | Client/Supplier | supplier RFQ workflow | unchanged end-to-end | [ ] | |
| SM-3 | Any | account deletion | works per policy | [ ] | |
| SM-4 | Inspector | AI Co-Inspector model load + 1 detection record | model loads; records via pi_record_ai_detection | [ ] | |

## 16 · Web & Mobile regression
| ID | Role | Action | Expected | Status | Notes |
|----|------|--------|----------|:------:|-------|
| WM-1 | Web | admin job page + client contract page | render + function | [ ] | |
| WM-2 | Mobile | buyer pipeline / contract screens | render; no regression from appended view columns | [ ] | |
| WM-3 | — | reference automated: typecheck/lint/174 db/114 unit | green in last local run; re-run if code changed | [ ] | |

---

### Sign-off
- Total PASS ____ / FAIL ____ / N/A ____ / PENDING ____
- All FAILs triaged (defect vs test-data)? ☐
- Go decision: ☐ GO to Development · ☐ NO-GO — reason: __________
- Signed: __________  Date: ______
