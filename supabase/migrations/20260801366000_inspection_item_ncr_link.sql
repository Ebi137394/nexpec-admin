-- ════════════════════════════════════════════════════════════════════════════
--  20260801366000_inspection_item_ncr_link.sql
--
--  FAILED INSPECTION ITEM → EXISTING NCR. A connection, not a second system.
--
--  ── WHAT ALREADY EXISTS (verified, and reused verbatim) ────────────────────
--  The NCR system is mature and is NOT touched by this migration:
--      flash_reports            full record: category, severity, location,
--                               occurred_at, correlation_id, acknowledge /
--                               resolve pairs with CHECK-enforced integrity
--      flash_report_create      SECURITY DEFINER; authorises the caller as a
--                               job party or admin; snapshots reporter_role
--      flash_report_transition  open → acknowledged → in_remediation →
--                               resolved → closed → disputed
--      flash_report_attachments evidence
--  Structured inspection also already exists, in two shapes, and BOTH are kept:
--      inspection_scope_templates → inspection_evidence_requirements →
--      inspection_captures  (the compliance path; already offline-enabled via
--      src/core/offline/outbox.ts, and feeding the sealing flow)
--      inspection_items     (pass/fail/na against a report; currently read by
--                            one screen — app/inspector/seal-report.tsx)
--
--  ── THE ACTUAL GAP ─────────────────────────────────────────────────────────
--  Nothing joins them. An inspector can mark an item 'fail' and that failure
--  goes nowhere: no NCR is raised, no responsible party is assigned, and the
--  failure never appears in the flash-report workflow that exists precisely to
--  track non-conformances to closure.
--
--  This migration adds the join and NOTHING else:
--    • inspection_items.flash_report_id — a nullable link column
--    • nx_raise_ncr_from_inspection_item() — resolves the job from the item's
--      report, then DELEGATES to the existing flash_report_create. It creates
--      no table, defines no second state machine, and duplicates no logic. The
--      NCR it produces is an ordinary flash report, indistinguishable from a
--      manually raised one, and moves through the same transitions.
--
--  ── SAFETY ─────────────────────────────────────────────────────────────────
--   • Purely additive. No existing column, function, trigger or policy changes.
--   • Idempotent: an item already linked returns its existing NCR unchanged.
--   • Only a FAILED item may raise one — a passing item is not a
--     non-conformance.
--   • Authorization is NOT reimplemented: flash_report_create is called as the
--     invoking user, so its job-party check is the single source of truth. If
--     the caller may not raise an NCR on that job, this cannot either.
--   • MONEY-FREE. Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The link column ──────────────────────────────────────────────────────
ALTER TABLE public.inspection_items
  ADD COLUMN IF NOT EXISTS flash_report_id uuid
    REFERENCES public.flash_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inspection_items_flash_report_idx
  ON public.inspection_items (flash_report_id)
  WHERE flash_report_id IS NOT NULL;

COMMENT ON COLUMN public.inspection_items.flash_report_id IS
  'The NCR (flash report) raised from this failed item, if any. Nullable and additive: items created before 20260801366000, and every passing item, simply carry NULL.';

-- ── 2) Raise an NCR from a failed item, via the EXISTING NCR path ───────────
CREATE OR REPLACE FUNCTION public.nx_raise_ncr_from_inspection_item(
  p_item_id  uuid,
  p_severity text DEFAULT 'major',
  p_category text DEFAULT 'defect',
  p_note     text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql
    -- NOT SECURITY DEFINER, deliberately. This must run as the caller so that
    -- flash_report_create's own job-party authorization applies unchanged.
    -- Making this a definer would silently bypass it.
    SECURITY INVOKER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_item     RECORD;
  v_job_id   uuid;
  v_existing uuid;
  v_result   jsonb;
  v_new_id   uuid;
  v_title    text;
  v_desc     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '28000';
  END IF;

  SELECT i.id, i.report_id, i.description, i.status, i.location, i.notes,
         i.flash_report_id
    INTO v_item
    FROM public.inspection_items i
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection item % not found', p_item_id USING errcode = 'P0002';
  END IF;

  -- Idempotent: never raise a second NCR for the same item.
  IF v_item.flash_report_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'flash_report_id', v_item.flash_report_id,
                              'idempotent', true);
  END IF;

  IF COALESCE(v_item.status, '') <> 'fail' THEN
    RAISE EXCEPTION 'only a failed inspection item can raise an NCR (item status: %)',
      COALESCE(v_item.status, 'null') USING errcode = '22023';
  END IF;

  SELECT r.job_id INTO v_job_id
    FROM public.inspection_reports r WHERE r.id = v_item.report_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'inspection item % has no resolvable job', p_item_id USING errcode = 'P0002';
  END IF;

  -- flash_reports_description_len requires 20..5000 characters, so the
  -- description is composed to clear the floor even for a terse item.
  v_title := left('Failed inspection item: ' ||
                  COALESCE(NULLIF(btrim(v_item.description), ''), 'unspecified'), 200);
  v_desc  := 'A structured inspection item was recorded as FAILED.' || E'\n\n'
             || 'Item: ' || COALESCE(NULLIF(btrim(v_item.description), ''), 'unspecified') || E'\n'
             || 'Location: ' || COALESCE(NULLIF(btrim(v_item.location), ''), 'not recorded') || E'\n'
             || 'Inspector notes: ' || COALESCE(NULLIF(btrim(v_item.notes), ''), 'none') || E'\n'
             || COALESCE(E'\n' || btrim(p_note), '');

  -- DELEGATE. All authorization, role snapshotting, correlation and
  -- notification behaviour is the existing function's, unchanged.
  v_result := public.flash_report_create(
    v_job_id, p_category, p_severity, v_title, v_desc,
    NULLIF(btrim(coalesce(v_item.location, '')), ''), now());

  v_new_id := NULLIF(v_result->>'id', '')::uuid;
  IF v_new_id IS NULL THEN
    v_new_id := NULLIF(v_result->>'flash_report_id', '')::uuid;
  END IF;
  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'flash_report_create returned no id: %', v_result USING errcode = 'P0002';
  END IF;

  UPDATE public.inspection_items
     SET flash_report_id = v_new_id
   WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true, 'flash_report_id', v_new_id,
                            'job_id', v_job_id, 'item_id', p_item_id);
END $fn$;

ALTER FUNCTION public.nx_raise_ncr_from_inspection_item(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_raise_ncr_from_inspection_item(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_raise_ncr_from_inspection_item(uuid, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_raise_ncr_from_inspection_item(uuid, text, text, text) IS
  'Raises an NCR from a FAILED inspection item by delegating to the existing flash_report_create. Creates no parallel NCR system and no second state machine. SECURITY INVOKER on purpose so the existing job-party authorization applies. Idempotent per item.';

-- ── 3) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  d text := pg_get_functiondef('public.nx_raise_ncr_from_inspection_item(uuid,text,text,text)'::regprocedure);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_items'
                    AND column_name='flash_report_id') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the link column was not added';
  END IF;

  -- It must DELEGATE, never insert into flash_reports directly. A direct insert
  -- would bypass authorization, role snapshotting and correlation — i.e. it
  -- would be NCR v2 wearing NCR v1's table.
  IF position('flash_report_create' IN d) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the NCR bridge does not delegate to flash_report_create';
  END IF;
  IF d ~* 'INSERT\s+INTO\s+(public\.)?flash_reports\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the bridge writes flash_reports directly, bypassing the existing NCR path';
  END IF;

  -- Must NOT be SECURITY DEFINER — that would bypass the job-party check.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='nx_raise_ncr_from_inspection_item' AND prosecdef) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the bridge is SECURITY DEFINER and would bypass flash_report_create authorization';
  END IF;

  -- The existing NCR surface must be intact.
  IF to_regprocedure('public.flash_report_transition(uuid,text,text)') IS NULL
     OR to_regclass('public.flash_reports') IS NULL
     OR to_regclass('public.flash_report_attachments') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an existing NCR object is missing';
  END IF;

  -- MONEY-FREE
  IF d ~* '\m(payout|wallet|escrow|transactions|admin_confirmed_at|client_price_cents|inspector_payout_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the NCR bridge names a money surface';
  END IF;

  RAISE NOTICE 'failed inspection items can now raise an NCR through the existing flash-report path.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
