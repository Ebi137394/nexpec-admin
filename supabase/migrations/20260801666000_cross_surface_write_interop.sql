-- ════════════════════════════════════════════════════════════════════════════
--  20260801666000_cross_surface_write_interop.sql
--
--  Three pairs of tables where web and mobile write DIFFERENT storage for the
--  same concept, so each surface is blind to what the other saved. One of them
--  is not merely a visibility gap — it makes the web upload impossible.
--
--  ── 1. inspector_documents: the web upload CANNOT SUCCEED ──────────────────
--  file_url is NOT NULL with no default (verified on Production). The web
--  action apps/web/src/lib/actions/inspectorDocuments.ts:116 inserts
--  `file_path` and never `file_url`, so every web document upload fails with
--  23502 — and the error branch then DELETES the uploaded object, so the user
--  sees "Upload failed. Try again." with nothing kept. Mobile writes the
--  mirror image: app/(inspector)/profile/verification.tsx:895 sets file_url
--  and never file_path, and the web reader
--  (apps/web/src/lib/data/inspectorDocuments.ts:32) selects file_path only.
--  public.inspector_documents holds ZERO rows platform-wide, consistent with
--  the web path never having worked.
--
--  Both columns hold the SAME KIND of value — a storage OBJECT PATH, not a
--  URL. Mobile's own comment says so ("Store the storage PATH (not a public
--  URL) ... the inspector-docs bucket is owner+admin-only, so getPublicUrl
--  would yield a dead link"). Nothing signs or publishes either column; signed
--  URLs are minted at read time. So filling one from the other is a rename,
--  not a semantic change.
--
--  ── 2. equipment  vs  inspector_equipment ──────────────────────────────────
--  Mobile writes/reads public.equipment (10 rows). Web writes/reads
--  public.inspector_equipment (0 rows). Neither sees the other's.
--
--  ── 3. expenses  vs  job_expenses ──────────────────────────────────────────
--  Mobile writes public.expenses (0 rows); every other surface reads
--  public.job_expenses (1 row).
--
--  ── APPROACH ───────────────────────────────────────────────────────────────
--  Compatibility ADAPTERS, not a schema merge. Each pair keeps its own table
--  and its own readers; a trigger keeps them consistent. This is deliberately
--  chosen over "pick a winner and rewrite every call site" because the losing
--  table's writer is in the PUBLISHED mobile binary, which cannot be changed
--  without a store release. A backend adapter fixes the phones already in
--  users' hands.
--
--  Recursion is prevented with pg_trigger_depth() = 0 rather than a session
--  flag, so a mirror never re-enters and the pair cannot ping-pong.
--
--  Mirrors are INSERT-time only and never overwrite a value the caller
--  supplied. No existing row is rewritten by this migration except the
--  inspector_documents backfill, which only fills NULLs.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. inspector_documents ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_inspector_document_paths()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Both columns carry a storage object path. Fill whichever the caller
  -- omitted; never overwrite one that was supplied.
  IF NEW.file_path IS NULL OR btrim(NEW.file_path) = '' THEN
    NEW.file_path := NULLIF(btrim(COALESCE(NEW.file_url, '')), '');
  END IF;
  IF NEW.file_url IS NULL OR btrim(NEW.file_url) = '' THEN
    NEW.file_url := NULLIF(btrim(COALESCE(NEW.file_path, '')), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspector_document_paths ON public.inspector_documents;
CREATE TRIGGER trg_inspector_document_paths
  BEFORE INSERT OR UPDATE ON public.inspector_documents
  FOR EACH ROW EXECUTE FUNCTION public.nx_inspector_document_paths();

-- Fill NULLs on any existing row. (Zero rows today; idempotent regardless.)
UPDATE public.inspector_documents
   SET file_path = file_url
 WHERE file_path IS NULL AND file_url IS NOT NULL;

-- ── 2. equipment  <->  inspector_equipment ────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_mirror_equipment_to_inspector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only mirror a genuine mobile-side insert, never our own counterpart.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.inspector_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.inspector_equipment
    (inspector_id, name, serial_number, next_calibration_due, notes)
  SELECT NEW.inspector_id, NEW.name, NEW.serial_number, NEW.calibration_expiry,
         'Mirrored from the mobile equipment list.'
   WHERE NOT EXISTS (
     SELECT 1 FROM public.inspector_equipment e
      WHERE e.inspector_id = NEW.inspector_id
        AND e.name = NEW.name
        AND e.serial_number IS NOT DISTINCT FROM NEW.serial_number);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nx_mirror_inspector_to_equipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.inspector_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.equipment
    (inspector_id, user_id, name, serial_number, calibration_expiry)
  SELECT NEW.inspector_id, NEW.inspector_id, NEW.name, NEW.serial_number,
         NEW.next_calibration_due
   WHERE NOT EXISTS (
     SELECT 1 FROM public.equipment e
      WHERE e.inspector_id = NEW.inspector_id
        AND e.name = NEW.name
        AND e.serial_number IS NOT DISTINCT FROM NEW.serial_number);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_equipment_to_inspector ON public.equipment;
CREATE TRIGGER trg_mirror_equipment_to_inspector
  AFTER INSERT ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_equipment_to_inspector();

DROP TRIGGER IF EXISTS trg_mirror_inspector_to_equipment ON public.inspector_equipment;
CREATE TRIGGER trg_mirror_inspector_to_equipment
  AFTER INSERT ON public.inspector_equipment
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_inspector_to_equipment();

-- Backfill the 10 existing mobile-side rows into the web-side table.
INSERT INTO public.inspector_equipment
  (inspector_id, name, serial_number, next_calibration_due, notes)
SELECT e.inspector_id, e.name, e.serial_number, e.calibration_expiry,
       'Mirrored from the mobile equipment list.'
  FROM public.equipment e
 WHERE e.inspector_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.inspector_equipment ie
      WHERE ie.inspector_id = e.inspector_id
        AND ie.name = e.name
        AND ie.serial_number IS NOT DISTINCT FROM e.serial_number);

-- ── 3. expenses -> job_expenses ───────────────────────────────────────────
-- One-way only. job_expenses is authoritative for approval/reimbursement, and
-- public.expenses has no approval columns to carry a decision back into. A
-- two-way mirror would risk creating a SECOND payable for one service, which
-- is the specific outcome to avoid.
CREATE OR REPLACE FUNCTION public.nx_mirror_expense_to_job_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.job_id IS NULL OR NEW.user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.job_expenses
    (job_id, inspector_id, description, amount, receipt_url, status)
  SELECT NEW.job_id, NEW.user_id, NEW.description, NEW.amount,
         NEW.receipt_url, COALESCE(NEW.status, 'pending')
   WHERE NOT EXISTS (
     SELECT 1 FROM public.job_expenses je
      WHERE je.job_id = NEW.job_id
        AND je.inspector_id = NEW.user_id
        AND je.amount = NEW.amount
        AND je.description IS NOT DISTINCT FROM NEW.description);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_expense_to_job_expense ON public.expenses;
CREATE TRIGGER trg_mirror_expense_to_job_expense
  AFTER INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_expense_to_job_expense();

COMMIT;
