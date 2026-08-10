-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801386000_rollback.sql
--
--  Reverses 20260801386000 (visit-level scheduling conflicts). LOCAL only.
--
--  Restores nx_visit_assign_inspector to its 20260801384000 form (which does
--  not report schedule_conflicts) and drops the preview plus the shared core.
--
--  EFFECT: admins lose the visit-level clash hint. Allocation itself is
--  unaffected — it never blocked on a conflict in either direction. Job-level
--  nx_job_schedule_conflicts is untouched throughout.
--
--  No data, schedule or assignment row is modified.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_visit_assign_inspector(
  p_visit_id uuid, p_inspector_id uuid, p_is_lead boolean DEFAULT false
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin  uuid := auth.uid();
  v_job    uuid;
  v_member uuid;
  v_id     uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT job_id INTO v_job FROM public.job_visits WHERE id = p_visit_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'visit not found' USING errcode = 'P0002';
  END IF;

  SELECT ji.id INTO v_member FROM public.job_inspectors ji
   WHERE ji.job_id = v_job AND ji.inspector_id = p_inspector_id
     AND ji.status IN ('assigned','active');
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'inspector is not an active member of this job team — add them to the team first'
      USING errcode = '42501';
  END IF;

  IF p_is_lead THEN
    UPDATE public.job_visit_assignments SET is_lead = false WHERE visit_id = p_visit_id;
  END IF;

  INSERT INTO public.job_visit_assignments (visit_id, job_inspector_id, is_lead, assigned_by)
  VALUES (p_visit_id, v_member, COALESCE(p_is_lead, false), v_admin)
  ON CONFLICT (visit_id, job_inspector_id)
    DO UPDATE SET is_lead = EXCLUDED.is_lead
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'assignment_id', v_id);
END $fn$;

ALTER FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) OWNER TO postgres;

DROP FUNCTION IF EXISTS public.nx_visit_schedule_conflicts(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_schedule_conflicts_core(date, uuid, uuid, uuid);

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_schedule_conflicts_core(date,uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the conflict core is still present';
  END IF;
  IF position('nx_schedule_conflicts_core' IN
      pg_get_functiondef('public.nx_visit_assign_inspector(uuid,uuid,boolean)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: assignment still calls the dropped core';
  END IF;
  IF to_regprocedure('public.nx_job_schedule_conflicts(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: job-level conflicts were disturbed';
  END IF;
  RAISE NOTICE 'rollback complete: visit conflicts removed; allocation and job-level conflicts intact.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
