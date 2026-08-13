-- ════════════════════════════════════════════════════════════════════════════
--  20260801444000_detach_credit_inspector_on_confirm.sql
--
--  Payment P0. The second — and last — attached trigger path that moves money
--  automatically. 20260801432000 detached the first (execute_auto_payout).
--
--  ── THE ATTACHED PATH ──────────────────────────────────────────────────────
--  baseline:27638
--      CREATE OR REPLACE TRIGGER trg_credit_inspector_on_confirm
--        AFTER UPDATE OF admin_confirmed_at ON public.jobs
--        FOR EACH ROW EXECUTE FUNCTION public.tg_credit_inspector_on_confirm();
--
--  baseline:18897  tg_credit_inspector_on_confirm() fires on
--  admin_confirmed_at NULL -> non-NULL and PERFORMs
--  credit_inspector_earning_on_approval(NEW.id).
--
--  ── THE EFFECTIVE BODY IS NOT THE BASELINE BODY ────────────────────────────
--  20260801140000:38 issues CREATE OR REPLACE on
--  credit_inspector_earning_on_approval(uuid), so baseline:7519 is superseded.
--  Verified: 140000 is the FINAL definition in the repository — no later
--  migration redefines it (20260801374000 only names it in a comment), and the
--  function has exactly one signature, (p_job_id uuid). No overloads.
--
--  The effective body credits real money:
--      UPDATE public.wallets SET available_balance = ... + v_dollars      (prepay)
--      UPDATE public.wallets SET pending_amount    = ... + v_dollars      (net terms)
--      INSERT INTO public.transactions(... type='earning' ...)
--  It is SECURITY DEFINER, OWNER postgres, and already carries
--  SET search_path = public, pg_temp. It is idempotent per (job, inspector)
--  via the pre-existing 'earning' probe.
--
--  ── WHY THIS IS A P0, ON TWO INDEPENDENT GROUNDS ───────────────────────────
--
--  (1) AUTOMATIC MONEY MOVEMENT. The canonical product rule is that there is no
--      automatic Inspector credit and no automatic settlement after Admin
--      confirmation; payout and settlement are manually controlled by Admin.
--      An AFTER UPDATE trigger that credits a wallet the instant
--      admin_confirmed_at is stamped is exactly the prohibited behaviour.
--
--  (2) THE anon GRANT IS DIRECTLY EXPLOITABLE. baseline:33358
--          GRANT ALL ON FUNCTION
--            public.credit_inspector_earning_on_approval(uuid) TO anon;
--      is still live: no migration revokes it. The Lane 3 sweep
--      (20260801442000) revoked anon DEFAULT PRIVILEGES on FUNCTIONS and named
--      two specific functions (request_senior_review,
--      protect_certification_verification) — altering default privileges does
--      not touch grants already materialised on existing objects, so this one
--      survived untouched.
--
--      The in-function guard does not close it:
--          IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
--            RAISE EXCEPTION 'NOT_AUTHORIZED';
--          END IF;
--      For the anon role with the public API key and no user JWT, auth.uid()
--      is NULL, so the left conjunct is false and the guard is SKIPPED
--      ENTIRELY. Execution then proceeds into the wallet UPDATE. The guard is
--      fail-open precisely for the one role that should never reach it.
--
--      Reachability: PostgREST exposes it as
--        POST /rest/v1/rpc/credit_inspector_earning_on_approval {"p_job_id":…}
--      Preconditions an attacker needs: a job UUID, admin_confirmed_at already
--      set, inspector_payout_cents > 0, and no existing 'earning' row. anon
--      SELECT on public.jobs was revoked by 20260801312000, so the UUID must
--      leak from elsewhere — that lowers the odds, it does not close the hole,
--      and an unauthenticated caller must never be able to move money at all.
--
--  ── SILENT FAILURE ─────────────────────────────────────────────────────────
--  The wrapper ends in EXCEPTION WHEN OTHERS -> RAISE NOTICE -> RETURN NEW.
--  Every failure in the financial path is swallowed. This is why the
--  generated-column defect fixed by 20260801140000 was invisible in production
--  for as long as it was: earnings silently never credited.
--
--  ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   1. Detaches trg_credit_inspector_on_confirm. Additive and forward-only.
--   2. Revokes anon + PUBLIC execution on the money function and the wrapper;
--      keeps authenticated (admin-gated) and service_role, which are the only
--      real callers (scripts/qa/e2e-money-flow.mjs runs as admin/service; the
--      archived 20260801137000:420 shows the INTENDED grant was authenticated
--      only, so the anon grant is a live-DB artifact, not a design decision).
--   3. Re-pins search_path on both retained SECURITY DEFINER functions.
--   4. Replaces the wrapper so it no longer swallows exceptions and refuses to
--      credit automatically — it is preserved, not dropped, so history and any
--      historical reference remain valid, but a future re-attach fails LOUDLY
--      instead of silently moving money.
--   5. Adds a fail-closed anon rejection inside the money function itself, so
--      the hole stays shut even if a grant is ever restored. The rest of the
--      body is reproduced verbatim from 20260801140000.
--   6. Installs a BEHAVIOURAL regression guard (see the honesty note in §6).
--
--  Financial history is not deleted. No Payment v2. Production untouched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Detach the prohibited automatic-credit trigger ──────────────────────
DROP TRIGGER IF EXISTS trg_credit_inspector_on_confirm ON public.jobs;

-- ─── 2. Remove unsafe execution ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.credit_inspector_earning_on_approval(uuid)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_inspector_earning_on_approval(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.tg_credit_inspector_on_confirm()
  FROM anon, PUBLIC;

-- ─── 3. Pin search_path on retained SECURITY DEFINER functions ──────────────
ALTER FUNCTION public.credit_inspector_earning_on_approval(uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_credit_inspector_on_confirm()
  SET search_path = public, pg_temp;

-- ─── 4. Wrapper: preserved, de-fanged, and no longer silent ─────────────────
--  Kept defined for historical compatibility (mirrors how 20260801432000
--  preserved execute_auto_payout). It can no longer credit, and it can no
--  longer hide a failure behind RAISE NOTICE.
CREATE OR REPLACE FUNCTION public.tg_credit_inspector_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Automatic Inspector credit is prohibited: payout and settlement are
  -- manually controlled by Admin. This function is retained only so that
  -- historical references resolve. If it is ever re-attached to a table it
  -- must fail loudly rather than resume moving money, and it must NOT
  -- swallow the failure the way the original body did.
  RAISE EXCEPTION
    'AUTOMATIC_CREDIT_PROHIBITED: tg_credit_inspector_on_confirm was detached by '
    '20260801444000. Inspector credit is manual — call '
    'credit_inspector_earning_on_approval(uuid) from an Admin or service context.'
    USING ERRCODE = '42501';
END $$;

ALTER FUNCTION public.tg_credit_inspector_on_confirm() OWNER TO postgres;

-- ─── 5. Fail-closed anon rejection inside the money function ────────────────
--  Body reproduced verbatim from 20260801140000:38-96, with ONE addition: an
--  explicit rejection of the anon JWT role ahead of the existing guard. The
--  addition is a no-op for postgres/psql (no request.jwt.* setting -> NULL),
--  for service_role, and for authenticated — so no legitimate caller changes
--  behaviour, including supabase/tests/money_flow_test.sql.
CREATE OR REPLACE FUNCTION public.credit_inspector_earning_on_approval(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_inspector uuid;
  v_cents bigint;
  v_dollars numeric(12,2);
  v_cleared boolean;
  v_jwt_role text;
BEGIN
  -- ADDED 20260801444000. The guard below is fail-OPEN for anon, because anon
  -- has auth.uid() IS NULL and the conjunct short-circuits. Reject the anon
  -- role explicitly and first. Belt-and-braces with the REVOKE above.
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

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  v_inspector := v_job.contractor_id;
  IF v_inspector IS NULL THEN RAISE EXCEPTION 'NO_CONTRACTOR_ON_JOB'; END IF;
  IF v_job.admin_confirmed_at IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_CONFIRMED'; END IF;

  v_cents := COALESCE(v_job.inspector_payout_cents, 0);
  IF v_cents <= 0 THEN RAISE EXCEPTION 'NO_PAYOUT_AMOUNT'; END IF;
  v_dollars := round(v_cents::numeric / 100.0, 2);

  IF EXISTS (SELECT 1 FROM public.transactions WHERE job_id = p_job_id AND inspector_id = v_inspector AND type = 'earning') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  INSERT INTO public.wallets(user_id) VALUES (v_inspector) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.wallets WHERE user_id = v_inspector FOR UPDATE;

  v_cleared := (COALESCE(v_job.payment_mode, 'prepay') = 'prepay');

  IF v_cleared THEN
    UPDATE public.wallets
       SET available_balance = COALESCE(available_balance,0) + v_dollars,
           total_earned      = COALESCE(total_earned,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_inspector;
  ELSE
    UPDATE public.wallets
       SET pending_amount = COALESCE(pending_amount,0) + v_dollars,
           total_earned   = COALESCE(total_earned,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_inspector;
  END IF;

  -- net_amount_halalas is GENERATED (gross - platform_fee); do NOT insert it.
  INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
        gross_amount_halalas, platform_fee_halalas, status, description)
  VALUES (v_inspector, v_inspector, p_job_id, 'earning', v_dollars,
        v_cents, 0,
        CASE WHEN v_cleared THEN 'paid' ELSE 'pending' END,
        CASE WHEN v_cleared THEN 'Inspection earning (cleared)'
             ELSE 'Inspection earning (accrued — awaiting client settlement)' END);

  RETURN jsonb_build_object('ok', true, 'inspector_id', v_inspector, 'amount_cents', v_cents, 'cleared', v_cleared);
END $fn$;

ALTER FUNCTION public.credit_inspector_earning_on_approval(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.credit_inspector_earning_on_approval(uuid) IS
  'Manual Inspector accrual. Admin- or service-invoked ONLY — never trigger-driven. '
  'Automatic credit was detached by 20260801444000; anon execution revoked and '
  'explicitly rejected in-body. Idempotent per (job, inspector).';

COMMENT ON FUNCTION public.tg_credit_inspector_on_confirm() IS
  'RETAINED BUT INERT. Detached from public.jobs by 20260801444000. Raises if '
  'invoked; must never be re-attached. Automatic Inspector credit is prohibited.';

-- ─── 6. Behavioural regression guard ────────────────────────────────────────
--
--  HONEST STATEMENT OF WHAT THIS CAN AND CANNOT DO.
--
--  What it does: for every non-internal trigger in `public`, it walks the
--  trigger function's CALL CLOSURE (the trigger function plus the public
--  functions it textually invokes, to a bounded depth) and flags the trigger
--  if ANY function in that closure performs DML against a financial relation.
--
--  Why the closure matters: 20260801432000's guard, and 20260801372000's
--  before it, matched `p.proname IN (...)` — a literal name list. This defect
--  survived both because its name was never on either list. A body scan of the
--  ATTACHED function alone would ALSO have missed it: tg_credit_inspector_on_confirm
--  contains no money DML at all; it only PERFORMs another function. Following
--  the call edge is the whole point.
--
--  Why this is not the brittle body-parsing the review warned about: it reads
--  pg_proc.prosrc, which is one function's body retrieved by OID. It never
--  parses a .sql FILE, so there is no possibility of merging two adjacent
--  function definitions into one blob — the failure mode that makes file-level
--  regex auditing untrustworthy.
--
--  LIMITATIONS, stated plainly rather than papered over:
--    (a) Dynamic SQL is invisible. A body that builds its DML with
--        EXECUTE format(...) will not match, and a call made only through
--        dynamic SQL will not be followed.
--    (b) Call-edge detection is name-based text matching, so overloaded names
--        collapse to a single node and a call through a function-typed
--        variable is not seen.
--    (c) Line comments are stripped before matching, but a money-shaped
--        pattern inside a string literal or block comment can still produce a
--        false positive. That is the deliberate direction to fail in.
--    (d) Depth is capped at 4 to bound cost; a money write reachable only at
--        depth 5+ is not seen.
--    (e) This is STATIC. It proves a property of the repository's schema as
--        assembled here. It proves nothing about the production database until
--        it actually executes there. SQL runtime remains PENDING MAC.
--
DO $selftest$
DECLARE
  v_bad text;
  v_cnt int;
BEGIN
  -- 6a. The trigger is gone.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trg_credit_inspector_on_confirm' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: trg_credit_inspector_on_confirm is still attached — automatic Inspector credit remains live';
  END IF;

  -- 6b. Both functions are PRESERVED, not dropped.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'credit_inspector_earning_on_approval'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: credit_inspector_earning_on_approval was dropped — this phase makes automatic credit unreachable, it does not delete the manual path';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'tg_credit_inspector_on_confirm'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: tg_credit_inspector_on_confirm was dropped — it is preserved deliberately for historical compatibility';
  END IF;

  -- 6c. anon/PUBLIC cannot execute either one.
  FOR v_bad IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('credit_inspector_earning_on_approval',
                         'tg_credit_inspector_on_confirm')
       AND (has_function_privilege('anon',   p.oid, 'EXECUTE')
         OR has_function_privilege('public', p.oid, 'EXECUTE'))
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % is still executable by anon or PUBLIC — unauthenticated money movement remains reachable', v_bad;
  END LOOP;

  -- 6d. search_path pinned on both retained SECURITY DEFINER functions.
  FOR v_bad IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('credit_inspector_earning_on_approval',
                         'tg_credit_inspector_on_confirm')
       AND p.prosecdef
       AND NOT EXISTS (
             SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
              WHERE c LIKE 'search\_path=%'
           )
  LOOP
    RAISE EXCEPTION 'SELFTEST: % is SECURITY DEFINER with no pinned search_path', v_bad;
  END LOOP;

  -- 6e. The wrapper no longer swallows exceptions.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'tg_credit_inspector_on_confirm'
       AND p.prosrc ~* 'EXCEPTION\s+WHEN\s+OTHERS'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: tg_credit_inspector_on_confirm still swallows exceptions — a financial path must not fail silently';
  END IF;

  -- 6f. THE WIDENED, BEHAVIOURAL GUARD.
  --     No attached trigger in `public` may reach money DML within its call closure.
  WITH RECURSIVE
  -- one row per public plpgsql/sql function, line comments stripped
  fn AS (
    SELECT p.oid,
           p.proname,
           regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l  ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname IN ('plpgsql', 'sql')
  ),
  -- Call edges computed ONCE over the function set, not once per trigger.
  -- Doing this inside the recursive term would re-run the regex join for
  -- every (trigger, depth) pair and blow up on a schema this size.
  edge AS (
    SELECT caller.oid AS caller, callee.oid AS callee
      FROM fn caller
      JOIN fn callee
        ON callee.oid <> caller.oid
       AND caller.body ~* ('\m' || callee.proname || '\s*\(')
  ),
  -- trigger functions actually attached to a table
  roots AS (
    SELECT DISTINCT t.tgname, f.oid, 0 AS depth
      FROM pg_trigger t
      JOIN fn f ON f.oid = t.tgfoid
     WHERE NOT t.tgisinternal
  ),
  closure AS (
    SELECT tgname, oid, depth FROM roots
    UNION
    SELECT c.tgname, e.callee, c.depth + 1
      FROM closure c
      JOIN edge e ON e.caller = c.oid
     WHERE c.depth < 4
  )
  SELECT count(DISTINCT c.tgname),
         string_agg(DISTINCT c.tgname || ' -> ' || f.proname, ', ')
    INTO v_cnt, v_bad
    FROM closure c
    JOIN fn f ON f.oid = c.oid
   WHERE
     -- wallet balance movement
     f.body ~* 'update\s+(public\.)?wallets\M'
     -- ledger / earnings / payout writes
  OR f.body ~* '(insert\s+into|update)\s+(public\.)?(transactions|earnings|payouts|payout_requests|supplier_earnings)\M'
     -- escrow / hold state
  OR f.body ~* '(insert\s+into|update)\s+(public\.)?(escrow\w*|payment_holds?)\M'
     -- settlement / release markers
  OR f.body ~* 'set\s[^;]*\m(client_settled_at|settled_at|released_at|payout_status|settlement_status)\s*='
     -- refunds
  OR f.body ~* '(insert\s+into|update)\s+(public\.)?refunds?\M';

  IF v_cnt > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % attached trigger(s) can move money within their call closure — settlement, payout and Inspector credit must stay manual. Offending edges: %',
      v_cnt, v_bad;
  END IF;

  -- 6g. Keep the original name-based guard from 20260801432000 as a cheap
  --     backstop, extended with this phase's names. The behavioural guard
  --     above is the real check; this one survives even if the closure walk
  --     is ever weakened.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE p.proname IN (
             'handle_job_completion',
             'handle_job_cancellation',
             'execute_auto_payout',
             'tg_credit_inspector_on_confirm',
             'credit_inspector_earning_on_approval')
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: a known automatic-settlement/credit/payout function is attached as a trigger';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
