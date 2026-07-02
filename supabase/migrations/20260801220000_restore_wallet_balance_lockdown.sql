-- ============================================================================
--  20260801220000_restore_wallet_balance_lockdown.sql
--
--  FINAL LOCKDOWN — close the restore_wallet_balance money-mint hole.
--
--  WHY:
--    public.restore_wallet_balance(p_user_id, p_amount_cents) is SECURITY
--    DEFINER (runs as postgres, bypasses RLS) and credits ANY wallet by an
--    attacker-controlled amount. It still carried GRANT ALL TO anon +
--    authenticated, and the money-perimeter table lockdown (20260801141000)
--    locked the `wallets` TABLE but never this function. So any logged-in user
--    could call:
--        supabase.rpc('restore_wallet_balance', { p_user_id: <self>, p_amount_cents: 999999999 })
--    and mint unlimited balance — defeating the entire escrow perimeter.
--
--  WHAT THIS DOES:
--    1. Adds an internal authorization guard: the function is a service-role
--       compensation path (called by stripe-connect-webhook on payout.failed).
--       A regular authenticated user is rejected; service-role/trusted server
--       contexts (auth.uid() IS NULL) and admins are allowed.
--    2. REVOKEs EXECUTE from anon + authenticated + PUBLIC and GRANTs only
--       service_role — the legitimate caller. Defense-in-depth with (1).
--    Body logic is otherwise byte-identical to the original.
--
--  SAFE TO RE-RUN: CREATE OR REPLACE + idempotent REVOKE/GRANT, wrapped in a
--    transaction. The webhook uses the service-role client, so the legitimate
--    path is unaffected.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.restore_wallet_balance(p_user_id uuid, p_amount_cents bigint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
BEGIN
  -- Service-role-only compensation path. service_role / trusted server
  -- contexts have a NULL auth.uid(); admins are also permitted. Any ordinary
  -- authenticated caller is rejected (cannot mint into a wallet).
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: restore_wallet_balance is service-role only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance + (p_amount_cents::numeric / 100.0),
         updated_at = now()
   WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.restore_wallet_balance(uuid, bigint) OWNER TO postgres;

REVOKE ALL    ON FUNCTION public.restore_wallet_balance(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_wallet_balance(uuid, bigint) TO service_role;

COMMIT;
