-- ════════════════════════════════════════════════════════════════════════════
--  no_hardcoded_environment_test.sql
--
--  Regression cover for 20260801520000.
--
--  The defect it guards against was not "these two functions are wrong". It was
--  that a SECURITY DEFINER function could name the PRODUCTION project and carry
--  a literal bearer token, and nothing in the suite noticed for the whole life
--  of the baseline. So this asserts the PROPERTY, over every function in the
--  schema, rather than re-checking the two that happened to be caught:
--
--    1. No public function embeds the Production project ref.
--    2. No public function embeds the leaked cron secret literal.
--    3. The two cron kickoffs resolve their config at call time.
--    4. They fail closed — unconfigured means no outbound call.
--    5. The cron secret is not readable through the anon-executable config
--       accessor, which is why it lives in the vault and not in _app_config.
--
--  Nothing here moves money, sends mail, or performs a network call.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- ── 1. No function anywhere in public names the Production project ──────────
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) LIKE '%sxqpjxhslzzcdrdctatm%'),
  0,
  'HC1: no public function embeds the Production project ref'
);

-- ── 2. Nor the leaked cron secret ───────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) LIKE '%nexpec-super-secret-cron-key-2026%'),
  0,
  'HC2: no public function embeds the leaked cron secret literal'
);

-- ── 3. Both kickoffs resolve configuration instead of declaring it ──────────
SELECT ok(
  pg_get_functiondef('public.cron_kickoff_email_dispatch()'::regprocedure)
    LIKE '%_app_config_get(''functions_base_url'')%',
  'HC3: email kickoff resolves its base URL from _app_config'
);

SELECT ok(
  pg_get_functiondef('public.cron_kickoff_fx_refresh()'::regprocedure)
    LIKE '%vault.decrypted_secrets%',
  'HC4: fx kickoff reads its bearer from the vault, not a literal'
);

-- ── 4. Fail closed. Nothing is configured in a fresh database, so a call must
--       return quietly having sent nothing. The proof that no HTTP request was
--       attempted is that net.http_post enqueues into net.http_request_queue;
--       an unconfigured call must not add to it.
CREATE TEMP TABLE _hc_before AS
  SELECT count(*) AS n FROM net.http_request_queue;

SELECT lives_ok(
  $$ SELECT public.cron_kickoff_fx_refresh() $$,
  'HC5: fx kickoff on an unconfigured database does not raise'
);

SELECT is(
  (SELECT count(*)::int FROM net.http_request_queue),
  (SELECT n::int FROM _hc_before),
  'HC6: ...and enqueued no outbound request'
);

-- An unconfigured environment must also record no phantom bookkeeping row.
SELECT is(
  (SELECT count(*)::int FROM public.fx_refresh_runs
    WHERE started_at > now() - interval '1 minute'),
  0,
  'HC7: ...and wrote no fx_refresh_runs row for a call it never made'
);

SELECT lives_ok(
  $$ SELECT public.cron_kickoff_email_dispatch() $$,
  'HC8: email kickoff on an unconfigured database does not raise'
);

-- ── 5. The secret must not be reachable through the anon-executable accessor.
--       _app_config_get is SECURITY DEFINER granted to anon; if a future change
--       parks the cron secret there, every anonymous caller can read it.
SELECT is(
  public._app_config_get('cron_secret'),
  NULL,
  'HC9: the cron secret is NOT in the anon-readable _app_config store'
);

SELECT * FROM finish();
ROLLBACK;
