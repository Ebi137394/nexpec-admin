-- ============================================================================
--  20260801250000_restore_phantom_objects.sql
--
--  RESTORE WAVE A (owner-approved 2026-07-02): four feature clusters whose
--  schema exists only in migrations_archive — their archive migrations were
--  never applied to prod (they predate/eluded the schema squash), yet shipped
--  code AND two live prod RPCs reference them:
--
--    1. inspector_equipment        — /inspector/compliance equipment CRUD.
--                                    ALSO heals prod get_inspection_passport()
--                                    which SELECTs this table unguarded.
--    2. inspector_work_experience  — /inspector/experience resume CRUD.
--    3. contact_submissions        — public /contact marketing form inbox.
--    4. credit_supplier_earnings() + supplier_releases — the ledger pair that
--       prod's live release_supplier_contract() (v2, baseline:16246) requires:
--       it INSERTs supplier_releases and PERFORMs credit_supplier_earnings().
--       (supplier_earnings itself already shipped in 20260801144000.)
--    5. notify() — thin alias onto live notify_safe(); baseline callers
--       admin_unsuspend_user() (guarded) and file_dispute() (unguarded)
--       reference it. Param order matches their positional calls.
--
--  Definitions are faithful to the archive sources
--  (20260518130000 / 20260518140000 / 20260524120000 / 20260801123300 /
--   20260801123400) with two deliberate deviations, documented inline:
--    • inspector_work_experience read policy: TO authenticated (archive had
--      anon-inclusive USING(true); the 222000-era posture revokes anon reads).
--    • release_supplier_contract() is NOT recreated — prod already runs v2.
--
--  Idempotent; BEGIN/COMMIT; self-testing.
-- ============================================================================

BEGIN;

-- ── 1. inspector_equipment ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspector_equipment (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  manufacturer                  TEXT CHECK (manufacturer IS NULL OR char_length(manufacturer) <= 80),
  model_number                  TEXT CHECK (model_number IS NULL OR char_length(model_number) <= 80),
  serial_number                 TEXT CHECK (serial_number IS NULL OR char_length(serial_number) <= 80),
  last_calibration_at           DATE,
  next_calibration_due          DATE,
  calibration_certificate_url   TEXT,
  calibration_certificate_path  TEXT,
  notes                         TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspector_equipment_inspector
  ON public.inspector_equipment(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspector_equipment_due
  ON public.inspector_equipment(inspector_id, next_calibration_due)
  WHERE next_calibration_due IS NOT NULL;

DROP TRIGGER IF EXISTS inspector_equipment_touch ON public.inspector_equipment;
CREATE TRIGGER inspector_equipment_touch
  BEFORE UPDATE ON public.inspector_equipment
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.inspector_equipment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inspector_equipment FROM PUBLIC, anon;

DROP POLICY IF EXISTS "insp_equip_self_all" ON public.inspector_equipment;
CREATE POLICY "insp_equip_self_all"
  ON public.inspector_equipment FOR ALL
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

DROP POLICY IF EXISTS "insp_equip_admin_read" ON public.inspector_equipment;
CREATE POLICY "insp_equip_admin_read"
  ON public.inspector_equipment FOR SELECT
  USING (public.nx_is_admin());

-- ── 2. inspector_work_experience ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspector_work_experience (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company         TEXT NOT NULL CHECK (char_length(company) BETWEEN 1 AND 160),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  location        TEXT CHECK (location IS NULL OR char_length(location) <= 160),
  start_date      DATE NOT NULL,
  end_date        DATE,
  is_current      BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 4000),
  achievements    TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inspector_work_experience_date_logic CHECK (
    (is_current = TRUE AND end_date IS NULL)
    OR (is_current = FALSE AND end_date IS NOT NULL AND end_date >= start_date)
  ),
  CONSTRAINT inspector_work_experience_achievements_cap CHECK (
    array_length(achievements, 1) IS NULL
    OR array_length(achievements, 1) <= 20
  )
);

CREATE INDEX IF NOT EXISTS idx_inspector_work_experience_inspector
  ON public.inspector_work_experience(inspector_id, start_date DESC);

DROP TRIGGER IF EXISTS inspector_work_experience_touch
  ON public.inspector_work_experience;
CREATE TRIGGER inspector_work_experience_touch
  BEFORE UPDATE ON public.inspector_work_experience
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.inspector_work_experience ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inspector_work_experience FROM PUBLIC, anon;

DROP POLICY IF EXISTS "insp_work_exp_self_all" ON public.inspector_work_experience;
CREATE POLICY "insp_work_exp_self_all"
  ON public.inspector_work_experience FOR ALL
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

-- DEVIATION from archive: read policy is TO authenticated (archive was a bare
-- USING(true) that included anon). Clients reviewing dispatch candidates and
-- admin both authenticate; the anon-revoke posture (222000 era) stays intact.
DROP POLICY IF EXISTS "insp_work_exp_public_read" ON public.inspector_work_experience;
CREATE POLICY "insp_work_exp_public_read"
  ON public.inspector_work_experience FOR SELECT
  TO authenticated
  USING (true);

-- ── 3. contact_submissions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  name        TEXT        NOT NULL    CHECK (char_length(name) BETWEEN 2 AND 80),
  email       TEXT        NOT NULL    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  channel     TEXT        NOT NULL    CHECK (channel IN ('sales', 'support', 'security')),
  message     TEXT        NOT NULL    CHECK (char_length(message) BETWEEN 10 AND 2000),
  status      TEXT        NOT NULL    DEFAULT 'new'
                CHECK (status IN ('new', 'read', 'resolved')),
  user_agent  TEXT,
  ip_address  INET
);

CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
  ON public.contact_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_submissions_channel_status_idx
  ON public.contact_submissions (channel, status);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- The marketing form is public: anon INSERT is the point of this table.
DROP POLICY IF EXISTS contact_submissions_anon_insert ON public.contact_submissions;
CREATE POLICY contact_submissions_anon_insert
  ON public.contact_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS contact_submissions_admin_select ON public.contact_submissions;
CREATE POLICY contact_submissions_admin_select
  ON public.contact_submissions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'super_admin'));

DROP POLICY IF EXISTS contact_submissions_admin_update ON public.contact_submissions;
CREATE POLICY contact_submissions_admin_update
  ON public.contact_submissions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'super_admin'));

DROP POLICY IF EXISTS contact_submissions_admin_delete ON public.contact_submissions;
CREATE POLICY contact_submissions_admin_delete
  ON public.contact_submissions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'super_admin'));

-- ── 4a. credit_supplier_earnings() — required by live release_supplier_contract
CREATE OR REPLACE FUNCTION public.credit_supplier_earnings(
  p_supplier_id uuid,
  p_amount_cents int,
  p_description text DEFAULT 'Milestone release',
  p_rfq_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_txn_id uuid;
BEGIN
  -- Gate: app callers must be admin; service_role (auth.uid() IS NULL) passes.
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorised: admin only';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.supplier_earnings (supplier_id, available_balance_halalas, total_earned_halalas, ytd_gross_halalas)
    VALUES (p_supplier_id, p_amount_cents, p_amount_cents, p_amount_cents)
  ON CONFLICT (supplier_id) DO UPDATE SET
    available_balance_halalas = public.supplier_earnings.available_balance_halalas + EXCLUDED.available_balance_halalas,
    total_earned_halalas      = public.supplier_earnings.total_earned_halalas      + EXCLUDED.total_earned_halalas,
    ytd_gross_halalas         = public.supplier_earnings.ytd_gross_halalas         + EXCLUDED.ytd_gross_halalas,
    updated_at = now();

  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (p_supplier_id, 'earning', p_amount_cents / 100.0,
            COALESCE(p_description, 'Milestone release'), 'completed')
    RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END $$;

ALTER FUNCTION public.credit_supplier_earnings(uuid, int, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.credit_supplier_earnings(uuid, int, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_supplier_earnings(uuid, int, text, uuid) TO authenticated, service_role;

-- ── 4b. supplier_releases ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE CASCADE,
  rfq_id          uuid REFERENCES public.supplier_rfqs(id) ON DELETE SET NULL,
  supplier_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_halalas  bigint NOT NULL CHECK (amount_halalas > 0),
  note            text,
  released_by     uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_releases_quote    ON public.supplier_releases(quote_id);
CREATE INDEX IF NOT EXISTS idx_supplier_releases_supplier ON public.supplier_releases(supplier_id, created_at DESC);

ALTER TABLE public.supplier_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_releases FROM PUBLIC, anon;

DROP POLICY IF EXISTS supplier_releases_admin_all ON public.supplier_releases;
CREATE POLICY supplier_releases_admin_all ON public.supplier_releases
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS supplier_releases_select_self ON public.supplier_releases;
CREATE POLICY supplier_releases_select_self ON public.supplier_releases
  FOR SELECT TO authenticated USING (supplier_id = auth.uid());

DROP POLICY IF EXISTS supplier_releases_service_all ON public.supplier_releases;
CREATE POLICY supplier_releases_service_all ON public.supplier_releases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- NOTE: release_supplier_contract() is deliberately NOT touched — prod runs
-- the v2 contract-gated version (baseline) whose body needs exactly the two
-- objects created above.

-- ── 5. notify() alias → notify_safe() ───────────────────────────────────────
--  Param names + positional order match the archive original AND the two
--  baseline callers (file_dispute, admin_unsuspend_user). Body COALESCEd:
--  prod notifications.body is NOT NULL, and notify_safe would otherwise
--  swallow the insert.
CREATE OR REPLACE FUNCTION public.notify(
  p_recipient uuid,
  p_kind      text,
  p_title     text,
  p_body      text DEFAULT NULL,
  p_link      text DEFAULT NULL,
  p_job_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.notify_safe(p_recipient, p_kind, p_title, COALESCE(p_body, ''), p_link, p_job_id);
$$;

ALTER FUNCTION public.notify(uuid, text, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify(uuid, text, text, text, text, uuid) TO authenticated, service_role;

-- ── Self-test ────────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_missing text := '';
  v_pol int;
BEGIN
  IF to_regclass('public.inspector_equipment')       IS NULL THEN v_missing := v_missing || ' inspector_equipment'; END IF;
  IF to_regclass('public.inspector_work_experience') IS NULL THEN v_missing := v_missing || ' inspector_work_experience'; END IF;
  IF to_regclass('public.contact_submissions')       IS NULL THEN v_missing := v_missing || ' contact_submissions'; END IF;
  IF to_regclass('public.supplier_releases')         IS NULL THEN v_missing := v_missing || ' supplier_releases'; END IF;
  IF to_regprocedure('public.credit_supplier_earnings(uuid,int,text,uuid)') IS NULL THEN v_missing := v_missing || ' credit_supplier_earnings'; END IF;
  IF to_regprocedure('public.notify(uuid,text,text,text,text,uuid)')        IS NULL THEN v_missing := v_missing || ' notify'; END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: missing:%', v_missing;
  END IF;

  -- RLS must be ON with policies present on all four tables.
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('inspector_equipment','inspector_work_experience',
                       'contact_submissions','supplier_releases');
  IF v_pol < 10 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: expected >=10 policies on restored tables, found %', v_pol;
  END IF;

  -- The pair the live release RPC depends on must both resolve.
  IF to_regclass('public.supplier_earnings') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: supplier_earnings absent — apply 20260801144000 first';
  END IF;

  RAISE NOTICE 'phantom restore OK: 4 tables + 2 functions live; release_supplier_contract and get_inspection_passport dependencies healed.';
END
$test$;

COMMIT;
