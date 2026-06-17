-- ════════════════════════════════════════════════════════════════════════════
--  20260801145000_drop_legacy_request_withdrawal_overload.sql
--
--  Remove the DEAD + INSECURE legacy overload:
--      public.request_withdrawal(p_amount numeric, p_bank_details jsonb) -> void
--
--  Why it is dead:
--    • Its body does
--        UPDATE public.wallets SET balance = balance - p_amount,
--               pending_withdrawal = pending_withdrawal + p_amount ...
--      but public.wallets has NO "pending_withdrawal" column (the live schema uses
--      available_balance / pending_amount / pending_payouts). Every call therefore
--      raises "column pending_withdrawal does not exist" — it can never succeed.
--    • No live caller. The mobile withdraw screen enqueues
--      { p_amount_cents, p_method, p_note } and the outbox adds p_client_op_id, so
--      every real call resolves to the CANONICAL overload
--        request_withdrawal(bigint, text, text, uuid) -> jsonb
--      (idempotent, balance-checked, two-bucket reserve). The only references to
--      the legacy shape were stale code comments (fixed in this change set).
--
--  Why it is insecure (defense-in-depth — remove the attack surface entirely):
--    • SECURITY DEFINER with NO `SET search_path` -> search-path injection risk.
--    • No explicit `auth.uid() IS NULL` guard.
--    • GRANT ALL ... TO anon on a money-moving RPC.
--
--  Dropping the function also drops its grants. The canonical overload is
--  untouched. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.request_withdrawal(numeric, jsonb);

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regprocedure('public.request_withdrawal(numeric, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: legacy request_withdrawal(numeric,jsonb) still present';
  END IF;
  IF to_regprocedure('public.request_withdrawal(bigint, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: canonical request_withdrawal(bigint,text,text,uuid) is missing — aborting';
  END IF;
  RAISE NOTICE 'Dropped legacy request_withdrawal(numeric,jsonb); canonical 4-arg overload intact.';
END
$selftest$;
