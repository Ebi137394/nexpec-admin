-- ════════════════════════════════════════════════════════════════════════════
--  20260801686000_mirror_lifecycle.sql
--
--  The compatibility adapters added in 20260801666000 / 20260801674000 were
--  INSERT-only. Lifecycle testing found three real gaps:
--
--    E2  UPDATE on public.equipment never reached inspector_equipment, so the
--        web list kept showing a stale calibration date forever.
--    E3  DELETE left an orphan mirror row: the inspector deleted a tool on the
--        phone and it stayed on the web page.
--    D1  Updating inspector_documents.file_path left file_url pointing at the
--        OLD object. The two columns are both storage paths, so after a replace
--        one surface served the previous file — the worst of the three,
--        because the wrong document is worse than a missing one.
--
--  Expenses are deliberately NOT given update/delete mirroring:
--  public.job_expenses is authoritative for approval and reimbursement, and
--  propagating a mobile edit or delete backwards could rewrite or destroy a
--  settled financial decision. Verified: re-submitting an identical expense
--  after approval leaves ONE row, still 'approved'.
--
--  Recursion is blocked with pg_trigger_depth(), as before.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── inspector_documents: keep the two path columns consistent on UPDATE ───
CREATE OR REPLACE FUNCTION public.nx_inspector_document_paths()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.file_path IS NULL OR btrim(NEW.file_path) = '' THEN
      NEW.file_path := NULLIF(btrim(COALESCE(NEW.file_url, '')), '');
    END IF;
    IF NEW.file_url IS NULL OR btrim(NEW.file_url) = '' THEN
      NEW.file_url := NULLIF(btrim(COALESCE(NEW.file_path, '')), '');
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. Only follow the column that actually changed, and only when the
  -- other one was MIRRORING it. A file_url that genuinely differed (a legacy
  -- absolute URL, say) is left alone rather than silently overwritten.
  IF NEW.file_path IS DISTINCT FROM OLD.file_path
     AND (OLD.file_url IS NULL OR OLD.file_url = OLD.file_path) THEN
    NEW.file_url := NEW.file_path;
  ELSIF NEW.file_url IS DISTINCT FROM OLD.file_url
     AND (OLD.file_path IS NULL OR OLD.file_path = OLD.file_url) THEN
    NEW.file_path := NEW.file_url;
  END IF;

  -- Neither may end up empty: file_url is NOT NULL.
  IF NEW.file_url IS NULL OR btrim(NEW.file_url) = '' THEN
    NEW.file_url := NEW.file_path;
  END IF;
  IF NEW.file_path IS NULL OR btrim(NEW.file_path) = '' THEN
    NEW.file_path := NEW.file_url;
  END IF;
  RETURN NEW;
END $$;

-- ── equipment <-> inspector_equipment: UPDATE and DELETE ──────────────────
CREATE OR REPLACE FUNCTION public.nx_mirror_equipment_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.inspector_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.inspector_equipment
     SET name = NEW.name,
         serial_number = NEW.serial_number,
         next_calibration_due = NEW.calibration_expiry,
         updated_at = now()
   WHERE inspector_id = OLD.inspector_id
     AND name = OLD.name
     AND serial_number IS NOT DISTINCT FROM OLD.serial_number;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nx_mirror_equipment_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  DELETE FROM public.inspector_equipment
   WHERE inspector_id = OLD.inspector_id
     AND name = OLD.name
     AND serial_number IS NOT DISTINCT FROM OLD.serial_number;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.nx_mirror_inspector_equipment_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.inspector_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.equipment
     SET name = NEW.name,
         serial_number = NEW.serial_number,
         calibration_expiry = NEW.next_calibration_due
   WHERE inspector_id = OLD.inspector_id
     AND name = OLD.name
     AND serial_number IS NOT DISTINCT FROM OLD.serial_number;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nx_mirror_inspector_equipment_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  DELETE FROM public.equipment
   WHERE inspector_id = OLD.inspector_id
     AND name = OLD.name
     AND serial_number IS NOT DISTINCT FROM OLD.serial_number;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_equipment_update ON public.equipment;
CREATE TRIGGER trg_mirror_equipment_update
  AFTER UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_equipment_update();

DROP TRIGGER IF EXISTS trg_mirror_equipment_delete ON public.equipment;
CREATE TRIGGER trg_mirror_equipment_delete
  AFTER DELETE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_equipment_delete();

DROP TRIGGER IF EXISTS trg_mirror_insp_equipment_update ON public.inspector_equipment;
CREATE TRIGGER trg_mirror_insp_equipment_update
  AFTER UPDATE ON public.inspector_equipment
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_inspector_equipment_update();

DROP TRIGGER IF EXISTS trg_mirror_insp_equipment_delete ON public.inspector_equipment;
CREATE TRIGGER trg_mirror_insp_equipment_delete
  AFTER DELETE ON public.inspector_equipment
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_inspector_equipment_delete();

-- ── work_experience: same shape, same gap ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_mirror_work_experience_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  DELETE FROM public.inspector_work_experience
   WHERE inspector_id = OLD.user_id
     AND company_name = OLD.company_name
     AND job_title IS NOT DISTINCT FROM OLD.job_title
     AND start_date IS NOT DISTINCT FROM OLD.start_date;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.nx_mirror_inspector_work_experience_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  DELETE FROM public.work_experience
   WHERE user_id = OLD.inspector_id
     AND company_name = OLD.company_name
     AND job_title IS NOT DISTINCT FROM OLD.job_title
     AND start_date IS NOT DISTINCT FROM OLD.start_date;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_work_experience_delete ON public.work_experience;
CREATE TRIGGER trg_mirror_work_experience_delete
  AFTER DELETE ON public.work_experience
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_work_experience_delete();

DROP TRIGGER IF EXISTS trg_mirror_insp_work_experience_delete ON public.inspector_work_experience;
CREATE TRIGGER trg_mirror_insp_work_experience_delete
  AFTER DELETE ON public.inspector_work_experience
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_inspector_work_experience_delete();

COMMIT;
