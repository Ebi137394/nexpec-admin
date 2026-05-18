-- ════════════════════════════════════════════════════════════════════════════
--  hire-loop-table-consolidation.sql
--  NEXPEC — HIRE-008 strike: applications-table fragmentation
--
--  CORRECTED VERSION (v3). Previous attempts assumed legacy columns
--  existed on job_applications based on frontend code that may have
--  been writing to columns that never made it into the DB schema.
--  This version probes information_schema.columns AT MIGRATION TIME
--  and builds the backfill SELECT dynamically from what actually
--  exists. No more schema inventions.
--
--  Strategy unchanged:
--    1. Add last_viewed_by_client to the canonical applications table.
--       (This column lives on canonical going forward, regardless of
--       whether the legacy table had it.)
--    2. Probe job_applications' actual columns. Backfill into
--       applications using only the columns that exist; map missing
--       legacy columns to safe defaults (NULL / now() / 'pending').
--    3. DROP the legacy table (no CASCADE — fails loud on hidden deps).
--    4. Recreate job_applications as a VIEW over applications with
--       legacy column-name aliases. security_invoker=true.
--    5. INSTEAD OF INSERT/UPDATE/DELETE triggers translate writes to
--       the canonical table. Only the canonical schema is touched, so
--       no further legacy-column assumptions are made.
--
--  Safe to re-run. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — Ensure canonical applications has last_viewed_by_client
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS last_viewed_by_client timestamptz;

COMMENT ON COLUMN public.applications.last_viewed_by_client IS
  'When the hiring party first viewed this application. Added in HIRE-008. May be NULL for historical rows backfilled from the legacy job_applications table (the column never existed there).';


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — Backfill from job_applications → applications (DYNAMIC)
-- ────────────────────────────────────────────────────────────────────────────
-- We do not hard-code any legacy column reference besides the two columns
-- that MUST exist for the backfill to be meaningful: job_id and inspector_id.
-- Every other column is probed; if absent, the canonical field receives a
-- safe default. A RAISE NOTICE prints the legacy schema so you can audit
-- exactly what was found.

DO $$
DECLARE
  v_legacy_exists  boolean;
  v_legacy_cols    text[];
  v_required_ok    boolean;
  v_skipped        int := 0;
  v_migrated       int := 0;
  v_sql            text;

  -- per-column probe results
  v_has_status              boolean;
  v_has_cover_letter        boolean;
  v_has_proposed_price      boolean;
  v_has_created_at          boolean;
  v_has_updated_at          boolean;
  v_has_last_viewed         boolean;
  v_has_id                  boolean;

  -- per-column SELECT expressions (built dynamically)
  v_sel_id             text;
  v_sel_status         text;
  v_sel_cover          text;
  v_sel_price          text;
  v_sel_last_viewed    text;
  v_sel_created_at     text;
  v_sel_updated_at     text;
BEGIN
  -- 1. Confirm legacy table exists as a base table.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'job_applications'
      AND table_type   = 'BASE TABLE'
  ) INTO v_legacy_exists;

  IF NOT v_legacy_exists THEN
    RAISE NOTICE '[hire-008] job_applications is not a base table — nothing to backfill.';
    RETURN;
  END IF;

  -- 2. Snapshot the legacy column list. This is the audit trail of "what
  --    the DB actually had" at migration time — printed for transparency.
  SELECT array_agg(column_name ORDER BY column_name)
    INTO v_legacy_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'job_applications';

  RAISE NOTICE '[hire-008] Legacy job_applications schema: %', v_legacy_cols;

  -- 3. Required-column gate. Without job_id + inspector_id the backfill
  --    has no meaningful join into applications. Abort cleanly if either
  --    is missing — the transaction rollback will leave Section 1 intact
  --    on retry.
  v_required_ok :=
       ('job_id'       = ANY(v_legacy_cols))
   AND ('inspector_id' = ANY(v_legacy_cols));

  IF NOT v_required_ok THEN
    RAISE EXCEPTION
      '[hire-008] Legacy job_applications is missing required column(s) job_id and/or inspector_id. Cannot backfill. Inspect schema: %',
      v_legacy_cols;
  END IF;

  -- 4. Probe optional columns.
  v_has_id             := 'id'                    = ANY(v_legacy_cols);
  v_has_status         := 'status'                = ANY(v_legacy_cols);
  v_has_cover_letter   := 'cover_letter'          = ANY(v_legacy_cols);
  v_has_proposed_price := 'proposed_price_cents'  = ANY(v_legacy_cols);
  v_has_created_at     := 'created_at'            = ANY(v_legacy_cols);
  v_has_updated_at     := 'updated_at'            = ANY(v_legacy_cols);
  v_has_last_viewed    := 'last_viewed_by_client' = ANY(v_legacy_cols);

  -- 5. Build per-column SELECT fragments.
  v_sel_id          := CASE WHEN v_has_id             THEN 'ja.id'
                            ELSE 'gen_random_uuid()' END;
  v_sel_status      := CASE WHEN v_has_status         THEN 'CASE WHEN ja.status = ''client_selected'' THEN ''CLIENT_SELECTED'' ELSE ja.status END'
                            ELSE '''pending''' END;
  v_sel_cover       := CASE WHEN v_has_cover_letter   THEN 'ja.cover_letter'
                            ELSE 'NULL::text' END;
  v_sel_price       := CASE WHEN v_has_proposed_price THEN 'ja.proposed_price_cents'
                            ELSE 'NULL::bigint' END;
  v_sel_created_at  := CASE WHEN v_has_created_at     THEN 'ja.created_at'
                            ELSE 'now()' END;
  v_sel_updated_at  := CASE
                            WHEN v_has_updated_at AND v_has_created_at THEN 'COALESCE(ja.updated_at, ja.created_at)'
                            WHEN v_has_updated_at                       THEN 'ja.updated_at'
                            WHEN v_has_created_at                       THEN 'ja.created_at'
                            ELSE 'now()' END;
  v_sel_last_viewed := CASE WHEN v_has_last_viewed    THEN 'ja.last_viewed_by_client'
                            ELSE 'NULL::timestamptz' END;

  -- 6. Count rows we won't migrate because the canonical already has them.
  EXECUTE
    'SELECT count(*) FROM public.job_applications ja
     WHERE EXISTS (
       SELECT 1 FROM public.applications a
       WHERE a.job_id = ja.job_id AND a.applicant_id = ja.inspector_id
     )'
  INTO v_skipped;

  -- 7. Build and execute the dynamic backfill.
  v_sql := format($X$
    INSERT INTO public.applications (
      id, job_id, applicant_id,
      status, cover_note, bid_amount_cents,
      last_viewed_by_client, created_at, updated_at
    )
    SELECT
      %s,             -- id
      ja.job_id,
      ja.inspector_id,
      %s,             -- status (normalized)
      %s,             -- cover_note  ← cover_letter
      %s,             -- bid_amount_cents  ← proposed_price_cents
      %s,             -- last_viewed_by_client
      %s,             -- created_at
      %s              -- updated_at
    FROM public.job_applications ja
    WHERE NOT EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = ja.job_id AND a.applicant_id = ja.inspector_id
    )
  $X$,
    v_sel_id,
    v_sel_status,
    v_sel_cover,
    v_sel_price,
    v_sel_last_viewed,
    v_sel_created_at,
    v_sel_updated_at
  );

  EXECUTE v_sql;
  GET DIAGNOSTICS v_migrated = ROW_COUNT;

  RAISE NOTICE '[hire-008] Backfill complete. Migrated: %, skipped (already canonical): %.',
    v_migrated, v_skipped;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — Drop the legacy table
-- ────────────────────────────────────────────────────────────────────────────
-- Plain DROP (no CASCADE). If anything depends on job_applications, the
-- transaction aborts and the failure tells us what.

DROP TABLE IF EXISTS public.job_applications;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — Recreate job_applications as a back-compat VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Reads ONLY from the canonical applications table — no legacy schema
-- assumed. last_viewed_by_client was just added to applications in
-- Section 1, so it's safe to project here.

CREATE OR REPLACE VIEW public.job_applications
WITH (security_invoker = true) AS
SELECT
  id,
  job_id,
  applicant_id           AS inspector_id,
  status,
  cover_note             AS cover_letter,
  bid_amount_cents       AS proposed_price_cents,
  last_viewed_by_client,
  created_at,
  updated_at
FROM public.applications;

COMMENT ON VIEW public.job_applications IS
  'DEPRECATED back-compat view. Canonical entity is public.applications. Aliases legacy column names (inspector_id, cover_letter, proposed_price_cents). INSTEAD OF triggers redirect writes to the underlying table. New code MUST query public.applications directly.';


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5 — INSTEAD OF triggers on the view
-- ────────────────────────────────────────────────────────────────────────────
-- Write to canonical columns only. The view's column aliases (NEW.inspector_id,
-- NEW.cover_letter, NEW.proposed_price_cents) are translated to the canonical
-- column names at write time. No legacy schema is touched.

-- ── INSERT ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_applications_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
BEGIN
  INSERT INTO public.applications (
    id, job_id, applicant_id,
    status, cover_note, bid_amount_cents,
    last_viewed_by_client,
    created_at, updated_at
  ) VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.job_id,
    NEW.inspector_id,                       -- view alias → canonical applicant_id
    CASE WHEN NEW.status = 'client_selected' THEN 'CLIENT_SELECTED'
         ELSE COALESCE(NEW.status, 'pending') END,
    NEW.cover_letter,                       -- view alias → canonical cover_note
    NEW.proposed_price_cents,               -- view alias → canonical bid_amount_cents
    NEW.last_viewed_by_client,
    COALESCE(NEW.created_at, now()),
    COALESCE(NEW.updated_at, now())
  )
  RETURNING id INTO v_new_id;

  NEW.id := v_new_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_applications_insert_trigger ON public.job_applications;
CREATE TRIGGER job_applications_insert_trigger
  INSTEAD OF INSERT ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.job_applications_insert_trigger();


-- ── UPDATE ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_applications_update_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.applications
  SET
    job_id                = NEW.job_id,
    applicant_id          = NEW.inspector_id,           -- view alias → canonical
    status                = CASE WHEN NEW.status = 'client_selected' THEN 'CLIENT_SELECTED'
                                 ELSE NEW.status END,
    cover_note            = NEW.cover_letter,           -- view alias → canonical
    bid_amount_cents      = NEW.proposed_price_cents,   -- view alias → canonical
    last_viewed_by_client = NEW.last_viewed_by_client,
    updated_at            = COALESCE(NEW.updated_at, now())
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_applications_update_trigger ON public.job_applications;
CREATE TRIGGER job_applications_update_trigger
  INSTEAD OF UPDATE ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.job_applications_update_trigger();


-- ── DELETE ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_applications_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.applications WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS job_applications_delete_trigger ON public.job_applications;
CREATE TRIGGER job_applications_delete_trigger
  INSTEAD OF DELETE ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.job_applications_delete_trigger();


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6 — Grants
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_applications TO authenticated;
REVOKE EXECUTE ON FUNCTION public.job_applications_insert_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.job_applications_update_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.job_applications_delete_trigger() FROM PUBLIC;


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — run after the COMMIT
-- ════════════════════════════════════════════════════════════════════════════

-- A. last_viewed_by_client landed on canonical
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='applications'
--   AND column_name='last_viewed_by_client';

-- B. job_applications is now a view
-- SELECT table_type FROM information_schema.tables
-- WHERE table_schema='public' AND table_name='job_applications';
-- Expected: 'VIEW'

-- C. View exposes legacy column names
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='job_applications'
-- ORDER BY ordinal_position;
-- Expected: id, job_id, inspector_id, status, cover_letter,
--           proposed_price_cents, last_viewed_by_client,
--           created_at, updated_at

-- D. Round-trip: legacy write reaches canonical table.
-- Replace UUIDs with real values.
-- BEGIN;
--   INSERT INTO public.job_applications
--     (job_id, inspector_id, status, cover_letter, proposed_price_cents)
--   VALUES
--     ('<existing-open-job-uuid>'::uuid, '<existing-inspector-uuid>'::uuid,
--      'pending', 'view-trigger smoke', 1000)
--   RETURNING id;
--   SELECT id, job_id, applicant_id, status, cover_note, bid_amount_cents
--   FROM public.applications
--   WHERE applicant_id = '<existing-inspector-uuid>'::uuid
--   ORDER BY created_at DESC LIMIT 1;
-- ROLLBACK;

-- E. Lowercase normalization through view.
-- BEGIN;
--   UPDATE public.job_applications SET status='client_selected'
--   WHERE id='<some-existing-application-id>'::uuid;
--   SELECT status FROM public.applications
--   WHERE id='<some-existing-application-id>'::uuid;
--   -- Expected: 'CLIENT_SELECTED'
-- ROLLBACK;
