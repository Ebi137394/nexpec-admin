---
name: nexpec-golden-rules
description: "The 7 non-negotiable NEXPEC business rules — admin-brokered job flow, strict price-blindness, siloed chats; enforce in EVERY feature"
metadata: 
  node_type: memory
  type: project
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

**BROKER-FLOW ENFORCEMENT (Wave 4, 2026-06-25):** a BUYER surface (client/agency, web OR mobile) may ONLY set `applications.status='CLIENT_SELECTED'` (nominate) — it must NEVER call `assign_job_contractor`/`assignJobContractor`, insert a contract, or mutate `jobs.contractor_id`/`status`. Only the NEXPEC admin finalises pricing + dispatch (`admin_dispatch_job`/`admin_set_job_pricing`) and generates the contract (`admin_generate_job_contract`). Canonical web action = `lib/actions/applications.ts` selectApplication (CLIENT_SELECTED, touches no jobs). Mobile was self-assigning via assignJobContractor in 4 screens (`(shared)/job-details`, `(shared)/agency-job-details`, `agency-job-details`, `(client)/job/[id]` — the last also illegally inserted a legacy `contracts` row that REVOKE was throwing on) → all converted to CLIENT_SELECTED; assignJobContractor now has 0 callers in app/. There's a `guard_jobs_status_transition_trigger` that rejects wrong-actor job-status writes — buyer-side jobs writes trip it.

ebi's **7 NEXPEC GOLDEN RULES** (locked 2026-05-31, NON-NEGOTIABLE — enforce in every Tier-4+ feature: Assignments, Job Details, Reports, Chat, Apply/Bid):

1. **Job creation & moderation** — Client posts a job → it goes to Admin. Admin moderates it and sets the **Inspector Price** (payout).
2. **Strict price-blindness** — Client/Agency NEVER see the Inspector Price; they see only their own budget (`jobs.client_price_cents`). The Inspector sees ONLY the admin-set Inspector Price (`jobs.inspector_payout_cents` / legacy `payout_amount_cents`), NEVER the client's budget. `jobs.platform_spread_cents` (= client_price − inspector_payout, GENERATED) is admin-only — never expose to either side.
3. **Dispatch & application** — Admin dispatches the job (`admin_dispatch_job`) → inspectors see it and apply.
4. **Client review via admin only** — Client reviews the inspector's resume/profile. If they need documents or have questions, they CANNOT contact the inspector directly — they leave a comment/chat for the Admin.
5. **Final selection** — Admin reviews everything and makes the final decision to officially assign the inspector.
6. **Report flow** — Inspector finishes → submits the report TO THE ADMIN. Admin reviews → if approved, admin forwards it to the Client for final confirmation/closure. In code this is `jobs.admin_confirmed_at` (GOLDEN_RULE_6) gating client visibility — see client Deliverables.
7. **Isolated chat rooms** — Per project, comms are strictly siloed: a Client↔Admin room and an Inspector↔Admin room. ZERO direct Client↔Inspector communication.

**How to apply (checklist for every build):** never select/expose `client_price_cents` to an inspector or `inspector_payout_cents`/`platform_spread_cents` to a client; report-submit actions route to ADMIN (not client); any chat/comment surface must be admin-mediated (never a client↔inspector channel); job visibility for clients is gated on `admin_confirmed_at`. Verified compliant: mobile Client Reports/Deliverables (admin_confirmed_at + client_price only) and Inspector Assignments (inspector_payout only; submit-report → admin). See [[reference-nexpec-schema-gotchas]], [[feedback-god-mode-admin]].

**Implementing features (the rules are already built — found 2026-05-31):**
- **Inspector bidding** — inspectors propose their own price when applying (`applications.bid_amount_cents`; migration `20260518340000_signed_docs_and_application_bid_visibility.sql`; web `inspectorApply.ts`, mobile `(inspector)/jobs/[id]/apply.tsx` + `jobs/[id]/submit-proposal.tsx`).
- **Admin counter-offer / negotiation loop** — admin counters a bid (`applications.admin_counter_cents`, `admin_countered_at/by`, `negotiation_status` ∈ none/admin_countered/counter_accepted/counter_rejected; RPC `admin_counter_application`; migration `20260518350000_negotiation_loop_and_apps_rls.sql`); inspector accepts/rejects via mobile `(inspector)/negotiations.tsx` (the dashboard "Negotiations Inbox").
- **Blind pricing** (enforces GR2) — `inspector_job_contracts_view` + `job_contracts` carry only the admin-set `inspector_payout_cents`; migration `20260518370000_job_contracts_blind_pricing_and_notifications_v2.sql`.
- **Isolated chat rooms** (enforces GR7) — `conversations`/messages typed `client_admin` vs `inspector_admin` (no client↔inspector); migration `20260518160000_conversations_and_messages_v2.sql` + `20260518240000_chat_attachments_bucket.sql`.
- Contract signing (`ContractSignScreen.tsx`, `src/core/services/contracts.ts`).
