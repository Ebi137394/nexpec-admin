-- ════════════════════════════════════════════════════════════════════════════
--  20260801212000_admin_integrity_monitor_rpcs.sql   (Ghost-Mode — Integrity Monitor)
--
--  The Super Admin "Integrity Monitor" data path. Two SECURITY DEFINER, admin-gated
--  RPCs (god-mode read of the otherwise-private internal team threads):
--    • admin_list_internal_threads()      — every job_team_internal room + metadata.
--    • admin_open_internal_thread(uuid)    — returns a room's messages AND SILENTLY
--      writes a ghost-read entry to audit_events (internal accountability; never
--      surfaced to users). Reading without logging is impossible through this path.
--
--  Both gate on nx_is_admin() (admin ≡ super_admin). DEFINER → reads bypass the
--  team RLS (that's the sanctioned ghost read); the append-only audit insert runs
--  as owner. No write surface into the threads — the admin can only watch.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_internal_threads()
RETURNS TABLE (
  conversation_id  uuid,
  job_id           uuid,
  job_title        text,
  principal_id     uuid,
  principal_label  text,
  message_count    bigint,
  last_message_at  timestamptz,
  last_preview     text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  RETURN QUERY
    SELECT
      c.id,
      c.job_id,
      j.title,
      c.user_id,
      COALESCE(NULLIF(p.company_name, ''), NULLIF(p.full_name, ''), 'Principal'),
      (SELECT count(*) FROM public.messages m
         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL),
      c.last_message_at,
      c.last_message_preview
    FROM public.conversations c
    LEFT JOIN public.jobs j     ON j.id = c.job_id
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE c.kind = 'job_team_internal'::public.conversation_kind
    ORDER BY c.last_message_at DESC NULLS LAST;
END
$fn$;

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
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id, summary, metadata
  ) VALUES (
    'ghost_read_internal', 'info', v_uid, 'admin',
    (SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.profiles WHERE id = v_uid),
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

REVOKE ALL    ON FUNCTION public.admin_list_internal_threads()       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_internal_threads()       TO authenticated, service_role;
REVOKE ALL    ON FUNCTION public.admin_open_internal_thread(uuid)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_open_internal_thread(uuid)    TO authenticated, service_role;

DO $test$
BEGIN
  IF to_regprocedure('public.admin_list_internal_threads()') IS NULL
     OR to_regprocedure('public.admin_open_internal_thread(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: integrity-monitor RPCs missing';
  END IF;
  IF has_function_privilege('anon', 'public.admin_open_internal_thread(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon must not execute the ghost-read RPC';
  END IF;
  IF position('ghost_read_internal' in pg_get_functiondef(to_regprocedure('public.admin_open_internal_thread(uuid)'))) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: admin_open_internal_thread does not write the ghost-read audit';
  END IF;
  RAISE NOTICE 'Integrity Monitor RPCs OK (admin-gated; ghost reads audited).';
END
$test$;

COMMIT;
