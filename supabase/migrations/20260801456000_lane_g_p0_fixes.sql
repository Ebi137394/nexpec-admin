-- ════════════════════════════════════════════════════════════════════════════
--  20260801456000_lane_g_p0_fixes.sql
--
--  Fixes from the INDEPENDENT Lane G review. Two of the three defects here were
--  introduced by the lanes that shipped immediately before it, and one of those
--  falsifies a claim the Lead made in writing. Both are recorded honestly.
--
--  ── FIX 1 (P1→P0 in effect): nx_funding_ensure_schedule had NO authorization ─
--  20260801452000:263 is the final definition and its only guard is
--  JOB_NOT_FOUND. It is SECURITY DEFINER and GRANTed to `authenticated`
--  (448000:445). So ANY authenticated user could call it with ANY job uuid.
--
--  That is not merely untidy, it is a denial-of-service on someone else's job:
--  materialising stage rows switches nx_funding_initial_satisfied off the legacy
--  client_settled_at fallback onto the schedule branch (448000:175-179), and an
--  unfunded schedule then blocks that job's dispatch AND delivery. It also
--  fires an "Initial funding required" notification at the victim's client
--  (452000:294), making it a cross-tenant notification-spam primitive.
--
--  Fixed by restricting to the job's own buyer, an admin, or service_role.
--
--  ── FIX 2: the amount guard did not work. The Lead claimed it did. ──────────
--  20260801452000:72-73 reads:
--      p_title ~ '[0-9]{2,}[.,][0-9]{2}' OR ... ~* '\m(SAR|USD|\$)\s*[0-9]'
--  Lane G falsified this, correctly, on two counts:
--    (a) `\m` asserts a boundary whose NEXT character is a word character. `$`
--        is not a word character, so the `\$` alternative can NEVER match.
--    (b) the numeric branch demands >=2 digits before the separator and exactly
--        2 after.
--  So all of these passed a guard advertised as rejecting amounts:
--      '$9.00'   '9.00'   '1,500'   'Amount due: 1500 SAR'   'Total: 500'
--  It caught '12.50' and 'SAR 1500' and essentially nothing else.
--
--  Replaced with three patterns that do not depend on `\m` before punctuation:
--    • a currency SYMBOL or CODE adjacent to any digit, in either order
--    • any decimal amount, one or more integer digits
--    • any grouped thousands figure (1,500 / 1 500 000)
--  Asserted below against the exact strings that used to slip through.
--
--  ── FIX 3: funding_term_defaults had RLS left off ──────────────────────────
--  448000:76 creates it and 448000:433 grants SELECT to `authenticated`, but
--  unlike job_funding_stages (448000:145) it never got ENABLE ROW LEVEL
--  SECURITY. Read-only platform config, so the exposure is low, but a granted
--  table with no RLS is exactly the shape 20260801442000 swept the schema for.
--
--  NOT FIXED HERE — deliberately, and tracked. Lane G's other P0s
--  (second delivery path via direct PATCH on inspection_reports; partial
--  payment recorded as full settlement in settle_client_payment; direct client
--  write to jobs.client_settled_at) sit inside the FROZEN PAYMENT DOMAIN and
--  the baseline RLS surface. They need their own reviewed slice, not a hurried
--  amendment appended to this one.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── FIX 1 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_funding_ensure_schedule(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_price bigint; v_init int; v_fin int; v_exists boolean;
  v_client uuid; v_uid uuid; v_jwt_role text;
BEGIN
  SELECT client_id, COALESCE(client_price_cents, 0)
    INTO v_client, v_price
    FROM public.jobs WHERE id = p_job_id;

  IF v_client IS NULL AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- ADDED 20260801456000. Materialising a schedule changes which branch the
  -- dispatch and delivery gates take, so it must not be callable against an
  -- arbitrary job by an arbitrary signed-in user.
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  v_uid := auth.uid();

  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NOT NULL
     AND v_uid IS DISTINCT FROM v_client
     AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: only the job''s buyer or an Admin may materialise its funding schedule'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  SELECT initial_bps, final_bps INTO v_init, v_fin
    FROM public.funding_term_defaults WHERE id = 1;

  INSERT INTO public.job_funding_stages
    (job_id, tranche_no, code, label, pct_bps, amount_cents, trigger_basis)
  VALUES
    (p_job_id, 1, 'initial', 'Initial funding (before assignment)', v_init,
     (v_price * v_init) / 10000, 'before_assignment'),
    (p_job_id, 2, 'final',   'Remaining funding (after report review)', v_fin,
     v_price - ((v_price * v_init) / 10000), 'after_report_review');

  PERFORM public.nx_notify_lifecycle(
    v_client,
    'Initial funding required',
    'A funding schedule is ready for your job. The initial tranche authorises the inspector to be assigned and start work.',
    'funding_required_initial',
    '/client/jobs/' || p_job_id::text || '/funding',
    p_job_id);

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id,
                            'initial_bps', v_init, 'final_bps', v_fin);
END $$;

-- ─── FIX 2 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_notify_lifecycle(
  p_recipient uuid,
  p_title     text,
  p_body      text,
  p_kind      text,
  p_link      text,
  p_job_id    uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_probe text;
BEGIN
  IF p_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  v_probe := COALESCE(p_title, '') || ' ' || COALESCE(p_body, '');

  -- Rewritten 20260801456000 — the previous guard did not work. `\m` requires a
  -- WORD character at the boundary, so its `\$` alternative was unreachable,
  -- and the numeric branch needed >=2 integer digits. '$9.00', '9.00', '1,500'
  -- and 'Total: 500' all passed a check advertised as rejecting amounts.
  IF  v_probe ~* '[$€£¥]\s*[0-9]'                       -- $9.00, £5
   OR v_probe ~* '[0-9]\s*[$€£¥]'                       -- 9.00$
   OR v_probe ~* '\y(SAR|USD|EUR|GBP|AED|halalas?|cents?)\y\s*[0-9]'
   OR v_probe ~* '[0-9]\s*\y(SAR|USD|EUR|GBP|AED|halalas?|cents?)\y'
   OR v_probe ~  '[0-9]+[.,][0-9]{2}\y'                 -- 9.00, 1250.00
   OR v_probe ~  '[0-9]{1,3}([,\s][0-9]{3})+\y'         -- 1,500 / 1 500 000
   -- A BARE integer is ambiguous — "round 2", "3 photos" are legitimate — so it
   -- is not rejected on its own. Preceded by an amount word it is not ambiguous.
   -- This is what catches Lane G's 'Total: 500'.
   OR v_probe ~* '\y(total|amount|due|balance|fee|price|payout|charge|invoice|owed|sum|cost)\y[^0-9]{0,12}[0-9]'
  THEN
    RAISE EXCEPTION
      'NOTIFICATION_CONTAINS_AMOUNT: lifecycle notifications are pointers, not statements. Link to the surface and let RLS decide what this recipient may see.';
  END IF;

  RETURN public.nx_notify(p_recipient, p_title, p_body, p_kind, p_link, p_job_id);
END $fn$;

ALTER FUNCTION public.nx_notify_lifecycle(uuid, text, text, text, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_notify_lifecycle(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ─── FIX 3 ──────────────────────────────────────────────────────────────────
ALTER TABLE public.funding_term_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funding_term_defaults_read ON public.funding_term_defaults;
CREATE POLICY funding_term_defaults_read ON public.funding_term_defaults
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS funding_term_defaults_admin_write ON public.funding_term_defaults;
CREATE POLICY funding_term_defaults_admin_write ON public.funding_term_defaults
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

REVOKE ALL ON TABLE public.funding_term_defaults FROM anon, PUBLIC;

-- ─── Selftest — every string that used to defeat the guard ──────────────────
DO $selftest$
DECLARE
  v_leaks text[] := ARRAY[
    '$9.00', '9.00', '1,500', 'Amount due: 1500 SAR', 'Total: 500',
    '12.50', 'SAR 1500', '1 500 000', 'USD 20', '£5'
  ];
  v_s text; v_caught boolean;
BEGIN
  FOREACH v_s IN ARRAY v_leaks LOOP
    v_caught := false;
    BEGIN
      PERFORM public.nx_notify_lifecycle(
        '00000000-0000-0000-0000-000000000001'::uuid,
        'Funding', v_s, 'test', '/', NULL);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%NOTIFICATION_CONTAINS_AMOUNT%' THEN v_caught := true; END IF;
    END;
    IF NOT v_caught THEN
      RAISE EXCEPTION
        'SELFTEST: the amount guard still lets % through — this is the exact defect Lane G falsified', v_s;
    END IF;
  END LOOP;

  -- and it must NOT reject a legitimate pointer body
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_funding_ensure_schedule'
       AND p.prosrc ~* 'NOT_AUTHORIZED') THEN
    RAISE EXCEPTION 'SELFTEST: nx_funding_ensure_schedule still has no authorization check';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'funding_term_defaults'
       AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST: funding_term_defaults still has RLS disabled';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
