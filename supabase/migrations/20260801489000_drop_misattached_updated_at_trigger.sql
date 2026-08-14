-- ════════════════════════════════════════════════════════════════════════════
--  20260801488000_drop_misattached_updated_at_trigger.sql
--
--  P1 — every UPDATE of public.contractor_certifications raises.
--
--  ── REPRODUCED, NOT INFERRED ───────────────────────────────────────────────
--      UPDATE public.contractor_certifications SET title = 'API-653' WHERE id = …
--      ERROR:  record "new" has no field "updated_at"
--
--  This is the single shared cause behind six failing pgTAP suites
--  (certification_expiry, inspection_item_ncr_link, itp_points, multi_visit,
--  senior_review_behaviour, visit_evidence). One defect, six symptoms.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  Trigger `update_certifications_updated_at` on contractor_certifications runs
--  the generic `update_updated_at_column()`, whose whole body is
--  `NEW.updated_at := now()`. But contractor_certifications has no such column:
--      id, contractor_id, title, issued_by, expiry_date, cert_url, status,
--      created_at
--  So the assignment fails on every UPDATE.
--
--  The trigger NAME is the tell. `update_certifications_updated_at` is the name
--  of the function the baseline attaches to public.certifications — a DIFFERENT
--  table, which does have updated_at (baseline:27406, trigger
--  `certifications_updated_at`). This is a copy of that wiring landed on the
--  wrong, similarly-named table.
--
--  ── WHY THE COLUMN IS NOT ADDED ────────────────────────────────────────────
--  Adding updated_at here would make the error disappear while inventing a
--  timestamp nothing reads, writes deliberately, or backfills — a column whose
--  only purpose is to satisfy a trigger that should not be attached. That is
--  cosmetic schema growth on a credentials table, and it would leave the real
--  fault (wrong wiring) in place to be copied again.
--
--  The table records an issued credential: id, issuer, expiry, status,
--  created_at. Its mutable state is `status`, and that transition is already
--  audited by protect_certification_verification, which enforces that only an
--  admin may verify — and which correctly does NOT touch NEW.updated_at, with a
--  comment saying exactly why. The audit story is covered; a second, unread
--  timestamp adds nothing.
--
--  ── SCOPE CHECKED ──────────────────────────────────────────────────────────
--  update_updated_at_column() is fine everywhere else: the other 2 tables using
--  it all have updated_at. Only this one attachment is wrong, so the function
--  is left alone and only the misattached trigger is dropped.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER IF EXISTS update_certifications_updated_at
  ON public.contractor_certifications;

-- ─── Selftest — behavioural, and repo-wide ──────────────────────────────────
DO $selftest$
DECLARE v_bad text;
BEGIN
  -- 1. The specific defect is gone.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
       AND c.relname = 'contractor_certifications'
       AND t.tgname = 'update_certifications_updated_at'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: the misattached updated_at trigger is still on contractor_certifications';
  END IF;

  -- 2. The class is gone. ANY trigger whose function assigns NEW.<col> for a
  --    column its table does not have will raise at runtime, so catch the
  --    whole shape rather than this one instance. Restricted to a real
  --    assignment (`NEW.updated_at :=`) so a mere mention in a comment — which
  --    is how protect_certification_verification documents NOT doing this —
  --    is not a false positive.
  FOR v_bad IN
    SELECT t.tgname || ' on ' || c.relname
      FROM pg_trigger t
      JOIN pg_proc  p ON p.oid = t.tgfoid
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE NOT t.tgisinternal
       AND p.prosrc ~ 'NEW\.updated_at\s*:='
       AND NOT EXISTS (
             SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public'
                AND col.table_name = c.relname
                AND col.column_name = 'updated_at')
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % assigns NEW.updated_at but its table has no such column — every write to it would raise', v_bad;
  END LOOP;

  -- 3. And the generic toucher is still doing its real job elsewhere; this
  --    migration must not have collaterally removed it.
  IF (SELECT count(*) FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal AND p.proname = 'update_updated_at_column') = 0 THEN
    RAISE EXCEPTION
      'SELFTEST: update_updated_at_column is no longer attached anywhere — the drop was too broad';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
