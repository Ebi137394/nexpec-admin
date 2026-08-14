-- ════════════════════════════════════════════════════════════════════════════
--  20260801490000_flash_report_create_overload_supersession.sql
--
--  P1 — public.flash_report_create is ambiguous. Five pgTAP suites abort at
--  fixture setup, and the same call fails identically in production.
--
--  ── REPRODUCED, NOT INFERRED ───────────────────────────────────────────────
--      select public.flash_report_create(
--               '…'::uuid,'x','high','t','d','loc', now());
--      ERROR:  function public.flash_report_create(unknown, unknown, unknown,
--              unknown, unknown, unknown, timestamp with time zone) is not unique
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  TWO overloads exist, BOTH from the remote baseline — so this is a live
--  production defect, not fixture drift:
--
--    baseline:9809   (p_job_id, p_category, p_severity, p_title, p_description,
--                     p_location_text DEFAULT NULL, p_occurred_at DEFAULT NULL)
--    baseline:9915   … the same seven, plus p_client_id uuid DEFAULT NULL
--
--  Because every parameter from p_location_text onward is DEFAULTed on the
--  8-arg, a seven-argument call satisfies BOTH candidates and PostgreSQL
--  refuses to choose. There is no seven-argument call form — positional or
--  named — that resolves uniquely at the SQL level.
--
--  ── WHICH ONE IS CANONICAL ─────────────────────────────────────────────────
--  The 8-arg, on the evidence:
--
--   1. p_client_id is NOT a client's id. The body spends it as the row's
--      primary key — `COALESCE(p_client_id, gen_random_uuid())` in the INSERT
--      column position `id` — behind a prior-row lookup that returns the
--      existing report instead of inserting a second one. It is the offline
--      outbox's client-generated idempotency key. Dropping the 8-arg would
--      delete replay-safety for every flash report raised offline on mobile,
--      turning a retried sync into duplicate reports.
--
--   2. The 7-arg has no such key and cannot acquire one without becoming the
--      8-arg.
--
--  The 7-arg's COMMENT still calls it "Authoritative entry for raising a Flash
--  Report". That comment predates the idempotent successor and is now false;
--  it dies with the function.
--
--  ── AUTHORIZATION: FLAGGED, NOT SILENTLY CHANGED ───────────────────────────
--  The two bodies differ in exactly one further line — the reporter-role
--  fallback after the contractor/client/agency checks:
--
--      7-arg:  p.role  = 'super_admin'
--      8-arg:  p.role IN ('admin','super_admin')
--
--  So retiring the 7-arg leaves 'admin' able to raise a flash report on a job
--  it is not a party to, where the 7-arg allowed only 'super_admin'.
--
--  This migration does NOT edit either body, because BOTH available edits are
--  unevidenced behaviour changes and the narrower one is the more dangerous:
--
--    • Tightening the 8-arg to super_admin-only would change a function that
--      is reachable and working in production TODAY (mobile sends the 8-key
--      body), revoking access from admins who legitimately raise reports.
--    • The widening is not introduced here. 'admin' can already raise flash
--      reports in production through the 8-arg. Retiring the 7-arg makes the
--      web path agree with the mobile path rather than granting new power to
--      anyone.
--
--  Removing the ambiguity is the minimal fix; unifying on the policy that is
--  already live is its consequence, and it is recorded here rather than
--  buried. If super_admin-only is the intended policy for BOTH platforms,
--  that is a deliberate product decision and belongs in its own migration
--  that narrows the surviving function on purpose.
--
--  ── ONE GENUINE TIGHTENING IS APPLIED ──────────────────────────────────────
--  The baseline REVOKEs the 7-arg FROM PUBLIC (33655) but never does so for
--  the 8-arg, which therefore carries `=X/postgres` — EXECUTE for PUBLIC. The
--  survivor must not be more exposed than the function it replaces, so PUBLIC
--  is revoked. The explicit anon/authenticated/service_role grants the
--  baseline issues (33662-33664) are left exactly as they are: this migration
--  removes an overload, it does not re-litigate the role grants.
--
--  ── SAFETY ─────────────────────────────────────────────────────────────────
--  No repo migration CREATEs either overload (both are baseline-only), so the
--  drop cannot be resurrected by a later replay. Callers are unaffected:
--  8-key bodies already bind to the survivor, and 7-key bodies — which fail
--  outright today — bind to it after this, with p_client_id defaulting to
--  NULL and the idempotency branch skipped, exactly reproducing 7-arg
--  behaviour.
-- ════════════════════════════════════════════════════════════════════════════

--  ── A SECOND INSTANCE, FOUND BY THIS MIGRATION'S OWN CLASS CHECK ───────────
--  Selftest 4 below refused the first version of this migration, naming
--  public.fetch_department_spend_summary. Reproduced identically:
--
--      select public.fetch_department_spend_summary('…'::uuid);
--      ERROR:  function public.fetch_department_spend_summary(uuid) is not unique
--
--    migrations_archive/20260530120000_department_budget_rollup_rpc.sql:281
--        fetch_department_spend_summary(p_department_id uuid)
--    migrations_archive/20260602120000_multi_currency_rollup_rpcs.sql:281
--        fetch_department_spend_summary(p_department_id uuid,
--                                       p_display_currency text DEFAULT NULL)
--
--  Same shape, and here the resolution is unambiguous: the 1-arg's body is a
--  pure delegating shim whose only distinct statement is
--
--      SELECT public.fetch_department_spend_summary(p_department_id, NULL);
--
--  It was left behind as a backward-compatibility wrapper when the
--  currency-aware version landed — but the wrapper cannot be called, because a
--  1-argument call matches both candidates. Dropping it is exactly
--  behaviour-preserving: every 1-arg caller then binds to the currency-aware
--  function with p_display_currency defaulting to NULL, which is precisely
--  what the shim passed. The shim's internal 2-arg call was always explicit
--  and so never ambiguous, which is why this stayed hidden.
--
--  Both are handled in one migration because they are one defect class, and
--  fixing only the suite-blocking instance would leave the class check red.

BEGIN;

DROP FUNCTION IF EXISTS public.flash_report_create(
  uuid, text, text, text, text, text, timestamp with time zone);

DROP FUNCTION IF EXISTS public.fetch_department_spend_summary(uuid);

REVOKE EXECUTE ON FUNCTION public.fetch_department_spend_summary(uuid, text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.flash_report_create(
  uuid, text, text, text, text, text, timestamp with time zone, uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.flash_report_create(
  uuid, text, text, text, text, text, timestamp with time zone, uuid) IS
  'Authoritative entry for raising a Flash Report. Snapshots the reporter role, '
  'sets audit correlation/intent, and writes a flash_report.raised audit event '
  'with critical severity for severity=critical reports. p_client_id is the '
  'offline outbox''s client-generated idempotency key, used as the row id so a '
  'replayed sync returns the existing report instead of duplicating it. '
  'Superseded the non-idempotent 7-argument overload (20260801490000), whose '
  'coexistence made every 7-argument call ambiguous.';

-- ─── Selftest — behavioural, and it guards the class ────────────────────────
DO $selftest$
DECLARE v_n int; v_dupe text;
BEGIN
  -- 1. Exactly one flash_report_create remains, and it is the idempotent one.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'flash_report_create';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'SELFTEST: expected exactly 1 flash_report_create, found %', v_n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'flash_report_create'
       AND pg_get_function_identity_arguments(p.oid) LIKE '%p_client_id uuid%'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: the surviving flash_report_create is not the idempotent overload — offline replay safety was dropped';
  END IF;

  -- 2. The survivor still refuses non-parties. Asserting the guard is PRESENT,
  --    not merely that a function exists: the whole point of choosing between
  --    overloads is that authorization must not fall out in the swap.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'flash_report_create'
       AND p.prosrc ~ 'Only parties to the job'
       AND p.prosrc ~ 'auth\.uid\(\)'
       AND p.prosrc ~ 'Not authenticated'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: the surviving flash_report_create lost its party/authentication guard';
  END IF;

  -- 3. And it is not executable by PUBLIC.
  IF has_function_privilege('public',
       'public.flash_report_create(uuid,text,text,text,text,text,timestamptz,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION
      'SELFTEST: PUBLIC can still execute flash_report_create';
  END IF;

  -- 4. THE CLASS. Any SECURITY DEFINER public function with two overloads
  --    where one is a defaulted extension of the other is ambiguous the same
  --    way and will abort at runtime. Catch the shape, not this instance.
  FOR v_dupe IN
    SELECT p.proname || ' (' || count(*) || ' overloads, ' ||
           min(p.pronargs) || '-' || max(p.pronargs) || ' args)'
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.prosecdef
       AND p.proname NOT LIKE 'pg\_%'
     GROUP BY p.proname
    HAVING count(*) > 1
       -- ambiguous only when a shorter call is fully satisfiable by the longer
       -- candidate's defaults, i.e. the longer one's mandatory arity reaches
       -- down to (or below) the shorter one's total arity
       AND min(p.pronargs) >= max(p.pronargs - p.pronargdefaults)
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % — overloads whose defaults overlap; calls at the shared arity are ambiguous and will fail at runtime', v_dupe;
  END LOOP;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
