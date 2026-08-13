-- ════════════════════════════════════════════════════════════════════════════
--  20260801446000_anon_rpc_authority_lockdown.sql
--
--  Systemic RPC authority lockdown. Follows 20260801444000, which fixed one
--  instance of a pattern that turned out to be repository-wide.
--
--  ── MIGRATION NUMBER REASSIGNMENT ──────────────────────────────────────────
--  20260801446000 was previously reserved for Lane 5 (staged funding). This
--  security work must land BEFORE Lane 5, because Lane 5 builds staged funding
--  on exactly the settlement surface this migration secures. 446000 is
--  therefore reassigned to security, and **Lane 5 moves to 20260801448000**
--  (verified free at authoring time, along with 450000). This is the single
--  authoritative allocation; do not reuse 446000 for Lane 5.
--
--  ── HOW THE EXPOSURE AROSE ─────────────────────────────────────────────────
--  Two independent facts compose:
--
--  1. `20260801442000` revoked anon DEFAULT PRIVILEGES on FUNCTIONS. That
--     governs objects created afterwards. It does not touch grants already
--     materialised on existing objects, so every per-function
--     `GRANT ... TO anon` in the baseline survived unless named explicitly —
--     and only two functions were named.
--
--  2. The prevailing authorization idioms are fail-OPEN for a caller with no
--     session. Two distinct variants, both verified in-repo:
--
--       (a) `IF auth.uid() IS NOT NULL AND NOT nx_is_admin() THEN RAISE`
--           anon has auth.uid() = NULL, the conjunct short-circuits, the guard
--           never runs.  → settle_client_payment
--
--       (b) `IF v_job.client_id != auth.uid() THEN RETURN 'Unauthorized'`
--           SQL three-valued logic: `<uuid> != NULL` is NULL, not TRUE, so the
--           IF branch is NOT taken and execution falls through to the money
--           mutation.  → approve_job_and_pay
--
--     Variant (b) was confirmed empirically on PostgreSQL 18.4: with
--     auth.uid() NULL the guard expression evaluates to NULL, the function
--     returns {"success": true}, and an attacker-chosen recipient's balance
--     rose by 0.90 × an attacker-chosen amount. Unauthenticated, unbounded,
--     arbitrary-recipient. It is the most severe finding in this lane.
--
--  ── SCOPE, DERIVED FROM EVIDENCE NOT FROM NAMES ────────────────────────────
--  647 function signatures were replayed across all migrations in order to
--  establish each one's FINAL effective definition and its grant state after
--  every GRANT/REVOKE. Of those, 32 hold anon or PUBLIC EXECUTE and have a
--  mutating body. Of the 32:
--
--    • 6 are trigger functions (RETURNS trigger). PostgreSQL refuses to invoke
--      these as ordinary RPCs, so they are NOT directly exploitable. They are
--      included below as hygiene only, not as findings.
--    • 26 are genuinely callable RPCs.
--
--  Verified NOT vulnerable, despite appearing in earlier reports — each was
--  read individually rather than pattern-matched:
--    • process_withdrawal / request_withdrawal / apply_onboarding_role — all
--      open with `IF <uid> IS NULL THEN RAISE`, which is fail-CLOSED. anon is
--      already rejected. anon EXECUTE is still revoked below as defence in
--      depth, but these were never exploitable.
--    • get_or_create_wallet(uuid) and debit_wallet_for_payout(uuid,bigint)
--      were ALREADY revoked from PUBLIC/anon/authenticated by
--      20260801308000 (and get_or_create_wallet again by 20260801372000).
--      The standing report that get_or_create_wallet still carries anon
--      EXECUTE is stale; it is corrected here and needs no further change.
--
--  ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   1. Revokes anon + PUBLIC EXECUTE from every function in the evidence set.
--      `authenticated` and `service_role` are deliberately UNTOUCHED, which is
--      what makes this safe: the Admin console authenticates, and Edge
--      Functions use service_role. No legitimate flow mutates money, roles or
--      sign-off state while unauthenticated, so removing anon cannot break one.
--   2. Makes approve_job_and_pay unreachable. It has ZERO application callers
--      and writes `profiles.balance` — the superseded wallet model; the live
--      path is wallets.available_balance via credit_inspector_earning_on_approval.
--      Preserved, not dropped (the 20260801432000 precedent), with all client
--      execution revoked.
--   3. Rewrites settle_client_payment's guard to fail CLOSED. This one is LIVE
--      (4 application references) so it is fixed in place, not disabled. Body
--      otherwise reproduced verbatim from 20260801140000.
--   4. Pins search_path on every retained SECURITY DEFINER function in scope.
--   5. Installs a regression guard over the whole class.
--
--  No financial history deleted. Nothing dropped. No Auth/Wallet/Payment v2.
--  Production untouched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Revoke anon + PUBLIC across the evidence set ────────────────────────
--  By NAME, covering every overload, so a signature typo cannot silently skip
--  one. authenticated and service_role are intentionally not mentioned.
DO $revoke$
DECLARE
  r record;
  v_names text[] := ARRAY[
    -- money-mutating, callable
    'settle_client_payment', 'approve_job_and_pay', 'admin_fund_advance',
    'admin_mark_withdrawal_paid', 'admin_reject_withdrawal', 'process_withdrawal',
    'request_withdrawal', 'reassign_invoice_department',
    -- role / credential / organization authority
    'admin_remove_org_member', 'admin_suspend_user', 'admin_unsuspend_user',
    'admin_update_org_member_role', 'admin_verify_user', 'admin_review_credential',
    'admin_invite_org_member', 'bridge_send_invitation', 'moderate_review',
    'bulk_update_inspector_specialties', 'apply_onboarding_role',
    'create_organization', 'set_active_org', 'clear_active_org',
    'hydrate_identity', 'nx_mark_all_notifications_read',
    'nx_mark_notification_read', '_actor_is_super_admin',
    -- sign-off / dispatch authority
    'admin_dispatch_job', 'assign_job_contractor', 'approve_inspection_report',
    'admin_review_job', 'admin_cancel_job', 'admin_resolve_dispute',
    'admin_set_job_pricing', 'admin_set_fee_schedule',
    'admin_counter_application', 'admin_forward_application_to_client',
    'admin_generate_job_contract', 'admin_mark_payout_processed',
    -- trigger functions: hygiene only, not directly invocable as RPCs
    'handle_new_user', 'handle_new_user_wallet', 'increment_notification_badge',
    'tg_auto_issue_invoice_on_contract_executed', 'update_average_rating',
    'update_average_rating_on_delete'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY(v_names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, PUBLIC', r.sig);
  END LOOP;
END
$revoke$;

-- ─── 2. approve_job_and_pay: legacy, zero callers, made unreachable ─────────
DO $legacy$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'approve_job_and_pay'
  LOOP
    -- no client role may reach it at all; service_role retained for forensics
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, PUBLIC, authenticated', r.sig);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    EXECUTE format($c$COMMENT ON FUNCTION %s IS
      'LEGACY, UNREACHABLE. Writes profiles.balance, the superseded wallet model; '
      'the live path is wallets.available_balance via credit_inspector_earning_on_approval. '
      'Its guard `client_id != auth.uid()` is fail-open under SQL three-valued logic '
      '(uuid != NULL is NULL, so the IF is not taken), which allowed an unauthenticated '
      'caller to credit an arbitrary recipient an arbitrary amount. Client execution '
      'revoked by 20260801446000. Preserved for history; do not re-grant.'$c$, r.sig);
  END LOOP;
END
$legacy$;

-- ─── 3. settle_client_payment: LIVE — guard fixed to fail closed ────────────
--  Body reproduced verbatim from 20260801140000 except the guard block.
CREATE OR REPLACE FUNCTION public.settle_client_payment(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_inspector uuid;
  v_cents bigint;
  v_dollars numeric(12,2);
  v_adv public.payout_advances%ROWTYPE;
  v_jwt_role text;
BEGIN
  -- FAIL-CLOSED (20260801446000). The previous guard was
  --   IF auth.uid() IS NOT NULL AND NOT nx_is_admin() THEN RAISE
  -- which never ran for a caller with no session. Reject anon explicitly, and
  -- require an admin whenever a user session is present. A NULL-uid caller
  -- that is not anon is service_role or a direct maintenance connection, which
  -- is the intended non-interactive path and is preserved.
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_job.client_settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  v_inspector := v_job.contractor_id;
  v_cents := COALESCE(v_job.inspector_payout_cents, 0);
  v_dollars := round(v_cents::numeric / 100.0, 2);

  SELECT * INTO v_adv FROM public.payout_advances
    WHERE job_id = p_job_id AND status = 'funded' ORDER BY funded_at DESC LIMIT 1;

  IF v_inspector IS NOT NULL AND v_cents > 0 AND v_adv.id IS NULL
     AND COALESCE(v_job.payment_mode,'prepay') = 'net_terms' THEN
    INSERT INTO public.wallets(user_id) VALUES (v_inspector) ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM public.wallets WHERE user_id = v_inspector FOR UPDATE;
    UPDATE public.wallets
       SET pending_amount    = GREATEST(COALESCE(pending_amount,0) - v_dollars, 0),
           available_balance = COALESCE(available_balance,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_inspector;
    -- net_amount_halalas is GENERATED; omit it.
    INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, status, description)
    VALUES (v_inspector, v_inspector, p_job_id, 'settlement', v_dollars, v_cents, 0,
            'paid', 'Client settled — inspector funds cleared to available');
  ELSIF v_adv.id IS NOT NULL THEN
    UPDATE public.payout_advances SET status = 'recovered', recovered_at = now(), updated_at = now()
     WHERE id = v_adv.id;
  END IF;

  UPDATE public.jobs SET client_settled_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'cleared_cents', v_cents, 'advance_recovered', (v_adv.id IS NOT NULL));
END $fn$;

ALTER FUNCTION public.settle_client_payment(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_client_payment(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_client_payment(uuid) TO authenticated, service_role;

-- ─── 4. Pin search_path on retained SECURITY DEFINER functions in scope ─────
DO $pin$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c
                        WHERE c LIKE 'search\_path=%')
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname IN (
             'settle_client_payment','admin_reject_withdrawal','process_withdrawal',
             'request_withdrawal','reassign_invoice_department','admin_dispatch_job',
             'admin_remove_org_member','admin_suspend_user','admin_unsuspend_user',
             'admin_update_org_member_role','admin_verify_user','assign_job_contractor',
             'bridge_send_invitation','bulk_update_inspector_specialties',
             'clear_active_org','hydrate_identity','moderate_review','set_active_org',
             'nx_mark_all_notifications_read','nx_mark_notification_read',
             'admin_review_credential','admin_invite_org_member','approve_inspection_report',
             'admin_review_job','admin_cancel_job','admin_resolve_dispute',
             'admin_set_job_pricing','admin_set_fee_schedule','admin_counter_application',
             'admin_forward_application_to_client','admin_generate_job_contract',
             'admin_mark_payout_processed','_actor_is_super_admin')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END
$pin$;

-- ─── 5. Regression guard ────────────────────────────────────────────────────
--
--  LIMITATIONS, stated plainly: this reads pg_proc per OID (so it cannot merge
--  adjacent definitions the way file-level regex can), but it is blind to
--  dynamic SQL, collapses overloads by name, and cannot evaluate whether an
--  in-body guard is semantically fail-closed — assertion 5c catches the two
--  known fail-open idioms textually, not by proving authorization. It is
--  STATIC: it says nothing about production until it runs there.
--
DO $selftest$
DECLARE
  v_bad text;
  v_n   int;
BEGIN
  -- 5a. No anon/PUBLIC EXECUTE on any money- or authority-mutating function.
  SELECT count(*), string_agg(sig, ', ')
    INTO v_n, v_bad
    FROM (
      SELECT p.oid::regprocedure::text AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language  l ON l.oid = p.prolang
       WHERE n.nspname = 'public'
         AND l.lanname IN ('plpgsql','sql')
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('public', p.oid, 'EXECUTE'))
         AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
             '(insert\s+into|update|delete\s+from)\s+(public\.)?(wallets|transactions|earnings|payouts|payout_requests|supplier_earnings|escrow\w*|payment_holds?|refunds?|profiles|user_roles|organization_members)\M'
    ) s;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % function(s) mutating money/roles are still executable by anon or PUBLIC: %', v_n, v_bad;
  END IF;

  -- 5b. approve_job_and_pay is unreachable by any client role, and preserved.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='approve_job_and_pay') THEN
    RAISE EXCEPTION 'SELFTEST: approve_job_and_pay was dropped — it is preserved deliberately';
  END IF;
  FOR v_bad IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='approve_job_and_pay'
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('public', p.oid, 'EXECUTE'))
  LOOP
    RAISE EXCEPTION 'SELFTEST: % is still reachable by a client role', v_bad;
  END LOOP;

  -- 5c. Neither known fail-open idiom survives on an anon-reachable function.
  SELECT count(*), string_agg(sig, ', ')
    INTO v_n, v_bad
    FROM (
      SELECT p.oid::regprocedure::text AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND has_function_privilege('anon', p.oid, 'EXECUTE')
         AND (p.prosrc ~* 'auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND'
           OR p.prosrc ~* '!=\s*auth\.uid\(\)'
           OR p.prosrc ~* '<>\s*auth\.uid\(\)')
    ) s;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % anon-reachable function(s) still use a fail-open auth.uid() idiom: %', v_n, v_bad;
  END IF;

  -- 5d. settle_client_payment keeps its legitimate callers.
  IF NOT has_function_privilege('authenticated', 'public.settle_client_payment(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.settle_client_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'SELFTEST: settle_client_payment lost authenticated/service_role EXECUTE — the Admin settlement path must keep working';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
