# Production DB Push Runbook — Final Lockdown

Pushes the four launch-blocking security migrations to production. Each migration
is transactional and self-testing: if anything is wrong, the transaction
`RAISE EXCEPTION`s and rolls back, so a failed push leaves prod unchanged.

## Migrations being applied (in order)

| Order | File | Closes |
|------|------|--------|
| 1 | `20260801218000_discover_jobs_price_blind.sql` | Inspector job-feed leaked client budget/price/spread (price-blindness). |
| 2 | `20260801220000_restore_wallet_balance_lockdown.sql` | Anyone-callable money-mint RPC. |
| 3 | `20260801222000_rls_lockdown_anon_exposed_tables.sql` | 10 RLS-off tables granted to `anon` (money/PII). |
| 4 | `20260801224000_rls_owner_tables_complete.sql` | Authenticated cross-tenant on the 4 owner-CRUD tables. |

---

## 0. Pre-flight (once)

```bash
supabase --version                     # need a recent CLI (>= 1.200)
supabase projects list                 # confirm you can see the org
supabase link --project-ref <PROD_REF> # link this repo to the PROD project (if not already)
git status                             # clean tree; you're on the release commit
git log --oneline -5                   # sanity: the 4 migrations are committed
ls supabase/migrations/202608012{18,20,22,24}000_*.sql   # all four present
```

## 1. Back up first (non-negotiable)

```bash
# Point-in-time / snapshot: take a manual backup in the Supabase dashboard
#   (Database → Backups → "Create backup") OR a logical dump:
supabase db dump --linked -f backup_pre_lockdown_$(date +%Y%m%d_%H%M).sql
```

## 2. Review what will apply

```bash
# Shows local migrations not yet on remote (the 4 above should be the only diff):
supabase migration list --linked
```

Read each of the four `.sql` files one more time. Confirm nothing else is pending.

## 3. Push

```bash
supabase db push --linked
```

Expected: four migrations apply; you'll see the `RAISE NOTICE` lines
("owner-table RLS complete…", "work_orders…" already applied, etc.). If any
self-test/guard fails, the push aborts and reports which one — fix and re-run;
prod is untouched because each migration is wrapped in BEGIN/COMMIT.

## 4. Post-push verification (run against PROD)

```bash
# a) discover_jobs is price-blind: no budget/price key in the returned job jsonb
supabase db query --linked "SELECT (job ? 'budget_cents') OR (job ? 'client_price_cents') OR (job ? 'price_cents') AS leaks, (job ? 'payout_amount_cents') AS has_payout FROM public.discover_jobs((SELECT id FROM auth.users LIMIT 1)) LIMIT 3;"
#   expect: leaks = f, has_payout = t

# b) restore_wallet_balance is NOT callable by anon/authenticated
supabase db query --linked "SELECT has_function_privilege('anon','public.restore_wallet_balance(uuid,bigint)','EXECUTE') AS anon_can, has_function_privilege('authenticated','public.restore_wallet_balance(uuid,bigint)','EXECUTE') AS auth_can;"
#   expect: anon_can = f, auth_can = f

# c) RLS enabled + anon revoked on the formerly-open tables
supabase db query --linked "SELECT c.relname, c.relrowsecurity AS rls_on, has_table_privilege('anon', format('public.%I', c.relname), 'SELECT') AS anon_can_read FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('platform_wallet','inspector_earnings','payment_audit_log','signed_agreements','inspector_documents','certifications','documents','push_token_history','chat_rooms','job_messages') ORDER BY 1;"
#   expect: every anon_can_read = f  (rls_on = t for all except the 3 user-owned which are also t after migration 4)

# d) owner policies present
supabase db query --linked "SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('inspector_documents','certifications','signed_agreements','documents') ORDER BY 1;"
#   expect: 4 rows (…_owner_all ×3 + documents_org_read)
```

## 5. App smoke test (authenticated, NOT admin)

- Inspector: open Discover/Map → jobs show **payout**, never a client budget.
- Inspector: upload a verification doc + a certification → succeeds; cannot see another inspector's docs.
- Client: post a job → it enters **pending_approval** (not visible to inspectors until admin approves).
- Wallet balances render; withdrawal request still works (manual payout path).

## 6. Rollback (only if needed)

Each migration is `CREATE OR REPLACE` / additive-policy, so forward-fix is preferred.
If a hard rollback is required, restore the pre-push backup from step 1, or apply a
revert migration that re-creates the prior function bodies. Do **not** simply
re-grant `anon` to "unbreak" something — that re-opens the hole.

---

**After step 4 passes, the launch-blocking class is sealed in production.**
