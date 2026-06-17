-- ════════════════════════════════════════════════════════════════════════════
--  20260801142000_lockdown_remaining_money_tables.sql
--
--  The RLS deny-matrix (supabase/tests/rls_money_matrix_test.sql) caught two more
--  live TRUNCATE exposures the 141000 lockdown didn't cover:
--    • invoices            — authenticated could TRUNCATE the invoice ledger
--      (the 20260801139000 revoke was archived in the squash and is not present
--      in the prod baseline).
--    • withdrawal_requests — TRUNCATE only blocked incidentally by a FK (0A000),
--      not by privilege; authenticated still holds TRUNCATE.
--    • payout_advances     — same class; hardened proactively.
--
--  Revoke TRUNCATE/REFERENCES/TRIGGER from authenticated and ALL from anon/PUBLIC
--  on all three (RLS already gates row reads/writes; these tables' writes happen
--  via SECURITY DEFINER RPCs). Keep authenticated SELECT/INSERT/UPDATE/DELETE
--  (RLS-gated). Guarded + idempotent.
-- ════════════════════════════════════════════════════════════════════════════

DO $lock$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['public.invoices','public.withdrawal_requests','public.payout_advances']
  LOOP
    IF to_regclass(r) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon', r);
      EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM authenticated', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO authenticated', r);
      EXECUTE format('GRANT ALL ON TABLE %s TO service_role', r);
    END IF;
  END LOOP;
END
$lock$;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.invoices') IS NOT NULL
     AND has_table_privilege('authenticated','public.invoices','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated still holds TRUNCATE on invoices'; END IF;
  IF to_regclass('public.withdrawal_requests') IS NOT NULL
     AND has_table_privilege('authenticated','public.withdrawal_requests','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated still holds TRUNCATE on withdrawal_requests'; END IF;
  IF to_regclass('public.payout_advances') IS NOT NULL
     AND has_table_privilege('authenticated','public.payout_advances','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated still holds TRUNCATE on payout_advances'; END IF;
  RAISE NOTICE 'invoices/withdrawal_requests/payout_advances: TRUNCATE + anon revoked.';
END
$selftest$;
