# NEXPEC — Operational Workflow Master Plan
### Report Reminders · Cross-Party Meeting Hub · and the ops toolkit a multi-million-dollar inspection firm runs on

Grounded in a live recon of the codebase. Both requested features are **missing today** — but every primitive needed to build them already exists, so these are assembly jobs, not greenfield.

**What we already have (the foundation):** `pg_cron` + `pg_net` are enabled and proven (the FX-rate scheduler + a 5-minute `dispatch-notification-emails` cron); `jobs.scheduled_date` is the inspection-timeframe anchor; `pi_report_seals` is the authoritative "report submitted" signal; `nx_notify` / `nx_notify_admins` deliver consent-respecting notifications; and `coordination_bridges` is a *precedent for admin-brokered cross-party interaction* we can extend.

---

## Feature 1 — Automated Report Reminders ("SLA Sentinel")

**Status: not present.** No overdue-report logic exists.

**The design — escalating, idempotent, $0.** A naive "ping the inspector" is amateur. A high-end firm runs an **escalation ladder with an audit trail**:

1. **Detection** — a `SECURITY DEFINER` function `sweep_overdue_reports()` selects jobs where `status IN ('assigned','in_progress')` AND `scheduled_date < now()` AND **no sealed report exists** (`NOT EXISTS` against `pi_report_seals`). That's "the inspection window passed but the report isn't in."

2. **Escalation ladder** — a small `report_reminders` ledger (`job_id, stage, sent_at`, unique on `job_id+stage`) makes each reminder fire **once** and escalate over time:
   - **Stage 1 — overdue +0h:** gentle nudge → inspector ("Your report for *X* is due").
   - **Stage 2 — +24h:** firmer → inspector, **CC admin**.
   - **Stage 3 — +72h:** escalate → admin queue as an **"at-risk report"**, flag the job. (Optionally notify the client's account manager that NEXPEC is actively chasing — reinforces the broker relationship without exposing the inspector.)
   The ledger is what makes it idempotent: the 6-hourly sweep never double-pings.

3. **Schedule** — `cron.schedule('report-reminder-sweep', '0 */6 * * *', …)` → `net.http_post` → an edge function that calls the sweep RPC and emits `nx_notify` per due stage. Exact mirror of the FX-scheduler pattern already in production.

4. **Surfacing** — an **"At-risk reports"** KPI on the Admin Command Center; a red **"Report due"** banner on the inspector's job screen with a countdown.

**SLA clock (the polish):** derive *due-by* = `scheduled_date + per-scope SLA` (e.g. 48h) so the countdown is real, not guesswork. The SLA per discipline lives in the scope catalogue.

**Cost:** zero — pure `pg_cron` + `nx_notify`. No third-party service.

---

## Feature 2 — Cross-Party Meeting Hub ("Brokered War Room")

**Status: not present.** (`LiveStreamHub` is live inspection *streaming* — a different thing.)

**⚠ The architecture trap, and the genius move.** NEXPEC's #1 golden rule is **zero direct client↔inspector contact** (siloed chats, anti-poaching). A naive "Client + Inspector + Vendor video call" *directly violates* this — it hands them a back-channel to swap contact details and bypass NEXPEC. So the Meeting Hub must be **admin-brokered by construction**, which turns a disintermediation *risk* into a trust *feature*:

- **NEXPEC-hosted war room, not a private line.** Any meeting whose participants include **both** a client-side and an inspector-side party **must include an admin host** — enforced in the RPC, not the UI. Admin is the broker, on the call.
- **BYO-link, provider-agnostic, $0.** The organizer pastes a Zoom / Teams / Google Meet / Jitsi URL. NEXPEC **stores, shares, notifies, launches, and audits** the link — it never hosts video, so there's no OAuth, no per-seat cost, no vendor lock-in.

**Schema:**
- `job_meetings` — `id, job_id?, rfq_id?, bridge_id?, organizer_id, provider, url, title, scheduled_at, duration_min, status (scheduled|live|ended|cancelled), created_by, created_at`. It attaches to a **Job** *or* an **RFQ** workspace (the "directly within" requirement), or a `coordination_bridge`.
- `job_meeting_participants` — `meeting_id, user_id, party_role (client|inspector|vendor|admin), invited_at`. This set **is** the access boundary *and* the golden-rule guard.

**Enforcement RPC** `schedule_meeting(...)`: validates the caller may convene the parties, and **rejects any client+inspector pairing without an admin participant**. RLS: a user sees only meetings they're a participant on; admin (god-mode) sees all. Every create/launch is written to `audit_events` — industrial clients need a defensible record of who met, when, about which job.

**UX:** one reusable **Meetings panel** dropped into the Job and RFQ workspaces (web + mobile), showing upcoming/past meetings with a **Launch** button (`window.open` / `Linking.openURL`). `nx_notify` fires on schedule and a "starting in 15 min" nudge (reuse the Sentinel cron).

---

## Feature 3+ — the surprise: ops tools a top-tier firm also expects

Ranked by leverage:

1. **Audit-ready Activity Timeline** — a unified, one-click chronology per Job/RFQ built from `audit_events` ("show me everything that happened"). Auditors and disputes live on this.
2. **Inspector availability & capacity calendar** — dispatch by who's actually free; admin sees a heatmap. Pairs with…
3. **Capacity-aware dispatch suggestions** — a ranked inspector list by discipline + proximity + availability (we already built exactly this for vendors via `supplier_match`; mirror it for inspectors).
4. **Generalized SLA & escalation matrix** — extend the Sentinel to *all* clocks: quote-response, dispute-resolution, payout-release, document-expiry.
5. **Document expiry engine** — the Vendor Custody cert-expiry reminders, on the same cron.
6. **Acknowledgment / read-receipts** — an inspector must *ACK* a dispatch; unacked → escalate.
7. **Recurring & template RFQs** — repeat buyers re-issue standard scopes in one tap.
8. **Award approval routing / multi-sig** for high-value awards (extends the existing budget-envelope approvals).
9. **Calendar (ICS) export** for inspections + meetings, so they land in Outlook/Google.

---

## Recommended build order

- **Phase A — SLA Sentinel (report reminders).** Highest operational value, all infra ready: 1 migration (`report_reminders` + `sweep_overdue_reports` + cron) + 1 edge function + small banners/KPI. Shippable fast.
- **Phase B — Brokered War Room (meeting hub).** 1 migration (tables + RLS + `schedule_meeting` guard RPC) + a reusable Meetings panel (web + mobile) + launch + notifications.
- **Phase C — pick from the surprise list.** I'd start with the **Audit-ready Timeline** (cheap, built from existing `audit_events`) and the **availability calendar** (unlocks smarter dispatch).

Every line of this rides infrastructure you already own. Nothing here needs a new vendor, a new cost, or a break in the golden rules — in fact the Meeting Hub *strengthens* them.
