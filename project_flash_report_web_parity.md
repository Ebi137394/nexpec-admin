---
name: project_flash_report_web_parity
description: Flash Report (NCR) web parity shipped — UI-only on shared RPCs + notification trigger; decisions + the one deferred gap
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

Flash Report (NCR) brought to **web at parity with mobile**. The backend was already platform-agnostic, so this was UI-only — no schema changes for the feature itself. Shipped 2026-06-06: commit **dc44838** (web), commit **1dfa4dc** (notifications migration `20260801134000`).

**Backend reused as-is** (all SECURITY DEFINER, `authenticated`): `flash_report_create(p_job_id,p_category,p_severity,p_title,p_description,p_location_text?,p_occurred_at?,p_client_id?)`, `flash_report_add_attachment(p_flash_report_id,p_kind,p_storage_path,p_mime_type?,p_size_bytes?,p_caption?)`, `flash_report_transition(p_id,p_to_status,p_notes?)`. Reads = direct RLS-gated `.from('flash_reports')`. Evidence = private bucket `flash-report-attachments`, 15-min signed URLs. Enums: category(7)/severity(observation·minor·major·critical)/status(open→acknowledged→in_remediation→resolved→closed +disputed). Base table DDL/RLS lives at repo ROOT `20260512160000_flash_reports.sql` (NOT in supabase/migrations/).

**Web files**: `apps/web/src/lib/data/flashReports.ts` (types, label maps, verbatim `legalTransitions`, batch-signed reads), `lib/actions/flashReports.ts` (raise mints `p_client_id`=randomUUID so evidence uploads under `{reportId}/{uid}/…` satisfy the RPC's `split_part(path,'/',1)=report.id` guard + idempotency; transition uses a **portal enum** to build the return URL — no open-redirect), shared `components/flash-reports/FlashReportSection.tsx` (self-fetching async server component, `variant='page'|'panel'`) + `FlashReportCard.tsx`, and the inspector raise form `app/inspector/jobs/[id]/flash-reports/new/page.tsx` (mirrors submit-report, `has-[:checked]` tiles, no client JS). Mounted on inspector job page (Raise CTA gated to hired+active), admin `JobModerationPanel` (panel variant, between contract block & timeline), client job page. Strict reuse of existing tokens (`ink-950`/`violet`/`cyan-glow`/`accent-*`) — no new patterns. tsc + eslint clean.

**Notification policy DECISION** (migration `20260801134000`, AFTER INSERT trigger `tg_notify_flash_report_raised` via `enqueue_notification`): admins (`role::text IN ('admin','super_admin')`, excl. reporter) pinged in-app on EVERY raise + **email on critical only** (so observations don't flood inboxes); the job **client is pinged on CRITICAL severities only** (in-app + email). Bodies are identity-free (severity/category/reporter ROLE, never a name → anti-poaching intact, see [[project_public_anonymization]]). New email template kinds `flash_report.raised` / `flash_report.critical_client`.

**100% parity — admin-raise SHIPPED** (commit **e2dc61f**): web admins raise NCRs at `app/admin/jobs/[id]/flash-reports/new` + a "Raise report" CTA in the moderation panel. The raise form was extracted to the shared `components/flash-reports/FlashReportRaiseForm.tsx` (inspector + admin byte-identical), and `raiseFlashReport` is **portal-aware** (hidden `portal` enum inspector|admin → return URL only; the RPC still authorises as a party or super_admin). No remaining mobile↔web parity gaps for Flash Reports.

**Deploy**: web auto-deploys (host pushes `main` → Vercel). Migration `20260801134000` **APPLIED** — ebi ran `supabase db push` 2026-06-06; notifications are live. See [[reference_sandbox_git]] and [[project_outbox_routing_guardrail]] (mobile flash raise rides the offline outbox; web is online so it calls the RPCs directly).
