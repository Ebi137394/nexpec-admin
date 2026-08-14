# NEXPEC — Final Feature Inventory

**Compiled at `cd81e43`** · branch `release/identity-replacement` · against the local
186-migration database.

## How to read this

Every row is backed by something in the repository — a route file, a migration, an RPC, a
passing test. **Nothing here is asserted from intent.** Where a capability exists in the
database but has no user-facing surface, it says so. Where a workflow is deliberately
Web-only, Mobile-first or Admin-mediated, it says that too, because those are design
decisions rather than gaps.

Status vocabulary, used strictly:

| Status | Meaning |
|---|---|
| **Verified** | exercised by a passing automated test, or by a runtime probe this session |
| **Implemented** | route/RPC/table exist and are wired; not independently runtime-proven |
| **Admin-mediated** | deliberately has no self-service surface for the end role |
| **Mock-backed** | works against fixtures; no real external tenant credentials exist |

## Scale

| | |
|---|---|
| Web routes | 186 pages · 9 API routes |
| Mobile screens | 261 |
| Migrations | 186 |
| Edge Functions | 39 |
| pgTAP suites | 56 |
| Tables / views | 241 / 37 |
| RLS-enabled tables · policies | 235 · 574 |

---

## 1. Jobs, matching and assignment

| Feature | Purpose | Roles | Web | Mobile | Backend | Status |
|---|---|---|---|---|---|---|
| Job posting | Client/Agency raise an inspection requirement | client, agency | `/client/jobs` | `post-new-job.tsx` | `jobs`, `jobs_owner_xor` CHECK | Verified |
| Admin review + publish | Broker approves before exposure | admin | `/admin/jobs` | `(admin)` | `moderation_status`, `guard_jobs_status_transition` | Verified |
| Matching engine | Rank inspectors by domain/credential | admin | `/admin/dispatch` | — | `nx_inspector_job_match_core` (25 pts for verified cert) | Verified |
| Applications | Inspector applies; Admin forwards | inspector, admin | `/inspector/jobs/[id]/apply` | `(inspector)/jobs/[id]/apply` | `applications.cover_note`, `bid_amount_cents` | Verified |
| Targeted broadcast | Invite a specific inspector set | admin | `/admin/dispatch` | — | `targeted_job_broadcast` | Verified (9 assertions) |
| Brokered dispatch | Admin assigns; never self-assign | admin | `/admin/dispatch` | — | `admin_dispatch_job` | Verified |
| Direct assignment | Admin places an inspector directly | admin | `/admin/dispatch` | — | `admin_direct_assignment` | Verified |

**Canonical sequence enforced by the database, not convention:** create unassigned →
fund → `admin_dispatch_job()`. A direct `pending_approval → assigned` UPDATE is refused by
`guard_jobs_status_transition`, and attaching an inspector to an unfunded job is refused by
`nx_guard_dispatch_requires_funding`.

## 2. Multi-Inspector and Multi-Visit

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| Inspector teams | admin, inspector | Admin + Inspector web/mobile | `job_inspectors`, `nx_is_active_job_team_member` | Verified |
| Team evidence contribution | inspector | mobile + web | `inspection_items` team-scoped RLS | Verified |
| Team conversation authorization | inspector, admin | chat | `team_conversation_auth` | Verified |
| Multi-visit / recurring | admin, inspector | `/inspector/assignments` | `visits`, `visit_schedule_conflicts` | Verified |
| Visit evidence isolation | inspector | mobile | per-visit evidence separation | Verified |
| Schedule conflict preview | admin | `/admin/dispatch` | `nx_schedule_conflicts_core` | Verified |

## 3. Inspection execution

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| ITP (Inspection & Test Plan) | admin, inspector, client | `/admin/jobs/[id]/itp` | `itp_points`, `itp_point_results`, `nx_itp_record_result` | Verified |
| Hold-point release | admin, buyer only | Admin | `nx_itp_release_hold`, `nx_itp_may_waive` | Verified |
| QCP (Quality Control Plan) | admin, client | `/admin` QCP surfaces | `qcp_revisions`, `qcp_stages`, `nx_qcp_submit_revision` | Verified |
| QCP revision lifecycle | admin, client | Admin | forward-only `tg_qcp_revision_state` | Verified (61 assertions) |
| NCR (non-conformance) | inspector, admin | mobile + Admin | `nx_raise_ncr_from_itp_point`, `raise_nonconformance` | Verified |
| Inspection items | inspector | mobile | `inspection_items` | Verified |
| Evidence capture | inspector | mobile | `inspection_captures`, GPS pin trigger | Implemented |

## 4. Reports, review and delivery

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| Report submission | inspector | `/inspector/jobs/[id]/submit-report` + mobile | `inspection_reports` | Verified |
| **Senior Inspector review** | senior | `/inspector/reviews` + `(inspector)/reviews` | `report_senior_reviews`, `decideSeniorReview` | Verified |
| Reviewer assignment | admin | `/admin/reports` | `assignSeniorReviewer`, `canAssignReviewer` | Verified |
| Append-only review history | all parties | Admin + Inspector | `report_review_history` + TRUNCATE guard | Verified |
| No self-review | — | enforced server-side | `nx_guard_report_no_self_approval` | Verified |
| **Admin-only final delivery** | admin | `/admin/reports` | `nx_admin_deliver_report` | Verified |
| Delivery funding gate | — | — | `nx_funding_delivery_satisfied` | Verified |

A Senior Inspector surface **never renders a delivery control** — it is absent, not
disabled. Delivery to Client is Admin-only by construction.

## 5. Money — manual by design

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| Staged 20/80 funding | client, admin | Client finance + `/admin/funding` | `job_funding_stages`, 2000/8000 bps | Verified |
| Configurable terms | admin only | `/admin/funding` | `setFundingTerms`, `isValidFundingSplit` | Verified |
| Dispatch funding gate | — | — | `nx_guard_dispatch_requires_funding` | Verified |
| Stripe payment intents | client | Client | `create-payment-intent` (staged) | Implemented |
| **Manual settlement** | admin only | `/admin/payouts` | `admin_mark_payout_processed` | Verified |
| Wallet / earnings | inspector | `/inspector/wallet` + mobile | `wallets`, `transactions` | Verified |
| Withdrawal **request** | inspector | wallet | `request_withdrawal` — a request, not a payout | Verified |
| Disputes | client, admin | `/client/disputes` | `file_dispute`, escrow `disputed` | Verified |

**There is no automatic payout path.** `trg_credit_inspector_on_confirm` and
`execute_auto_payout` were both detached (`444000`, `432000`), and `458000` removed the last
automatic credit. The Golden Path now asserts settlement leaves the inspector *untouched*.

## 6. Commercial privacy

| Rule | Mechanism | Status |
|---|---|---|
| Inspector never sees client price | column privilege — `has_column_privilege=false` | Verified |
| Client never sees inspector payout | same | Verified |
| Platform spread never leaks | `jobs_secure_view` masks via `CASE WHEN nx_is_admin()` | Verified |
| Agency sees own jobs only | `WHERE client_id=auth.uid() OR agency_id=auth.uid()` | Verified |
| Only Admin projection holds both | `AdminFundingProjection` derives spread in one place | Verified |

## 7. Identity, chat and disclosure

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| Brokered chat | all | `/chat`, Admin threads | `conversations` (client↔admin, inspector↔admin) | Verified |
| No direct Client↔Inspector channel | — | — | separate rooms + guessed-room denial | Verified |
| Controlled identity disclosure | admin | Admin | `request_named_disclosure`, `identityDisclosure.ts` | Verified |
| Replacement isolation | — | — | `rls_identity_replacement` | Verified |
| Identity modes | admin | Admin | professional / protected / full | Verified |
| Ghost-Mode team chat | inspector team | mobile | `rls_team_internal` | Verified |

## 8. Credentials

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| Cert wallet | inspector | `(inspector)/wallet/cert-wallet` | `certifications` | Verified |
| **Admin-only verification** | admin | Admin | `trg_certifications_verification_authority` | Verified |
| Four-eyes rule | — | — | no actor may verify their own credential | Verified |
| Expiry ladder | inspector | mobile | `nx_certification_expiry_scan` (derived, never stamped) | Verified |
| CCI tier admission | admin | Admin | `inspector_credentials` (separate question) | Implemented |

## 9. Agency — **Mobile-first, public Web profile only**

| Feature | Surface | Backend | Status |
|---|---|---|---|
| Agency dashboard | `(tabs)/agency-dashboard` (role-gated tab) | `jobs_secure_view` | Verified |
| Applicants + credentials | `(agency)/jobs/[id]` | `applications`, `certifications` | Verified |
| Job creation | redirects → `/post-new-job` | — | Verified (deliberate stub) |
| Public agency profile | `/agency/[handle]` (Web) | `profiles` | Implemented |

**Deliberately has no Web portal.** No payment or settlement RPC exists on any Agency
surface. Commercial columns arrive NULL-masked.

## 10. Supplier — **Web-first portal**

| Feature | Surface | Backend | Status |
|---|---|---|---|
| Onboarding + profile | `/suppliers/onboard`, `/profile` | `supplier_onboard`, `supplier_profiles` | Verified |
| RFQ opportunities | `/suppliers/opportunities` | `supplier_rfqs`, `create_rfq` | Verified |
| Quotes / bids | `/suppliers/bids` | `submit_quote`, `award_quote`, `supplier_quotes` | Verified |
| Contracts + agreements | `/suppliers/contracts` | `agreements`, `sign_agreement` | Verified |
| Vendor documents | `/suppliers/documents` | `vendor_documents`, `vendor_document_seal` | Verified |
| Finance | `/suppliers/finance` | `supplier_earnings` — request only | Verified |
| Brokered messages | `/suppliers/messages` | `conversations` + admin | Verified (105 assertions) |
| Mobile dashboard | `(tabs)/supplier-dashboard` | — | Verified |
| **Supplier Scorecards** | `/admin/scorecards` | `supplier_scorecard_{metrics,policy,confidence_bands}` | **Admin-mediated** |

Scorecards are **rubric + evidence**, not stored scores: there is no per-supplier score
table. The published rubric is readable by authenticated users, which is what makes the
score explainable; only Admin can change it.

## 11. Enterprise — SSO / SCIM

| Feature | Surface | Backend | Status |
|---|---|---|---|
| SSO connections (SAML/OIDC) | `/admin/sso` | `org_sso_connections` | Verified |
| Domain verification | `/admin/sso` | `org_sso_domains` | Verified |
| SCIM token lifecycle | `/admin/sso` | `org_scim_tokens` — prefix only, secret shown once | Verified |
| Group → role mapping | `/admin/sso` | `org_scim_group_mappings` | Verified |
| Provisioning identities | `/admin/sso` | `org_scim_identities` | Verified |
| Deprovision archive | `/admin/sso` | `org_scim_membership_archive` | Verified |
| SCIM 2.0 endpoint | — | `supabase/functions/scim-v2` | Implemented |
| Audit trail | `/admin/sso` | `org_scim_events` | Verified |

No second user directory — SCIM provisions onto existing `profiles`/`org_members`.

## 12. ERP Integration Core + adapters

| Feature | Surface | Backend | Status |
|---|---|---|---|
| Connector health | `/admin/integrations` | `integration_connector_health` | Verified |
| Canonical entity model | `/admin/integrations` | `integration_canonical_entities/fields` | Verified |
| Field mapping versions | `/admin/integrations` | `integration_mapping_versions` | Verified |
| Inbound message pipeline | — | `integration_inbound_messages` | Verified |
| **Idempotency / retry** | — | `nx_integration_claim_message` | Verified |
| Dead-letter queue | `/admin/integrations` | `integration_dead_letter_queue` | Verified |
| Operator replay | `/admin/integrations` | `nx_integration_replay_message` | Verified |
| Record links | `/admin/integrations` | `integration_record_links` | Verified |
| **SAP / Oracle adapters** | — | `adapter-fixtures.json` | **Mock-backed** |

Dead-letter payloads are **redacted before render**: a key is shown only if the *active*
mapping version maps it, and withheld keys are counted so "redacted" never reads as "empty".
No real SAP/Oracle tenant credentials exist — adapters are fixture/contract-tested only.

## 13. NEXPEC Talent

| Feature | Roles | Surface | Backend | Status |
|---|---|---|---|---|
| Candidate profile + consent | inspector | `(inspector)/talent.tsx`, `/inspector/talent` | `talent_consents` | Verified |
| **Consent-before-disclosure** | — | — | employer sees identity only after consent | Verified |
| Employer pipeline | employer | `/talent` | brokered view, never the base table | Verified |
| Admin Talent console | admin | `/admin/talent` | `talent_opportunities` | Verified |
| Domain taxonomy reuse | — | — | `inspection_domain` enum — no Talent fork | Verified |
| Resume disclosure control | candidate | — | `resume_disclosure_access` | Verified |

Consent writes are deliberately **outbox-exempt**: a queued withdrawal would leave identity
disclosable while the UI claimed otherwise, so they fail loudly offline instead.

## 14. Projects and Programs

| Feature | Surface | Backend | Status |
|---|---|---|---|
| Projects | Admin + Client | `work_orders`, `projects` | Implemented |
| Programs console | `/admin/programs` (+ detail) | program tables | Implemented |
| Job ↔ project bridge | — | `20260801412000` | Verified |

## 15. Platform services

| Feature | Surface | Backend | Status |
|---|---|---|---|
| Notifications | all | in-app + push | `notifications`, `push_tokens`, `dispatch-notification-emails` | Verified |
| Offline outbox + replay | inspector mobile | `lib/offline/*` | itpReplay 19 · visitReplay 22 · reviewReplay 13 | Verified |
| Offline routing guard | — | `qa:outbox` — 704 files scanned | Verified |
| AI inspection models | inspector | `ai-coinspector` | `react-native-fast-tflite`, 43 ML assertions | Verified |
| Hashing / sealing / chain of custody | — | `anchor-inspection-seals`, `confirm-inspection-anchors` | `root_sha256` | Implemented |
| Localization | all | 4 locales | `messages/{en,fr,es,ar}.json` — 160 keys each, parity verified | Verified |
| Document vault | admin | `/admin/vault`, `mint-doc-url` | signed URLs | Implemented |
| Analytics | admin | `/admin` analytics | existing analytics tables | Implemented |
| Admin security tooling | admin | `/admin/diagnostics`, `/admin/integrity` | audit events | Implemented |

---

## Deliberate design decisions — not gaps

1. **Agency is Mobile-first.** Only a public profile page on Web. No Web portal.
2. **Supplier is Web-first**, with a mobile dashboard that hides jobs/finance/resources.
3. **Supplier Scorecards are Admin-mediated.** No supplier-facing scorecard UI.
4. **SAP/Oracle are mock-backed.** No live tenant integration is claimed.
5. **Settlement and payout are Admin-manual everywhere.** No role can self-release funds.
6. **`/suppliers/onboard` and `(agency)/create-job`** are intentional redirect stubs kept so
   old deep links resolve.

## Not verified at runtime

- SAP/Oracle against a real tenant — no credentials exist.
- Push notification delivery to a real device — requires APNs/FCM credentials.
- Stripe live-mode payment flows — test mode only.
