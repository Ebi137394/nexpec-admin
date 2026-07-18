# Account-Deletion Architecture — Review Package (DRAFTS ONLY)

**Nothing here is applied, deployed, committed, or pushed.** This folder is the complete review package for the account-deletion hardening under the NEXPEC non-negotiable rules (Owner protection, business-record retention, supplier guards, AI/data retention).

Artifacts:
- `20260801278000_account_deletion_hardening.DRAFT.sql` — the migration (owner protection, guard trigger, hardened RPC, provenance table). Lives under `docs/` so `supabase db push` can't pick it up.
- `delete-account.index.DRAFT.ts.txt` — hardened Edge Function (privileged-account refusal before ban).
- `LEGAL_REDLINES.DRAFT.md` — proposed ToS/Privacy/agreement wording for AI/data retention.
- This file — retention table, role matrix, threat model, test plan, changed-files list, validation.

Schema was read from the **real** baseline (`supabase/migrations/00000000000000_remote_baseline.sql`) + live migrations. No table/column names were invented; every guard references a verified name.

---

## 1. Complete data-retention table

Categories: **Personal account data** (erase/anonymize) · **Business records** (retain, tombstoned) · **Technical/AI data** (retain de-identified where licensed). "halalas == cents" per money-flow notes.

| Data / table(s) | Action | Legal / business purpose | Suggested retention | Storage |
|---|---|---|---|---|
| `profiles`: full_name, first/last, email, phone, avatar_url, bio, headline, company_name, company_logo_url, professional_title, title, location, current_project, resume_url, cv_url, push_token, report_header/footer | **Anonymize** (scrub → `Former {Role}`, keep row as tombstone) | Erasure of personal data; row retained so all FKs stay valid | Scrubbed at deletion; row persists | Postgres `profiles` |
| `profiles.id` (UUID) + `deleted_at`/`anonymized_at`/`status` | **Retain** (tombstone identity) | Stable reference for every business record; "Former Inspector"/Internal Record ID | Indefinite | Postgres |
| `auth.users` login | **Disable** (ban ~100y, **not** deleted) | Prevent re-login; deleting would orphan FKs | Indefinite (banned) | Supabase auth |
| Storage: avatars, resumes/CVs, personal docs (`client_documents`, `inspector_documents`, `profile_work_auth_documents`, `vendor_documents`) | **Delete/di­sable access** (personal) | Remove personal media | At deletion (see threat model — orphaned-file sweep) | Supabase Storage |
| `jobs`, `job_contracts`, `contracts`, `agreements`, `deals`, `milestones`, `projects`, `work_orders` | **Retain** | Contract law, audit, litigation hold | ≥ 7 years after close (PRIV §8) | Postgres |
| `reports`, `inspection_reports`, `report_templates`, `report_reminders`, report revisions (`deal_revisions`, `deal_revision_events`) | **Retain** | Deliverable integrity; downstream reliance | ≥ 7 years | Postgres |
| `flash_reports`, `flash_report_attachments` (NCRs), `findings`, `deal_nonconformances`, `asset_defect_observations`, `inspection_items`, `safety_checks` | **Retain** | Technical findings / NCR record | ≥ 7 years | Postgres |
| `inspection_assets`, `inspection_captures`, `inspection_evidence_requirements`, project images/attachments (`project_documents`, `bridge_documents`) | **Retain (de-identify)** | Evidence integrity + AI eligibility; **captures hold GPS/EXIF/face → must de-identify** | Business ≥7y; personal fields de-identified | Postgres + Storage |
| `invoices`, `payments`, `transactions`, `job_expenses`, `expenses`, `payout_requests`, `payout_advances`, `withdrawals`, `withdrawal_requests`, `wallets` (row), `supplier_earnings`, `inspector_earnings`, `platform_wallet`, `escrow_logs` | **Retain** | Tax, accounting, audit, chargeback | 7 years (tax/audit) | Postgres |
| Tax records (`tax_center_*` / vault) | **Retain** | Tax law | Per jurisdiction (often 6–7y) | Postgres/vault |
| `disputes`, `dispute_activities`, `job_disputes`, refunds/chargebacks (in `transactions`/`payment_audit_log`) | **Retain** | Dispute/fraud defense | ≥ 7 years | Postgres |
| `audit_events`, `activity_logs`, `verification_audit_log`, `payment_audit_log`, `stripe_webhook_events` | **Retain (immutable)** | Immutable audit trail; never bypass | ≥ 7 years | Postgres |
| Fraud / security records, `client_error_events`, security telemetry | **Retain** | Security/fraud investigation | 12 months telemetry; longer for incidents | Postgres |
| Required legal communications (`legal_consents`, `legal_document_acceptances`, `agreement_signatures`, `signed_agreements`) | **Retain** | Proof of consent / e-sign | Life of the record justified | Postgres |
| **De-Identified Technical Data** for AI/ML (`ai_detections`, de-identified `inspection_captures`, `asset_defect_observations`, findings features) | **Retain if licensed** (see legal redlines) | Platform + AI/ML improvement | Indefinite (once de-identified) | Postgres + dataset store |
| `ai_dataset_provenance` (new) | **Retain** | Provenance, legal basis, de-id state, retention status | Indefinite | Postgres |
| Logs / security telemetry | **Purge on schedule** | Minimization | 12 months | Postgres/log store |
| Backups | **Expire on rotation** | DR | 30 days rolling | Supabase backups |

---

## 2. Role-by-role deletion matrix

| Role | Self-serve delete? | Guards that apply | Tombstone label | Notes |
|---|---|---|---|---|
| **Inspector** | ✅ Yes | active jobs (`contractor_id`), wallet, withdrawals, payout_requests, invoices, disputes | "Former Inspector" | Reports/detections retained (de-identified) |
| **Client** | ✅ Yes | active jobs (`client_id`), wallet, invoices (`client_id`), disputes, org ownership | "Former Client" | Contracts/invoices retained |
| **Supplier** | ✅ Yes | supplier_contracts, supplier_quotes, supplier_earnings, wallet, withdrawals, disputes | "Former Supplier" | Full supplier obligation set (§C) |
| **Agency** | ✅ Yes | active jobs (`agency_id`), wallet, withdrawals, org ownership/membership | "Former Agency" | Uses `/client` web portal |
| **Enterprise** | ✅ Yes | active jobs (`client_id`), invoices, org ownership (`owner_id`), org owner-membership | "Former Enterprise User" | Enterprise = Organization; DPA §10 controller-delete also applies |
| **Admin** | ⛔ **Blocked** | RPC `ADMIN_NOT_SELF_DELETABLE` + profiles trigger + Edge fn refusal + UI hidden/blocked | n/a | 4 independent layers |
| **Super Admin** | ⛔ **Blocked** | as Admin + `LAST_SUPER_ADMIN` (last one can't be demoted/suspended/deleted) | n/a | |
| **Platform Owner** | ⛔ **Never** (any path) | `PLATFORM_OWNER_PROTECTED` at: RPC, profiles trigger (UPDATE+DELETE), Edge fn, seeder; anchored by UUID not email | n/a | Retains full admin powers; all privileged ops audited |

Owner keeps unrestricted admin capability — the guards only block *self-destruction/demotion of the owner identity*, never the owner's operational powers, and every privileged action still writes `audit_events`.

---

## 3. SQL migration diff (summary; full SQL in the `.sql` draft)

New objects (all additive, idempotent):
- `platform_owner` (singleton table, RLS-locked) + `seed_platform_owner(uuid)` (admin-only, audited).
- `nx_is_platform_owner(uuid)`, `nx_active_super_admin_count()` helpers (SECURITY DEFINER, explicit search_path).
- `nx_protect_privileged_profiles()` + `trg_nx_protect_privileged_profiles` BEFORE UPDATE/DELETE on `profiles` — owner/last-super-admin/admin protection at the DB layer.
- `request_account_deletion()` **replaced** — adds GUARD 0 (owner/admin), role-aware tombstone, GUARD 3–7 (withdrawals, invoices, disputes, supplier, org). Same self-only anonymize-in-place contract.
- `ai_dataset_provenance` (RLS-locked, admin-read) — provenance/legal-basis/de-id/retention tracking.
- Self-tests block.

No `DROP TABLE`, no `DELETE`, no destructive column changes. Reversible: drop the new objects + restore the prior `request_account_deletion` body.

---

## 4. Every changed / new source file

**New (this package, drafts under `docs/`):**
- `docs/account_deletion_hardening/20260801278000_account_deletion_hardening.DRAFT.sql`
- `docs/account_deletion_hardening/delete-account.index.DRAFT.ts.txt`
- `docs/account_deletion_hardening/LEGAL_REDLINES.DRAFT.md`
- `docs/account_deletion_hardening/README.md` (this file)

**Already in the uncommitted working tree from the prior step (unchanged this pass):**
- `apps/web/src/components/account/DangerZone.tsx` (new)
- `apps/web/src/app/account/delete/DeleteAccountFlow.tsx` (admin-blocked state, `signOut({scope:'local'})`)
- `apps/web/src/app/{inspector,client,suppliers}/settings/page.tsx` (Danger Zone section)
- `apps/web/src/components/admin/Header.tsx` (env-badge → `VERCEL_ENV` first)
- `apps/web/src/middleware.ts` (stale `sb-*` cookie hygiene; PII redaction already shipped in 69740c9)

**To change ONLY after approval (not edited here):**
- `supabase/functions/delete-account/index.ts` ← replace with the draft
- `supabase/migrations/20260801278000_*.sql` ← move the draft in
- `src/legal/bodies.ts` + `src/legal/registry.ts` ← legal redlines (version bump)
- `/account/delete` page + mobile `app/profile/security.tsx` copy ← optional wording refinements (see §UI copy below)

---

## 5. Threat model

| Vector | Attack | Mitigation |
|---|---|---|
| **Direct RPC abuse** | Authenticated user calls `request_account_deletion` directly (bypassing UI) to delete an admin/owner or dodge guards | RPC is self-only (`auth.uid()`, no caller id); GUARD 0 blocks admin/owner; all business guards run server-side in the RPC, not the UI |
| **Compromised admin session** | Stolen admin JWT tries to anonymize/ban the owner, or demote the last super_admin, via RPC/admin tools/bulk update | `nx_protect_privileged_profiles` trigger blocks owner delete/demote/suspend/anonymize and last-super-admin demotion at the DB layer — fires regardless of caller; Edge fn refuses to ban owner/admin; owner anchored by UUID (rotating the email doesn't help an attacker) |
| **Race condition** | User submits deletion twice, or settles a guard concurrently | RPC is a single statement-set in one txn; anonymize is idempotent (early-return if `deleted_at` set); guards + UPDATE run in the same transaction so a mid-flight settlement can't half-delete |
| **Stale session after deletion** | Banned token keeps hitting the API → `AuthApiError` noise / confused UI | `signOut({scope:'local'})` avoids the dead-token `/logout` 403; middleware deletes stale `sb-*` cookies on definitive 400/401/403 |
| **Orphaned files** | Storage objects (avatars/resumes/personal docs) survive profile anonymize | **Open item:** add a storage-scrub step (Edge fn or scheduled job) to remove/rekey personal buckets for the deleted uid; business evidence buckets are retained by policy. Flagged, not yet drafted — needs bucket inventory review |
| **AI dataset retention** | Personal data (GPS/EXIF/face in `inspection_captures`) retained under an AI rationale without a de-id step or legal basis | `ai_dataset_provenance` tracks de-id state + legal-basis version + retention status; legal redlines add the explicit license + no-re-identification covenant; captures must be de-identified before AI retention (not raw-retained) |
| **Platform Owner protection** | Any path (UI/mobile/RPC/edge/bulk/direct SQL) tries to remove the sole owner | 4 layers: UI block, Edge fn refusal, RPC GUARD 0, DB trigger; last-super-admin guard prevents "delete the only admin" lockout; owner is UUID-anchored, immutable role |

---

## 6. Test plan

**Positive (should succeed):**
1. Inspector with no active jobs/money → delete → row anonymized to "Former Inspector", `deleted_at` set, login banned, reports still resolve to the tombstone.
2. Client, Supplier, Agency, Enterprise (clean state) → delete → correct tombstone label; FKs to jobs/contracts/invoices still valid.
3. Idempotency: call twice → second returns `{ok:true, already:true}`, no double audit.

**Blocked (should return stable code, HTTP 200):**
4. Inspector with active job → `ACTIVE_JOBS`. 5. Wallet balance > 0 → `WALLET_NOT_EMPTY`. 6. Pending withdrawal → `PENDING_PAYOUT`; failed withdrawal → `FAILED_PAYOUT`. 7. Open invoice → `OPEN_INVOICE`. 8. Open dispute → `OPEN_DISPUTE`. 9. Supplier with executed contract → `SUPPLIER_ACTIVE_CONTRACT`; open quote → `SUPPLIER_OPEN_QUOTE`; earnings > 0 → `SUPPLIER_EARNINGS_UNSETTLED`. 10. Org owner → `ORG_OWNERSHIP_TRANSFER_REQUIRED`; owner-member → `ORG_MEMBERSHIP_TRANSFER_REQUIRED`.

**Security:**
11. Admin self-delete via UI → blocked state; via RPC → `ADMIN_NOT_SELF_DELETABLE`; via Edge fn → refusal + audit row. 12. Owner via every path → `PLATFORM_OWNER_PROTECTED`. 13. Direct SQL `UPDATE profiles SET role='client' WHERE id=owner` → trigger raises `PLATFORM_OWNER_PROTECTED`. 14. Demote last super_admin → `LAST_SUPER_ADMIN`. 15. RPC ignores any injected user id (self-only) — confirm no parameter exists.

**Rollback:** drop new objects + restore prior `request_account_deletion` body → `qa:db-refs` green; deletion reverts to pre-hardening behavior; no data loss (nothing was destroyed).

**Post-deletion verification:** (a) `SELECT full_name,email,deleted_at FROM profiles WHERE id=:uid` → tombstone + scrubbed; (b) a retained report/invoice/contract for :uid still loads and renders the tombstone label; (c) banned login cannot obtain a session; (d) `audit_events` has the `account.deletion_requested` row; (e) no FK violation anywhere (spot-check reports/contracts/invoices).

---

## 7. Validation results

See the "Validation" section in the chat response (typecheck ×3, lint, qa:outbox, qa:gr2, qa:rls-admin, qa:db-refs). The draft SQL/TS live under `docs/` so they do not enter the typecheck/db-refs scope until promoted — intentional.

---

## Open items requiring your decision
1. **Storage scrub** for personal buckets on deletion (needs bucket inventory) — not yet drafted.
2. **Supplier Agreement** creation vs. supplier_contracts AI/data article (legal redlines §4).
3. **Enterprise/controller** carve-out for de-identified derivatives (DPA-001).
4. Seed the Platform Owner UUID post-apply: `SELECT public.seed_platform_owner('<uuid>');`
