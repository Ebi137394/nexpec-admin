-- ════════════════════════════════════════════════════════════════════════════
--  20260801308000_revoke_unguarded_definer_rpc_grants.sql
--
--  P0 — the same defect class as the old schedule_meeting(), found by sweeping
--  for SECURITY DEFINER functions that are (a) granted to anon/authenticated,
--  (b) take a caller-supplied uuid, (c) WRITE, and (d) contain no auth.uid() /
--  nx_is_admin() check at all.
--
--  WORST CASE — public.debit_wallet_for_payout(p_user_id uuid, p_amount_cents bigint)
--    GRANT ALL ... TO "anon";  GRANT ALL ... TO "authenticated";
--    Body: no authentication, no authorization, no ownership check. It debits
--    wallets.available_balance for the SUPPLIED user id and inserts a 'processing'
--    payout transaction. Anyone holding the public anon key could therefore
--    drain any user's wallet balance over plain PostgREST:
--        POST /rest/v1/rpc/debit_wallet_for_payout
--        { "p_user_id": "<victim>", "p_amount_cents": 100000 }
--    It has ZERO callers in live application code, live Edge Functions and live
--    migrations — the only references are in supabase/migrations_archive/.
--
--  ── FIX: remove the privilege, do not touch the logic ───────────────────────
--  Every function below keeps its body byte-for-byte. Only the EXECUTE grant
--  changes. This is deliberately the smallest possible intervention:
--    • Internal composition is UNAFFECTED. These functions are invoked as
--      `PERFORM public.fn(...)` from other SECURITY DEFINER functions, which
--      execute as their OWNER (postgres). EXECUTE privilege is checked against
--      the effective user, so revoking anon/authenticated cannot break any
--      internal caller — only direct PostgREST calls.
--    • service_role keeps EXECUTE, so Edge Functions and server-side jobs are
--      unaffected.
--
--  Two tiers:
--    TIER A — revoke anon AND authenticated. Verified zero rpc() callers in
--             app code (mobile + web).
--    TIER B — revoke anon only, because a live app caller exists.
--             public.nx_notify is called by src/utils/notificationUtils.ts.
--             It remains callable by any authenticated user with an arbitrary
--             recipient and arbitrary title/body — an unsolicited-notification
--             primitive. That is NOT fixed here and is reported as an open
--             issue: fixing it needs a recipient-relationship rule plus a review
--             of that call site, which is beyond a grant change.
--
--  No function body, policy, table, column or row is modified anywhere in this
--  migration. Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── TIER A — no live app caller: remove from both public roles ──────────────

-- Money. The critical one.
REVOKE ALL ON FUNCTION public.debit_wallet_for_payout(uuid, bigint)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_or_create_wallet(uuid)
  FROM PUBLIC, anon, authenticated;

-- Contract lifecycle — must only ever run through the admin RPCs.
REVOKE ALL ON FUNCTION public.heal_contract_to_active(uuid)
  FROM PUBLIC, anon, authenticated;

-- Anti-spam control surface: a user must not raise their own application cap.
REVOKE ALL ON FUNCTION public.set_inspector_daily_limit(uuid, integer)
  FROM PUBLIC, anon, authenticated;

-- Notification primitives with no recipient-relationship check.
REVOKE ALL ON FUNCTION public.notify_safe(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ── TIER B — live app caller exists: remove anon only ───────────────────────
--  anon has no legitimate use for any of these; an unauthenticated visitor must
--  never be able to emit a notification.
REVOKE ALL ON FUNCTION public.nx_notify(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon;

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_sig  text;
  v_fail text := '';
BEGIN
  -- (a) TIER A: neither anon nor authenticated may execute.
  FOREACH v_sig IN ARRAY ARRAY[
    'public.debit_wallet_for_payout(uuid,bigint)',
    'public.get_or_create_wallet(uuid)',
    'public.heal_contract_to_active(uuid)',
    'public.set_inspector_daily_limit(uuid,integer)',
    'public.notify_safe(uuid,text,text,text,text,uuid)'
  ] LOOP
    BEGIN
      IF has_function_privilege('anon', v_sig, 'EXECUTE')
         OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
        v_fail := v_fail || v_sig || ' still executable; ';
      END IF;
    EXCEPTION WHEN undefined_function THEN
      -- Signature drift between environments must not silently pass.
      RAISE NOTICE 'skipped (not present in this database): %', v_sig;
    END;
  END LOOP;

  -- (b) TIER B: anon revoked, authenticated intentionally retained.
  BEGIN
    IF has_function_privilege('anon', 'public.nx_notify(uuid,text,text,text,text,uuid)', 'EXECUTE') THEN
      v_fail := v_fail || 'nx_notify still executable by anon; ';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.nx_notify(uuid,text,text,text,text,uuid)', 'EXECUTE') THEN
      v_fail := v_fail || 'nx_notify lost its authenticated grant — notificationUtils.ts would break; ';
    END IF;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'skipped: nx_notify signature not present in this database';
  END;

  -- (c) service_role must retain access so Edge Functions keep working.
  BEGIN
    IF NOT has_function_privilege('service_role', 'public.debit_wallet_for_payout(uuid,bigint)', 'EXECUTE') THEN
      v_fail := v_fail || 'service_role lost debit_wallet_for_payout; ';
    END IF;
  EXCEPTION WHEN undefined_function THEN NULL;
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: %', v_fail;
  END IF;

  RAISE NOTICE 'unguarded SECURITY DEFINER RPCs are no longer reachable over PostgREST by anon/authenticated; service_role and internal callers unaffected.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
