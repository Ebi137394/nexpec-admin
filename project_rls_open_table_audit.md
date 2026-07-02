---
name: project-rls-open-table-audit
description: CRITICAL Phase-1 finding — ~28 public tables still RLS-off + anon-granted (wide open); the next security epic
metadata: 
  node_type: memory
  type: project
  originSessionId: 54760b3e-025a-409a-bb7c-3e502cb50675
---

**Consolidation Sprint Phase 1 (2026-06-25) found the big one.** A migration-history sweep (baseline CREATE TABLE minus every `ENABLE ROW LEVEL SECURITY`, intersected with anon grants minus every `REVOKE … FROM anon`) shows **~28 public tables that are STILL RLS-off AND anon-granted = readable/writable by anyone with the public anon key.** The `messages`/`payment_methods`/`work_orders`/`legal_consents` lockdown ([[reference_nexpec_schema_gotchas]], migration 196000) was the tip of the iceberg.

**🔴 High-severity open tables (money/contracts/PII/chat):** `inspector_earnings`, `platform_wallet`, `payment_audit_log`, `signed_agreements`, `documents`, `project_documents`, `inspector_documents`, `chat_rooms`, `job_messages`, `certifications`, `inspector_certifications`, `push_token_history`.
**🟠 Medium:** assets, equipment, projects, milestones, form_submissions, form_drafts, form_templates, work_experience, activity_logs, notification_settings, admin_notification_settings, alerts, badges, user_badges, error_logs, legal_templates.

**CAVEAT — verify before acting:** (1) the money-table lockdown (141000–144000) already covered `wallets`/`transactions`/`supplier_earnings`/withdrawals (NOT these), so `inspector_earnings`/`platform_wallet`/`payment_audit_log` are genuinely-separate older tables left open; (2) several are likely LEGACY/empty, superseded by newer tables (`projects`→`jobs`, `assets`→`inspection_assets` per the pre-existing-assets gotcha, `job_messages`/`chat_rooms`→`conversations`/`messages`). Anon-grant only matters if the table holds live data. (3) god-mode migrations 146000–148000 did NOT touch any of these 28 (different table list), so they're not silently covered.

**AUTHORITATIVE live check (run on prod + local) — this is the source of truth, not the migration grep:**
```sql
select c.relname, c.relrowsecurity as rls_on,
       has_table_privilege('anon', format('public.%I', c.relname),'SELECT') as anon_select,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
from pg_class c
where c.relnamespace='public'::regnamespace and c.relkind='r'
  and c.relrowsecurity=false
  and has_table_privilege('anon', format('public.%I', c.relname),'SELECT')=true
order by 1;
```
Then `select count(*) from <t>` each hit to split live-dangerous from legacy-empty.

**Remediation = next epic (same discipline as 196000):** per live table → `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL … FROM anon[,authenticated]` + owner/party policies + god-mode admin overlay; legacy/empty → revoke + deny-all RLS or drop. Add **`supabase/tests/rls_open_tables_test.sql`** pgTAP asserting anon can't SELECT any non-reference table → the `db-tests.yml` CI gate blocks this class forever.

**Also surfaced (Phase 2 mobile breakage under 196000):** `useOperationsData.ts` reads `work_orders` by `organization_id` only — new policy keys off owner/client/inspector/user id, NOT org → dashboards go empty; `consentService.ts` reads/writes `legal_consents` by a userId PARAM (not auth.uid()) → breaks; mobile chat appears to ride the OPEN `job_messages`/`chat_rooms` legacy tables, not `conversations`/`messages` → reconcile.

Full report: `docs/CONSOLIDATION_SPRINT.md` (Phase 1 audit + Phase 2 parity + Phase 3 web-vs-mobile matrix). See [[project_money_perimeter_hardened]], [[project_financial_security_crisis]], [[reference_nexpec_schema_gotchas]].
