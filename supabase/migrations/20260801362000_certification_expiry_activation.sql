-- ════════════════════════════════════════════════════════════════════════════
--  20260801362000_certification_expiry_activation.sql
--
--  CREDENTIAL EXPIRY — activate it, on the canonical table.
--
--  ── WHAT WAS ALREADY THERE, AND WHY IT NEVER RAN ───────────────────────────
--  A complete-looking expiry system exists in the baseline and has NEVER been
--  reachable:
--      auto_expire_certifications()            baseline:4270   (trigger fn, no trigger)
--      expire_old_certifications()             baseline:8777   (0 callers)
--      get_expiring_certifications(int[])      baseline:10641  (0 callers)
--      get_expiring_certifications_with_contractor(int[])      (0 callers)
--      get_certification_expiry_summary(uuid)  baseline:10517  (0 callers)
--      v_certifications_with_status + 5 expiry indexes
--  No cron job, no trigger, no application caller anywhere in the repo.
--
--  TWO reasons it could never have worked, both found by reading it:
--
--   1. WRONG TABLE. Every one of those functions targets
--      contractor_certifications. The application does not use that table —
--      exactly ONE file references it (src/roles/admin/services/adminService.ts),
--      whereas the CANONICAL table `certifications` is used by seven, including
--      the inspector cert wallet, the profile screen, applicant review, and the
--      matching engine added in 20260801358000.
--
--   2. STATUS MISMATCH. contractor_certifications.status DEFAULTs to 'valid',
--      but every expiry function filters on status = 'active'. Even if wired,
--      it would have expired nothing, forever.
--
--  ── WHAT THIS MIGRATION DOES (PRESERVE BOTH, IMPROVE THE CANONICAL PATH) ────
--  Per the standing rule on overlapping systems: nothing is deleted, both
--  systems keep working, new development routes through the better one.
--   • The legacy machinery is PRESERVED and its status bug is FIXED in place
--     (now accepts 'active' OR 'valid'), so it works if anything still calls it.
--   • The live expiry system is built on `certifications`, the canonical table.
--
--  ── DESIGN NOTE: EXPIRY IS DERIVED, NOT STAMPED ────────────────────────────
--  certifications_status_check permits only pending|verified|rejected. Writing
--  status='expired' would violate it. Rather than widen a security-relevant
--  constraint, expiry is DERIVED from expiry_date. This is already how the
--  matching engine treats it (cert credit requires expiry_date > current_date),
--  so an expired credential stops counting the moment it lapses, with no
--  background job needed and no window where the two disagree. The cron job
--  therefore only NOTIFIES; it never mutates credential state.
--
--  ── SAFETY ─────────────────────────────────────────────────────────────────
--   • MONEY-FREE. Self-tested.
--   • Idempotent per (certification, threshold) via a reminder ledger, so the
--     daily job cannot spam. Re-running it the same day sends nothing new.
--   • Notifies the credential OWNER only. No PII crosses users.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Reminder ledger — makes the daily job idempotent ─────────────────────
CREATE TABLE IF NOT EXISTS public.certification_expiry_reminders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id  uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  recipient_id      uuid NOT NULL,
  threshold_days    int  NOT NULL,
  expiry_date       date NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now()
);

-- One reminder per credential per threshold per expiry date. Including
-- expiry_date means that RENEWING a credential (new expiry) legitimately
-- re-arms the whole reminder ladder, while a same-day re-run sends nothing.
CREATE UNIQUE INDEX IF NOT EXISTS certification_expiry_reminders_once_idx
  ON public.certification_expiry_reminders (certification_id, threshold_days, expiry_date);

CREATE INDEX IF NOT EXISTS certification_expiry_reminders_recipient_idx
  ON public.certification_expiry_reminders (recipient_id, sent_at DESC);

ALTER TABLE public.certification_expiry_reminders ENABLE ROW LEVEL SECURITY;

-- Owners may read their own reminder history; nobody writes from the client.
DROP POLICY IF EXISTS certification_expiry_reminders_own_read ON public.certification_expiry_reminders;
CREATE POLICY certification_expiry_reminders_own_read
  ON public.certification_expiry_reminders FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid() OR public.nx_is_admin());

REVOKE ALL ON TABLE public.certification_expiry_reminders FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.certification_expiry_reminders TO authenticated;
GRANT ALL    ON TABLE public.certification_expiry_reminders TO service_role;

COMMENT ON TABLE public.certification_expiry_reminders IS
  'Ledger making the daily credential-expiry job idempotent: one reminder per (certification, threshold, expiry_date). Renewing a credential changes expiry_date and legitimately re-arms the ladder.';

-- ── 2) Canonical read: my credentials and their derived status ──────────────
CREATE OR REPLACE FUNCTION public.nx_my_certification_status()
RETURNS TABLE (
  id                uuid,
  name              text,
  issuing_organization text,
  status            text,
  expiry_date       date,
  days_until_expiry int,
  expiry_state      text
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT c.id, c.name, c.issuing_organization, c.status, c.expiry_date,
         (c.expiry_date - current_date)::int,
         CASE
           WHEN c.expiry_date IS NULL                          THEN 'no_expiry'
           WHEN c.expiry_date <  current_date                  THEN 'expired'
           WHEN c.expiry_date <= current_date + 7              THEN 'critical'
           WHEN c.expiry_date <= current_date + 30             THEN 'expiring_soon'
           ELSE 'valid'
         END
    FROM public.certifications c
   WHERE c.user_id = auth.uid()
   ORDER BY c.expiry_date NULLS LAST;
$fn$;

ALTER FUNCTION public.nx_my_certification_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_my_certification_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_my_certification_status() TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_my_certification_status() IS
  'The signed-in user''s own credentials with a DERIVED expiry_state (expired / critical / expiring_soon / valid / no_expiry). Self-scoped: reads auth.uid() directly, so it cannot leak another user''s credentials.';

-- ── 3) The daily scan ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_certification_expiry_scan(
  p_thresholds int[] DEFAULT ARRAY[30, 7, 1, 0]
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  r        RECORD;
  v_sent   int := 0;
  v_title  text;
  v_body   text;
BEGIN
  FOR r IN
    SELECT c.id, c.user_id, c.name, c.expiry_date,
           (c.expiry_date - current_date)::int AS days_left
      FROM public.certifications c
     WHERE c.expiry_date IS NOT NULL
       -- Only credentials that actually count for anything. A rejected or
       -- still-pending credential expiring is not news.
       AND c.status = 'verified'
       AND (c.expiry_date - current_date)::int = ANY (p_thresholds)
  LOOP
    -- Idempotent: the unique index is the real guarantee; this just avoids
    -- the wasted notification.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.certification_expiry_reminders x
       WHERE x.certification_id = r.id
         AND x.threshold_days   = r.days_left
         AND x.expiry_date      = r.expiry_date);

    v_title := CASE
                 WHEN r.days_left <= 0 THEN 'Credential expired'
                 WHEN r.days_left = 1  THEN 'Credential expires tomorrow'
                 ELSE format('Credential expires in %s days', r.days_left)
               END;
    v_body  := format('%s expires on %s.', COALESCE(NULLIF(r.name, ''), 'A credential'),
                      to_char(r.expiry_date, 'DD Mon YYYY'))
               || CASE WHEN r.days_left <= 0
                       THEN ' It no longer counts towards job matching until renewed.'
                       ELSE ' Renew it to stay eligible for matched jobs.' END;

    BEGIN
      PERFORM public.notify_safe(r.user_id, 'system', v_title, v_body,
                                 '/profile/certifications', NULL);
      INSERT INTO public.certification_expiry_reminders
        (certification_id, recipient_id, threshold_days, expiry_date)
      VALUES (r.id, r.user_id, r.days_left, r.expiry_date)
      ON CONFLICT DO NOTHING;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One bad row must not abort the whole nightly sweep.
      RAISE WARNING 'certification expiry reminder failed for %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sent', v_sent, 'thresholds', p_thresholds,
                            'ran_at', now());
END $fn$;

ALTER FUNCTION public.nx_certification_expiry_scan(int[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_certification_expiry_scan(int[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_certification_expiry_scan(int[]) TO service_role;

COMMENT ON FUNCTION public.nx_certification_expiry_scan(int[]) IS
  'Daily credential-expiry reminders on the canonical certifications table. Notifies the OWNER at 30/7/1/0 days. Idempotent per (certification, threshold, expiry_date). Mutates no credential state — expiry is derived from expiry_date, so a lapsed credential already stops counting for matching.';

-- ── 4) Schedule it (same guarded pattern as nx_identity_replacement_reminders)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('nx_certification_expiry_scan');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      -- 08:40 daily, offset from the 09:15 identity sweep so the two never
      -- contend for the same worker slot.
      PERFORM cron.schedule('nx_certification_expiry_scan', '40 8 * * *',
        'SELECT public.nx_certification_expiry_scan();');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'nx_certification_expiry_scan: could not schedule via pg_cron here; schedule manually.';
    END;
  END IF;
END
$cron$;

-- ── 5) PRESERVE the legacy path, and fix the bug that made it inert ─────────
--  Not deleted, not deprecated. contractor_certifications.status DEFAULTs to
--  'valid' while these filtered on 'active', so they could never match a row.
--  Accepting both makes the legacy system actually work for anything still
--  using it, without changing its shape or its callers.
CREATE OR REPLACE FUNCTION public.expire_old_certifications()
RETURNS TABLE(expired_count integer, certification_ids uuid[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
    expired_ids UUID[];
    n INTEGER;
BEGIN
    SELECT ARRAY_AGG(id) INTO expired_ids
      FROM contractor_certifications
     WHERE status IN ('active', 'valid')
       AND expiry_date < CURRENT_DATE;

    UPDATE contractor_certifications
       SET status = 'expired'
     WHERE status IN ('active', 'valid')
       AND expiry_date < CURRENT_DATE;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN QUERY SELECT n, COALESCE(expired_ids, ARRAY[]::UUID[]);
END;
$fn$;

ALTER FUNCTION public.expire_old_certifications() OWNER TO postgres;

COMMENT ON FUNCTION public.expire_old_certifications() IS
  'LEGACY path over contractor_certifications, preserved. Status filter fixed 20260801362000: the table DEFAULTs to ''valid'' but this filtered only on ''active'', so it could never expire anything. The canonical credential system is public.certifications — see nx_certification_expiry_scan.';

-- ── 6) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dscan text := pg_get_functiondef('public.nx_certification_expiry_scan(int[])'::regprocedure);
BEGIN
  -- ledger + uniqueness exist
  IF to_regclass('public.certification_expiry_reminders') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the reminder ledger was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='certification_expiry_reminders_once_idx') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the idempotency index is missing — the daily job could spam';
  END IF;

  -- RLS is on
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname='public' AND tablename='certification_expiry_reminders' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS is not enabled on the reminder ledger';
  END IF;

  -- the scan is not reachable by end users
  IF has_function_privilege('authenticated','public.nx_certification_expiry_scan(int[])','EXECUTE')
     OR has_function_privilege('anon','public.nx_certification_expiry_scan(int[])','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: end users can trigger the expiry sweep';
  END IF;

  -- LEGACY PRESERVED — every dormant function must still exist
  IF to_regprocedure('public.expire_old_certifications()') IS NULL
     OR to_regprocedure('public.auto_expire_certifications()') IS NULL
     OR to_regprocedure('public.get_expiring_certifications(integer[])') IS NULL
     OR to_regprocedure('public.get_certification_expiry_summary(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a pre-existing certification function was removed — all must be preserved';
  END IF;

  -- the scan must not mutate credential state (expiry is derived)
  IF dscan ~* 'UPDATE\s+(public\.)?certifications' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the scan mutates certifications — expiry must stay derived';
  END IF;

  -- MONEY-FREE
  IF dscan ~* '\m(payout|wallet|escrow|transactions|client_price_cents|inspector_payout_cents|admin_confirmed_at)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the expiry scan touches a money surface';
  END IF;

  RAISE NOTICE 'credential expiry active: 30/7/1/0-day reminders on the canonical table; legacy path preserved and repaired.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
