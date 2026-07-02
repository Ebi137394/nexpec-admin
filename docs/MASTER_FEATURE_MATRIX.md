# NEXPEC — Master Feature Matrix (canonical baseline)
_Generated 2026-06-25. Supersedes `NEXPEC_PRELAUNCH_AUDIT.md` (2026-06-04), which predates the Teaser Marketplace, Syndication Feeds, Agency Team Workspaces, and the RLS lockdown._

**Legend:** ✅ live · 🟡 partial / via another surface · ⛔ not present · ➖ N/A for that platform
**Platforms:** **W** = Next.js web (`apps/web`) · **M** = Expo/React Native mobile (root `app/` + `src/`)
Shared Supabase backend (one DB, RLS-enforced) → most capability differences are UI-only.

---

## 1. Authentication & onboarding
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Email + password sign-in/up | ✅ | ✅ | `lib/auth/actions.ts` |
| Google OAuth | ✅ | ✅ | `signInWithOAuth({provider:'google'})` |
| Apple OAuth | ✅ | ✅ | `provider:'apple'` |
| LinkedIn OAuth (OIDC, PKCE) | ✅ | ✅ | `provider:'linkedin_oidc'` + `hydrate_identity` |
| Magic-link / token bridge | ✅ | 🟡 | `bridge/[token]`, `verify` |
| Role picker at sign-up (Inspector/Client/Agency/Enterprise/Supplier) | ✅ | ✅ | `onboardingActions.ts`; ROLES incl. `supplier` |
| Post-login role routing | ✅ | ✅ | `destinationForUser` / `(tabs)/_layout` gate |
| "Use web portal" deep-link hand-off | ➖ | ✅ | `(auth)/use-web-portal` |
| Onboarding wizard + specialties multiselect | ✅ | ✅ | role-specific fields |
| Onboarding checklist (dismiss / restore toggle) | ✅ | 🟡 | `OnboardingChecklist`, `ChecklistDismissButton` |
| Biometric login (Face/Touch ID, persisted) | ➖ | ✅ | `src/services/BiometricAuth.ts` |
| 2FA / MFA (TOTP) | ✅ | 🟡 (prepared) | web `MfaSection`; mobile AAL pending |
| Org invitation accept | ✅ | ✅ | `orgs/accept/[token]` / `invite_org_member` |
| Email verification | ✅ | 🟡 | `verify/page.tsx` |
| Account soft-delete / anonymize / ban | ✅ | ✅ | `delete-account` edge fn |

## 2. Public / marketing / SEO (web-native acquisition layer)
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Landing page + marketing sections (Hero, HowItWorks, TrustPillars, ProvableAI, Industries, LiveTicker, CTA) | ✅ | ➖ | static + ISR |
| `/discover` Teaser Marketplace (ISR ~60s) | ✅ | ⛔ | `public_supply_feed` + `public_demand_feed` |
| `/talent/[handle]` inspector teaser (Person/ProfilePage JSON-LD) | ✅ | ⛔ | `nx_handle` pseudonym |
| `/agency/[handle]` aggregate pool (Organization JSON-LD) | ✅ | ⛔ | no roster disintermediation |
| `/inspections/[slug]` job teaser (JobPosting JSON-LD → Google Jobs) | ✅ | ⛔ | coarse rate bands, no client id |
| `/p/[userId]` anonymized trust card | ✅ | 🟡 | `cert/[slug]` public cert on mobile |
| `/inspectors` public directory (anonymized filters) | ✅ | 🟡 | mobile dir is auth-only |
| RSS `/feed.xml` + JSON `/feed.json` | ✅ | ➖ | ports & adapters → Make/Zapier |
| `sitemap.xml` + `robots.txt` | ✅ | ➖ | per-item SEO pages |
| Trust sigil + NX- handle rendering | ✅ | ✅ | `inspectorHandle.ts`, `TrustSigil` |
| Contact page | ✅ | 🟡 | |

## 3. Client / Agency / Enterprise portal
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Dashboard + metrics + actionable counters | ✅ | ✅ | `clientDashboardMetrics` / role dashboards |
| Separate Agency dashboard | 🟡 | ✅ | mobile `agency-dashboard.tsx` |
| Separate Enterprise dashboard | 🟡 | ✅ | mobile `enterprise-dashboard.tsx` |
| Post / list / detail jobs | ✅ | ✅ | `jobs` table |
| Job applications review + rate inspector | ✅ | ✅ | rate-inspector flow |
| Job clauses / release / review | ✅ | 🟡 | |
| **Team members list + invite/revoke (roles: owner/procurement_admin/project_lead/viewer)** | ✅ | ✅ | `org_members` + `invite_org_member`/`revoke_org_invitation` |
| **Team Missions list (org's jobs, price-free)** | ✅ | ⛔ | `nx_team_jobs()` RPC |
| **In-mission team chat (shared buyer↔admin thread + pseudonymous attribution)** | ✅ | ⛔ | `nx_can_team_access_conversation` |
| Org structure / departments / spend | ✅ | 🟡 | `orgStructure.ts` |
| Budget overview + envelopes (cost centers) + policies (approval gates) | ✅ | 🟡 | `client/budget/*` |
| Approvals queue + decision dialog | ✅ | 🟡 | |
| Invoices list + detail + download | ✅ | 🟡 | `invoices.*_cents` |
| Finance dashboard / spend analytics | ✅ | ✅ | |
| RFQs (create/browse/detail) + supplier directory | ✅ | ✅ | `supplier_rfqs`, anti-poaching NX- handles |
| Contracts + inline e-signature | ✅ | ✅ | spine agreements |
| Disputes | ✅ | ✅ | |
| Documents / Evidence Vault | ✅ (dormant cols) | 🟡 (unwired) | `client_documents` — schema-drift caveat |
| Branding / white-label settings | ✅ | ✅ | |
| Preferred inspector network + smart analysis | 🟡 | ✅ | mobile `network/` |
| Live radar / risk heatmap / audit timeline | 🟡 | ✅ | mobile client widgets |
| Reports list / archive | ✅ | ✅ | `report→admin→client` gate |
| Compliance status dashboard | ✅ | 🟡 | |
| Currency selector + locale switcher | ✅ | 🟡 | |

## 4. Inspector portal
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Dashboard + next-actions | ✅ | ✅ | `fetchInspectorDashboardMetrics` |
| Browse + filter jobs (specialty/city/urgency/sponsorship) | ✅ | ✅ | |
| Apply to job + eligibility check | ✅ | ✅ | |
| Active assignments | ✅ | ✅ | `jobs.contractor_id` |
| Submit inspection report (photos + result + attestation) | ✅ | ✅ | `inspection_reports` |
| **Flash report / NCR capture** | ✅ | ✅ | shared RPCs |
| **Seal report (provable-AI, on-device)** | 🟡 | ✅ | `seal-report`, `pi_report_seals` |
| **On-device AI Co-Inspector (defect vision)** | 🟡 (page) | ✅ (live) | mobile compliance capture |
| **Native camera compliance capture (live only, no gallery)** | ➖ | ✅ | `expo-camera` |
| **Barcode / QR asset scanner** | ⛔ | ✅ | `AssetScannerScreen` |
| **Voice findings drafter** | ✅ (recorder) | ✅ | |
| **Offline outbox + SQLite sync** | ➖ | ✅ | `src/core/offline/*` |
| Wallet (available/accrued/in-flight/earned) | ✅ | ✅ | dollars; price-blind payout only |
| Request withdrawal (manual payout) | ✅ | ✅ | `process-payout` |
| Stripe Connect onboarding | ✅ | 🟡 | `create-stripe-connect-link` |
| Certifications + cert wallet | ✅ | ✅ | `cert-wallet` |
| Equipment / experience / documents | ✅ | ✅ | |
| Tax center (submit/review) | ✅ | 🟡 | `tax-vault` |
| Calendar / scheduling | ✅ | 🟡 | |
| Negotiations + coordination bridge | ✅ | 🟡 | `InspectorBridgeWorkspace` |
| Disputes | ✅ | ✅ | |
| Messages inbox | ✅ | ✅ | siloed inspector↔admin |
| Tools / resources (keyed) | ✅ | ✅ | `tool-document` EF |
| Maps (browse jobs) | 🟡 | ✅ | `browse-jobs-map` |

## 5. Supplier portal
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Dashboard + matching engine + verification meter | ✅ | ✅ | `useSupplierEcosystem` |
| Open opportunities list (matched/unmatched) | ✅ | ✅ | |
| Quote/bid submission | ✅ | ✅ | `submitQuote()` |
| Award → client supply agreement sign → milestone escrow | ✅ | ✅ | `awardAndDispatch` |
| Bids list (shortlisted/awarded/lost/withdrawn) | ✅ | ✅ | |
| Supplier directory (anti-poaching, NX- handles) | ✅ | ✅ | |
| Onboarding (legal name, capabilities, attributes) | ✅ | ✅ | |
| Finance / payouts | ✅ | ✅ | `create-supplier-payout` |
| Contracts (deal flow) | ✅ | ✅ | `supplier_contracts` executed-gate |
| Documents | ✅ | ✅ | |
| Messages / support | ✅ | ✅ | |

## 6. Admin / Super-admin console (god-mode: `admin` ≡ `super_admin`)
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Operations dashboard | ✅ | ✅ | |
| Audit trail (event log + JSON diff + filters) | ✅ | ✅ | price-redaction on audit |
| Anomaly feed / integrity dashboard | ✅ | 🟡 | |
| Jobs queue + moderation panel | ✅ | ✅ | |
| **Dispatch / Spread Editor (set blind price → confirm & dispatch)** | ✅ | 🟡 | `platform_spread_cents` admin-only |
| RFQ moderation + markup console (offer-only to client) | ✅ | 🟡 | `rfq_client_offers_view` |
| Contracts / MSA / amendments | ✅ | ✅ | |
| Messages (all rooms) | ✅ | ✅ | support inbox + 1:1 |
| Disputes moderation | ✅ | ✅ | |
| Reviews moderation (flag / adjust) | ✅ | ✅ | |
| Treasury control tower (requests/advances/reconciliation) | ✅ | ✅ | `reconcile-ledger` |
| Payouts (mark-paid / reject, manual) | ✅ | ✅ | 100% manual payouts |
| Supplier payouts / releases | ✅ | 🟡 | |
| Tax Center (reveal/verify/exempt, audited) | ✅ | 🟡 | pgcrypto vault |
| Users + roles + bulk specialties (CSV) | ✅ | ✅ | |
| Orgs + department structure (tree/budgets/audit) | ✅ | 🟡 | |
| Invoices (reassign dept / export) | ✅ | 🟡 | |
| Documents / vault (all orgs) | ✅ | 🟡 | |
| Compliance + templates (create/edit) | ✅ | ✅ | CCI applications |
| Inspector verification workflow | 🟡 | ✅ | mobile `verification/` |
| **Marketplace curation (feature/unfeature talent + agencies)** | ✅ | ⛔ | `CurationToggle` |
| Domains / white-label (SSL + feature toggles) | ✅ | ⛔ | multi-tenant |
| Fee schedule editor + integration secrets | ✅ | ⛔ | |
| Diagnostics console | ✅ | 🟡 | |
| Live radar (realtime monitoring) | 🟡 | ✅ | mobile super-admin |

## 7. Money, escrow & contracts (cross-cutting)
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Internal-ledger escrow (prepay / net-terms / advance) | ✅ | ✅ | numeric-dollar wallet |
| Contract-before-money gate (deals → agreements) | ✅ | ✅ | `deals/[id]/sign` |
| Brokered Deal spine (NEXPEC party to every leg) | ✅ | ✅ | hub-and-spoke graph |
| Hybrid milestone escrow + deemed-acceptance/NCR | ✅ | ✅ | `deal_payment_schedule` |
| Strict price-blindness (inspector payout / client price / spread siloed) | ✅ | ✅ | CI guard `qa:gr2` |
| Named-Disclosure VIP unlock (real Stripe charge, web) | ✅ | 🟡 | `create-disclosure-fee-intent` |
| Wallet deposits / setup intents / payment methods | ✅ | ✅ | Stripe intents EFs |
| FX rate refresh (separate subsystem) | ✅ | ✅ | `refresh-fx-rates` |
| Supplier Agreement two-party e-sign gate | ✅ | ✅ | `supplier_contracts` executed |
| Tiered Administrative Amendment Fee + revision ledger | ✅ | 🟡 | sealed arbitration docket |

## 8. Provable-AI, seals & identity
| Capability | W | M | Backend / notes |
|---|---|---|---|
| Inspector report sealing (pi_seal v3, ai_root folded) | 🟡 | ✅ | `anchor-inspection-seals` |
| OpenTimestamps Bitcoin anchoring (two-phase) | ✅ | ✅ | `confirm-inspection-anchors` |
| Evidence pack verify + receipt | ✅ | 🟡 | `EvidencePackVerifier` |
| Passport / seal credential display | ✅ | 🟡 | `passport/[sealId]` |
| Affidavit / contractor verification | ✅ | 🟡 | `verify-affidavit`, `verify-contractor` |
| Identity escrow + pseudonymity (NX- by construction) | ✅ | ✅ | zero-PII public views |
| Named-disclosure identity reveal (post-payment) | ✅ | 🟡 | money-before-benefit |

## 9. Notifications & messaging
| Capability | W | M | Backend / notes |
|---|---|---|---|
| In-app notification feed (filter/group/mark-read/mark-all) | ✅ | ✅ | |
| Notification bell + toaster (realtime) | ✅ | 🟡 | `NotificationBellLive` |
| **Push notifications (native)** | ➖ | ✅ | `usePushNotifications` (Expo) |
| Email dispatch (digests + critical) | ✅ | ✅ | `dispatch-notification-emails` |
| Critical-alert monitor (flash report → admin all, client critical-only) | ✅ | ✅ | `critical-alert-monitor` |
| **13 notification kinds** | ✅ | ✅ | message, job_moderated, application_status, assignment, report_submitted, report_approved, payout_released, review_received, contract_assigned, dispute_filed, dispute_update, document_uploaded, system |
| Realtime chat thread (multi-room) | ✅ | ✅ | `messages`/`conversations` |
| Rich composer (single attachment + formatting) | ✅ | ✅ | `RichComposer` |
| Voice note in chat | ✅ | ✅ | `VoiceRecorder` |
| **Chat silos (client↔admin & inspector↔admin only; never client↔inspector)** | ✅ | 🟡 | `conversation_kind` enum + RLS |
| Team chat fan-out notifications | ✅ | ✅ | `tg_notify_messages` (enum-equality) |

## 10. Platform / infra / cross-cutting
| Capability | W | M | Backend / notes |
|---|---|---|---|
| i18n — 7 languages (en/fr/es/de/zh/ar/fa; en=fallback) | ✅ | ✅ | `src/i18n/translations.ts`; admin EN-only |
| Locale switcher / language setting | ✅ | ✅ | |
| Global search (cross-route) | ✅ | 🟡 | `GlobalSearch` |
| Social syndication (RSS/JSON → channels) | ✅ | ➖ | |
| **RLS + pgTAP guard suite + CI gate** (`db-tests.yml`, `security-guards.yml`) | ✅ | ✅ | repo-wide |
| 36 edge functions | ✅ | ✅ | see §11 |
| Storage buckets (report-images, flash-report-attachments, client_documents, chat) | ✅ | ✅ | signed URLs, short TTL |
| Scheduled/cron (fx refresh, OTS confirm, reconcile, critical-alert) | ✅ | ✅ | EF crons |

## 11. Edge functions (36 — shared capability surface)
**Payments/Stripe (15):** create-payment-intent · create-setup-intent · create-wallet-deposit-intent · create-disclosure-fee-intent · create-stripe-connect-link · sync-stripe-connect-status · stripe-connect-redirect · stripe-connect-webhook · stripe-payments-webhook · sync-payment-method · create-stripe-payout · create-supplier-payout · process-payout · release-payment · reconcile-ledger
**Provable-AI/seals (6):** ai-analysis-worker · anchor-inspection-seals · confirm-inspection-anchors · generate-vca · verify-affidavit · verify-contractor
**Notifications/email (6):** dispatch-notification-emails · critical-alert-monitor · notify-agreement · notify-job-assigned · notify-job-event · send-consent-receipt
**Contracts/disputes (3):** generate-contract · generate-dispute-report · handle-dispute
**Ops/misc (6):** delete-account · tax-vault · tool-document · vendor-bridge-auth · refresh-fx-rates · backfill-country-of-residence

## 12. Platform-native exclusives
**Mobile-only (field/native):** offline outbox + SQLite sync · barcode/QR asset scanner · on-device AI Co-Inspector vision · native live camera compliance capture · biometric login · push notifications · voice findings drafter · "use web portal" hand-off.
**Web-only (acquisition/admin depth):** public Teaser Marketplace + all SEO surfaces (talent/agency/inspections/discover/feeds/sitemap/JSON-LD) · RSS/JSON syndication · admin marketplace curation · domains / white-label · Team Missions + in-mission team chat · global search · fee-schedule/integration-secrets editors.

---

## Known caveats baked into this matrix
- **Evidence Vault (`client_documents`)** projects columns no migration adds → web renders empty (dormant); mobile screens built but unwired.
- **`jobs.contractor_id`** is the assigned inspector (not `assigned_inspector_id`, which doesn't exist).
- **28 RLS-off + anon-open tables** still outstanding (see `CONSOLIDATION_SPRINT.md` / `project_rls_open_table_audit`) — several legacy/empty, several live-dangerous.
- **Mobile chat** appears to ride legacy `job_messages`/`chat_rooms` (open tables), not `conversations`/`messages` — reconcile during the Mobile Parity Epic.
- Team chat is the **shared buyer↔admin thread**, not a team-private back room (see §3).
