-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801380000_rollback.sql
--
--  Reverses 20260801380000 (team conversation authorization). LOCAL only.
--
--  Restores ensure_job_conversation to its pre-widening gate: the inspector
--  side admits ONLY the contracted inspector. Verbatim from baseline.
--
--  ⚠ EFFECT: active team members lose the ability to open their admin-brokered
--  room. Rooms they already opened are NOT deleted — communication history is
--  preserved — but a member who has no room yet can no longer create one, so
--  multi-inspector jobs lose their inspector-side comms for everyone except the
--  contractor.
--
--  Nothing else changes: no conversation is removed, no kind is altered, and
--  conv_select_self_or_admin is untouched in either direction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_job_conversation(
  p_job_id uuid, p_kind text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_kind NOT IN ('job_client_admin','job_inspector_admin') THEN
    RAISE EXCEPTION 'invalid conversation kind';
  END IF;

  IF p_kind = 'job_client_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND client_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the job''s client may open a job_client_admin room';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND contractor_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the assigned inspector may open a job_inspector_admin room';
    END IF;
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
   WHERE job_id = p_job_id AND kind = p_kind::public.conversation_kind AND user_id = v_uid
   LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations(kind, user_id, job_id, title)
      VALUES (
        p_kind::public.conversation_kind, v_uid, p_job_id,
        CASE p_kind
          WHEN 'job_client_admin'    THEN 'Job chat · client side'
          WHEN 'job_inspector_admin' THEN 'Job chat · inspector side'
        END
      )
      RETURNING id INTO v_conv_id;
  END IF;
  RETURN v_conv_id;
END $fn$;

ALTER FUNCTION public.ensure_job_conversation(uuid, text) OWNER TO postgres;

DO $verify$
BEGIN
  IF position('nx_is_active_job_team_member' IN
      pg_get_functiondef('public.ensure_job_conversation(uuid,text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the team clause is still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='conversations' AND policyname='conv_select_self_or_admin') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: conv_select_self_or_admin is missing';
  END IF;
  RAISE NOTICE 'rollback complete: inspector side restricted to the contractor; history preserved.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
