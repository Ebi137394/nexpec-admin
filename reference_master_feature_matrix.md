---
name: reference-master-feature-matrix
description: "Canonical baseline of EVERY NEXPEC feature across Web + Mobile (the 'what we have' reference); full doc at docs/MASTER_FEATURE_MATRIX.md"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 54760b3e-025a-409a-bb7c-3e502cb50675
---

**The authoritative inventory of what NEXPEC can do, per platform.** Full viewable version: `docs/MASTER_FEATURE_MATRIX.md` (generated 2026-06-25, supersedes the stale `NEXPEC_PRELAUNCH_AUDIT.md` of 2026-06-04). Legend ✅ live · 🟡 partial · ⛔ absent · ➖ N/A. W=web `apps/web`, M=mobile Expo root. One shared Supabase backend → most W/M gaps are UI-only.

**Auth:** email/pw, Google, Apple, LinkedIn(`linkedin_oidc`) — W✅ M✅. Magic-link W✅ M🟡. Role picker, role-routing, onboarding wizard+checklist — both. Biometric login M-only. 2FA W✅ M🟡(prepared). Org-invite accept both. Soft-delete/anonymize/ban (delete-account EF) both. "Use web portal" hand-off M-only.

**Public/SEO (web-native):** `/discover` teaser marketplace, `/talent/[handle]`, `/agency/[handle]`, `/inspections/[slug]` (JobPosting/Person/Org JSON-LD), `/inspectors` dir, `/p/[userId]` trust card, `/feed.xml`+`/feed.json`, sitemap/robots, marketing sections — **W✅ M⛔** (mobile has only auth-only browse-jobs + inspector-directory + `cert/[slug]`). NX- handle + TrustSigil both.

**Client/Agency/Enterprise:** dashboard, post/list/detail jobs, applications+rate, contracts/e-sign, RFQs+supplier dir, disputes, finance, reports, branding — both. Separate agency/enterprise dashboards M-stronger. **Team members+invite/revoke (roles owner/procurement_admin/project_lead/viewer)** both (`org_members`). **Team Missions list (`nx_team_jobs`) W✅ M⛔. In-mission team chat W✅ M⛔.** Budget envelopes/policies, approvals, invoices, org structure/departments — W✅ M🟡. Preferred network + live radar/risk heatmap M-stronger. Evidence Vault dormant (schema drift).

**Inspector:** dashboard, browse/apply, assignments (`jobs.contractor_id`), submit report, flash/NCR, wallet+withdraw, certs, experience, docs, tax, disputes, messages — both. **Mobile-stronger/only:** seal-report, on-device AI Co-Inspector vision, native camera compliance capture, **barcode/QR asset scanner**, offline outbox+SQLite, voice drafter, browse-jobs-map. Stripe Connect W✅ M🟡. Calendar/coordination-bridge W✅ M🟡.

**Supplier:** dashboard+matching, opportunities, quote/bid, award→sign→milestone escrow, bids, directory(anti-poaching), onboarding, finance/payouts, contracts(executed-gate), docs, support — **all both (full parity).**

**Admin (god-mode admin≡super_admin):** dashboard, audit-trail(+price redaction), jobs/moderation, contracts, messages(all rooms), disputes, reviews, treasury/payouts(100% manual), users+roles+bulk-specialties, compliance+templates(CCI), tax-center — both. **Dispatch/Spread Editor**, RFQ markup console, orgs/dept structure, invoices, vault — W✅ M🟡. **Marketplace curation W✅ M⛔. Domains/white-label W✅ M⛔.** Inspector verification + live-radar M-stronger.

**Money/contracts:** internal-ledger escrow (prepay/net-terms/advance), contract-before-money, brokered Deal spine, milestone escrow+NCR/deemed-acceptance, strict price-blindness(CI `qa:gr2`), Named-Disclosure Stripe unlock(W✅ M🟡), wallet deposits/intents, FX subsystem(separate), supplier two-party e-sign, amendment fee+revision ledger — both backends.

**Provable-AI:** pi_seal v3 sealing(M-strong), OpenTimestamps 2-phase anchoring, evidence pack verify, passport, affidavit/contractor verify, identity escrow+pseudonymity, post-payment identity reveal.

**Notifications/messaging:** in-app feed(filter/mark-read), bell+toaster, **push M-only**, email dispatch+critical monitor, realtime chat, rich composer(single attachment)+voice, **chat silos (client↔admin & inspector↔admin only)**, team fan-out. **13 notification kinds:** message, job_moderated, application_status, assignment, report_submitted, report_approved, payout_released, review_received, contract_assigned, dispute_filed, dispute_update, document_uploaded, system.

**Platform:** i18n 7 langs(en/fr/es/de/zh/ar/fa, admin EN-only), locale switcher, global search(W✅ M🟡), syndication(web-only), **RLS+pgTAP+CI gate**, storage buckets(report-images, flash-report-attachments, client_documents, chat).

**36 edge functions:** Payments/Stripe(15): create-payment-intent, create-setup-intent, create-wallet-deposit-intent, create-disclosure-fee-intent, create-stripe-connect-link, sync-stripe-connect-status, stripe-connect-redirect, stripe-connect-webhook, stripe-payments-webhook, sync-payment-method, create-stripe-payout, create-supplier-payout, process-payout, release-payment, reconcile-ledger. Provable-AI(6): ai-analysis-worker, anchor-inspection-seals, confirm-inspection-anchors, generate-vca, verify-affidavit, verify-contractor. Notify(6): dispatch-notification-emails, critical-alert-monitor, notify-agreement, notify-job-assigned, notify-job-event, send-consent-receipt. Contracts/disputes(3): generate-contract, generate-dispute-report, handle-dispute. Ops(6): delete-account, tax-vault, tool-document, vendor-bridge-auth, refresh-fx-rates, backfill-country-of-residence.

**Native exclusives — Mobile:** offline sync, barcode/QR scanner, on-device AI vision, native camera capture, biometric, push, voice drafter. **Web:** Teaser Marketplace+all SEO, syndication, marketplace curation, domains/white-label, Team Missions+in-mission team chat, global search.

**Mobile Parity Epic progress:** Phase 1 (P0 chat→conversation_id) DONE; Phase 2 (P1 drift/security) DONE; **Phase 3 DONE** — `app/discover.tsx` (public_supply_feed + public_demand_feed teaser marketplace, price-blind, NX- handles) + `app/(client)/team-missions.tsx` (nx_team_jobs, price-free) built, native dark #020420/#7C3AED, auto-routed (no (client)/_layout — files auto-register). PENDING: wire dashboard NavCard entry points to /discover + /(client)/team-missions; Phase 4 = Ghost-Mode internal team chat. See [[project_architecture_audit_hitlist]], [[project_ghost_mode_team_chat]].

**Original parity gaps (Mobile Parity Epic):** (1) public Teaser Feed, (2) Team Missions + in-mission Team Chat UI, (3) migrate mobile's LEGACY raw-job_id chat screens onto the `ensure_job_conversation`+`send_message` RPC path (the modern `useChat` hook already does this) — NOT a `job_messages`/`chat_rooms` issue (mobile doesn't use those); see [[project_architecture_audit_hitlist]] P0. See [[project_cross_platform_parity]], [[project_growth_b2b]], [[project_teaser_marketplace]], [[project_rls_open_table_audit]].

**Team chat mechanics (verified migrations 184000/186000):** team chat = the SHARED `job_client_admin` buyer↔admin thread (NOT a team-private room); teammates are added via `nx_can_team_access_conversation` (kind=`job_client_admin` AND c.user_id=COALESCE(agency_id,client_id)); inspector↔admin silo never exposed. View=any org member; post=non-viewer roles on open thread. Attachments+voice supported (single attachment/msg). Whole team can view inspection_reports (`reports_team_select` via `nx_can_team_access_job`, any role incl viewer). One dedicated buyer↔admin room per mission (conversation keyed to job_id).
