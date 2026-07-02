-- ════════════════════════════════════════════════════════════════════════════
--  20260801214000_fix_admin_open_internal_thread_ambiguous_id.sql  (Ghost-Mode fix)
--
--  admin_open_internal_thread() (212000) is RETURNS TABLE(id uuid, …) — so its OUT
--  column `id` is an implicit PL/pgSQL variable. The audit-insert subquery
--  `… FROM public.profiles WHERE id = v_uid` is therefore AMBIGUOUS between that
--  variable and profiles.id → "column reference \"id\" is ambiguous" (caught by
--  rls_team_internal_test assertion 11). Recreate the function with the lookup
--  table aliased (pr2.id). Behaviour is otherwise identical. Forward-only.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_open_internal_thread(p_conversation_id uuid)
RETURNS TABLE (
  id           uuid,
  sender_id    uuid,
  sender_label text,
  content      text,
  created_at   timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT c.job_id INTO v_job
    FROM public.conversations c
   WHERE c.id = p_conversation_id
     AND c.kind = 'job_team_internal'::public.conversation_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an internal team thread';
  END IF;

  -- SILENT GHOST AUDIT — internal accountability only; not visible to any user.
  -- (lookup table aliased pr2 to avoid clashing with the OUT column `id`.)
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id, summary, metadata
  ) VALUES (
    'ghost_read_internal', 'info', v_uid, 'admin',
    (SELECT COALESCE(NULLIF(pr2.full_name, ''), pr2.email)
       FROM public.profiles pr2 WHERE pr2.id = v_uid),
    'conversations', p_conversation_id, v_job,
    'Super Admin viewed an internal team thread (Ghost Mode)',
    jsonb_build_object('conversation_id', p_conversation_id, 'kind', 'job_team_internal')
  );

  RETURN QUERY
    SELECT m.id, m.sender_id,
           COALESCE(NULLIF(pr.full_name, ''), 'Teammate'),
           m.content, m.created_at
    FROM public.messages m
    LEFT JOIN public.profiles pr ON pr.id = m.sender_id
    WHERE m.conversation_id = p_conversation_id AND m.deleted_at IS NULL
    ORDER BY m.created_at ASC;
END
$fn$;

REVOKE ALL    ON FUNCTION public.admin_open_internal_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_open_internal_thread(uuid) TO authenticated, service_role;

DO $test$
BEGIN
  IF to_regprocedure('public.admin_open_internal_thread(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: admin_open_internal_thread missing';
  END IF;
  RAISE NOTICE 'admin_open_internal_thread fixed (aliased profiles lookup; no ambiguous id).';
END
$test$;

COMMIT;
