# NEXPEC Deploy Runbook — DB + Edge Functions

**Scope of this pass:** Supabase **DB** (migrations through `20260801120800` + `seed.sql`) and **Edge Functions**. Web (`apps/web`) and mobile (EAS/OTA) are **not** in this pass.

**Strategy:** clean-DB dry-run first → then apply to the target project → then functions.

> Division of labor: the privileged commands run on your linked machine / Dashboard (the sandbox can't reach your prod infra). Everything below is copy-paste ready.

---

## Stage 0 — Static pre-validation (already done, in-repo)

A structural validator parsed every seed row (not just grep):

- `country_codes` = **249**, all unique, all pass the `^[A-Z]{2}$` CHECK, every `region_group` ∈ {EU, EEA, GCC, USMCA}.
- `inspection_scope_templates` = **60**, unique ids + slugs, valid UUIDs, slugs pass `^[a-z0-9_]+$`, every enum cast well-formed and within the real label sets (`cci_basic/cci_advanced/cci_lead`, and the 5 inspection domains).
- `20260801120800` dollar-quote blocks balanced (22 `$$`, 11 `DO` blocks).

This catches transcription-class errors. It does **not** replace a real load — that's Stage A.

---

## Stage A — Clean-DB dry-run (local, authoritative)

This exercises the **entire** from-scratch path (all 149 migrations in order + `seed.sql`) against the real Supabase stack (Postgres + `auth`/`storage` schemas + `anon`/`authenticated`/`service_role` roles), which a bare Postgres can't replicate.

```bash
cd /path/to/nexpec
supabase start          # boots the local full stack (Docker)
supabase db reset       # drops, replays ALL migrations in order, then runs supabase/seed.sql
```

`supabase db reset` runs `supabase/seed.sql` automatically. If your CLI/config doesn't, add this to `config.toml` and re-run:

```toml
[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

**Acceptance checks:**

```bash
# counts
psql "$(supabase status -o env | sed -n 's/^DB_URL=//p')" -c \
"select (select count(*) from public.country_codes) as codes,
        (select count(*) from public.inspection_scope_templates) as templates;"
# expect: codes=249, templates=60

# FK realism: a job referencing seeded rows must insert clean
psql "$(supabase status -o env | sed -n 's/^DB_URL=//p')" -c \
"insert into public.jobs (job_country, scope_template_id)
 values ('AE', (select id from public.inspection_scope_templates limit 1)) returning id;"
```

Then paste `docs/ops/ghost-ddl-introspection.sql` into the local Studio SQL editor and confirm the four ghost tables' columns/constraints/indexes/RLS/triggers match `20260801120800`.

**Fallback if Docker is unavailable:** spin up a throwaway Supabase project, paste the migrations in order then `seed.sql` in its SQL editor, run the same acceptance checks, then delete the project. (Avoid `supabase db push` if the management API still times out for you.)

---

## Stage B — Apply DB to the target project

The target already has the baseline + earlier migrations, so apply only what's **pending**, in lexicographic order. Pending set from this work stream:

1. `20260801120500_doc_intelligence_foundation.sql`
2. `20260801120600_seal_v4_doc_root_and_pack.sql`
3. `20260801120700_adopt_ghost_fk_target_tables.sql`
4. `20260801120800_reconcile_ghost_tables_to_live.sql`
5. `supabase/seed.sql`

> Confirm against your migration history — apply anything else still pending in filename order first.

**Method (your established one):** Supabase Dashboard → SQL editor → paste each file in order → run. All four migrations are guarded/idempotent and `seed.sql` is UPSERT, so the whole sequence is safe to re-run.

**Verify:** re-run `docs/ops/ghost-ddl-introspection.sql` → 249/60 + schema matches.

---

## Stage C — Edge Functions

### C1. Fix `verify_jwt` FIRST (critical — do before deploy)

Today `config.toml` only configures 3 functions; everything else defaults to `verify_jwt = true`. Endpoints that authenticate by **Stripe signature / shared secret / raw token / cron secret** carry **no Supabase JWT**, so they'd return **401** in production (silent webhook failures, dead worker, broken vendor portal). Also: the existing `[functions.sync-payment-methods]` block points at a directory that doesn't exist (real dirs: `sync-payment-method`, `sync-stripe-connect-status`) — remove or rename it.

Set `verify_jwt = false` only where the caller cannot present a Supabase JWT:

| Function | verify_jwt | Why |
|---|---|---|
| `stripe-payments-webhook` | **false** | Stripe calls it; verified via `STRIPE_PAYMENTS_WEBHOOK_SECRET` |
| `stripe-connect-webhook` | **false** | Stripe calls it; `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `stripe-connect-redirect` | **false** | Public browser redirect |
| `ai-analysis-worker` | **false** | In-house worker auths via `x-worker-secret` (`WORKER_SHARED_SECRET`) |
| `vendor-bridge-auth` | **false** | Vendors have no account; raw bridge token |
| `dispatch-notification-emails` | **false** | Cron-invoked via `CRON_SECRET` |
| `refresh-fx-rates` | **false** | Cron-invoked via `CRON_SECRET` |
| `critical-alert-monitor` | **false*** | `WEBHOOK_SECRET` / external cron — *confirm caller |
| `verify-affidavit`, `verify-contractor` | **false*** | Public trust-verification surfaces — *confirm |
| All `create-*`, `process-payout`, `release-payment`, `sync-payment-method`, `sync-stripe-connect-status`, `handle-dispute`, `generate-*`, `notify-*`, `anchor-/confirm-inspection-*`, `send-consent-receipt`, `backfill-*` | **true** | Invoked with a user or service-role JWT |

Paste-ready blocks (append to `config.toml`, drop the stale `sync-payment-methods` block):

```toml
[functions.stripe-payments-webhook]
enabled = true
verify_jwt = false

[functions.stripe-connect-webhook]
enabled = true
verify_jwt = false

[functions.stripe-connect-redirect]
enabled = true
verify_jwt = false

[functions.ai-analysis-worker]
enabled = true
verify_jwt = false

[functions.vendor-bridge-auth]
enabled = true
verify_jwt = false

[functions.dispatch-notification-emails]
enabled = true
verify_jwt = false

[functions.refresh-fx-rates]
enabled = true
verify_jwt = false
```

(If you'd rather not edit config for a one-off, deploy those with `--no-verify-jwt`.)

### C2. Set function secrets (never commit these)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` are **auto-injected** by the platform — do **not** set them (the `SUPABASE_` prefix is reserved and will be rejected). Set the rest:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=... \
  STRIPE_PAYMENTS_WEBHOOK_SECRET=... \
  STRIPE_CONNECT_WEBHOOK_SECRET=... \
  WORKER_SHARED_SECRET=... \
  NEXPEC_SIGNING_KEY_ID=... \
  NEXPEC_SIGNING_KEY_PRIVATE_PEM="$(cat signing_key.pem)" \
  NEXPEC_VERIFY_BASE_URL=... \
  APP_BASE_URL=... \
  NEXPEC_URL=... \
  CRON_SECRET=... \
  WEBHOOK_SECRET=... \
  RESEND_API_KEY=... RESEND_FROM_EMAIL=... EMAIL_FROM=... FROM_EMAIL=... \
  OPENEXCHANGERATES_APP_ID=... \
  BROWSERLESS_API_KEY=... \
  SLACK_WEBHOOK_URL=... TEAMS_WEBHOOK_URL=...
```

What breaks if a secret is missing (from code scan):

| Secret | Functions that need it |
|---|---|
| `STRIPE_SECRET_KEY` | create-payment-intent, create-setup-intent, create-stripe-connect-link, create-stripe-payout, create-wallet-deposit-intent, process-payout, sync-payment-method, sync-stripe-connect-status, both webhooks |
| `STRIPE_PAYMENTS_WEBHOOK_SECRET` | stripe-payments-webhook |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | stripe-connect-webhook |
| `WORKER_SHARED_SECRET` | ai-analysis-worker |
| `NEXPEC_SIGNING_KEY_ID`, `NEXPEC_SIGNING_KEY_PRIVATE_PEM`, `NEXPEC_VERIFY_BASE_URL` | generate-vca |
| `RESEND_API_KEY` | dispatch-notification-emails, handle-dispute, notify-job-assigned, send-consent-receipt, generate-contract |
| `NEXPEC_URL` | generate-contract (reads `process.env`, not `Deno.env.get`) |
| `CRON_SECRET` | dispatch-notification-emails, refresh-fx-rates |
| `OPENEXCHANGERATES_APP_ID` | refresh-fx-rates |
| `BROWSERLESS_API_KEY` | generate-vca |
| `WEBHOOK_SECRET`, `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` | critical-alert-monitor |
| `APP_BASE_URL`, `EMAIL_FROM`/`FROM_EMAIL`, `RESEND_FROM_EMAIL` | email/notification + dispute flows |

**Stripe webhook chicken-and-egg:** create the webhook endpoints in the Stripe Dashboard pointing at the (to-be) function URLs → copy each signing secret → `supabase secrets set` them → then deploy. After deploy, send a test event and confirm 200.

### C3. Deploy

```bash
# everything (honors config.toml verify_jwt):
supabase functions deploy

# or the changed/critical set only:
supabase functions deploy \
  ai-analysis-worker vendor-bridge-auth notify-job-event \
  stripe-payments-webhook stripe-connect-webhook \
  process-payout create-setup-intent create-stripe-connect-link \
  sync-payment-method sync-stripe-connect-status
```

---

## Stage D — Smoke verification

- **DB:** counts 249/60; the `jobs` FK insert from Stage A succeeds against the target.
- **Stripe:** trigger a test event from the Stripe Dashboard → 200; replay the same event → idempotent (no double-processing, thanks to the webhook claim pattern).
- **Worker:** `curl` `ai-analysis-worker` with the correct `x-worker-secret` → 200; missing/wrong → 401.
- **Vendor:** a `vendor-bridge-auth` call with a raw bridge token succeeds with no Authorization header.
- **Notifications:** `notify-job-event` writes the in-app row always, and only sends push when `should_deliver(...,'push')` is true.

---

## Rollback

- **DB:** additive + idempotent; `seed.sql` is UPSERT (no deletes). The only drop is the redundant `organizations_kind_chk` (the canonical `organizations_kind_check` remains). Re-applying is safe.
- **Functions:** redeploy the previous git ref; secrets are unchanged. Keep the prior Stripe webhook endpoints until the new ones return 200.

---
---

# 🚀 Turnkey Vendor Sprint — Production Launch (2026-06-04)

Ships: Turnkey RFQ→inspection auto-spawn, Vendor Custody Spine, Supplier Ecosystem + Dashboard, SLA Sentinel, Brokered War Room, full web parity, and the landing/sign-up copy refresh. **Order of operations: DB first, then web** — the app's new reads depend on `122900` being live.

## Phase 0 — Pre-flight (do not skip)

1. **Snapshot production DB.** Supabase → Database → Backups → manual/PITR restore point. Several migrations are `DROP+CREATE` (`create_rfq`, `supplier_onboard` signature changes); the snapshot is the rollback.
2. **Local green light** — the web build is now strict (`ignoreBuildErrors` / `ignoreDuringBuilds` were removed; a TS or ESLint error fails the Vercel deploy):
   ```bash
   cd apps/web && npm run typecheck && npm run build
   ```
3. **Clean tree:** `git status`.

## Phase 1 — Production Supabase (apply IN ORDER)

Apply via the Dashboard SQL editor. All are idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS` / `ON CONFLICT`) — re-running an already-applied one is safe. Each ends with a `RAISE NOTICE` self-test.

```
20260801121800  turnkey_procurement_qaqc
20260801121900  rfq_scope_aware_create
20260801122000  supplier_onboard_headline
20260801122100  submit_quote_multi_supplier
20260801122200  handle_new_user_supplier_role
20260801122300  rfq_supplier_quoted_visibility
20260801122400  vendor_custody_core
20260801122500  turnkey_concurrency_hardening
20260801122600  rfq_lifecycle_notifications
20260801122700  sla_sentinel_report_reminders
20260801122800  brokered_war_room
20260801122900  rls_recursion_hardening          ← CRITICAL (kills 42P17 recursion)
20260801123000  apply_onboarding_role_supplier
```

Post-apply verification:
```sql
select jobname, schedule from cron.job where jobname = 'nexpec-report-reminder-sweep';
select 1 from supplier_rfqs limit 1;   -- must NOT raise 42P17
select id from storage.buckets where id = 'vendor_documents';
```

Manual Supabase steps:
- Confirm **LinkedIn (OIDC)** provider enabled (Auth → Providers) + prod redirect URLs.
- ⚠ **`brokerage_setup.sql`** is non-timestamped — never let `supabase db push` run it (it sorts last). Apply via dashboard only; long-term, rename with a timestamp or delete.

## Phase 2 — Git (feature-grouped conventional commits)

```bash
git checkout -b release/turnkey-vendor-sprint

git add supabase/migrations
git commit -m "feat(db): turnkey RFQ→inspection, vendor custody spine, SLA sentinel, brokered war room, RLS recursion + role hardening"

git add app src
git commit -m "feat(mobile): supplier ecosystem + dashboard, DocumentField custody, meetings panel, SLA sentinel UI"

git add apps/web
git commit -m "feat(web): RFQ engine, vendor custody, supplier dashboard, meetings, sentinel UI, vendor signup + landing copy"

git add docs
git commit -m "docs: vendor custody + operational masterplans, final audit, deploy runbook"

git push origin release/turnkey-vendor-sprint
# → open PR → review diff → merge to main (Vercel deploys on merge)
```

## Phase 3 — Vercel (web)

1. Production env vars present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ENV`, `NEXT_PUBLIC_BRIDGE_PORTAL_BASE_URL`, `OWNER_EMAILS`, and server-only `SUPABASE_SERVICE_ROLE_KEY`.
2. Monorepo: Root Directory points at `apps/web` (or the build command targets that workspace).
3. Strict build — deploy fails on any TS/ESLint error (Phase 0 protects you).
4. Verify the **Preview** deployment before promoting.

Live smoke test:
- Landing renders; How-It-Works + Trust pillars show the new copy.
- `/sign-up` shows 5 role cards incl **Vendor**; vendor signup → `/suppliers/dashboard`.
- `/rfqs` + `/suppliers` load (no 42P17); admin job → "Workspace & meetings" War Room.
- Admin dashboard shows the At-risk reports ribbon when applicable.

## Phase 4 — Mobile (OTA)

JS/TS-only sprint — no native changes:
```bash
eas update --branch production --message "Turnkey vendor sprint: supplier ecosystem, custody, meetings, sentinel"
```

## Rollback

Vercel → "Promote previous deployment". Database → restore the Phase 0 snapshot. Migrations are additive/idempotent, but the `DROP+CREATE` function-signature changes are why the snapshot exists.
