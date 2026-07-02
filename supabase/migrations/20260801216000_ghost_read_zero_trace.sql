-- ════════════════════════════════════════════════════════════════════════════
--  20260801216000_ghost_read_zero_trace.sql   (Ghost-Mode — zero-trace reads)
--
--  Product decision reversed: the Super Admin's Ghost-Mode reads of internal team
--  threads must leave NO trace — not even in audit_events. Recreate
--  admin_open_internal_thread() WITHOUT the `INSERT INTO audit_events` write; it
--  now simply (admin-gates and) returns the thread's messages. Forward-only;
--  supersedes the audit-writing body from 212000/214000.
--
--  (Trade-off noted for the record: this removes the internal accountability trail
--  for monitoring activity. Re-add the insert if compliance ever requires it.)
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_open_internal_thread(p_conversation_id uuid)
RETURNS TABLE (
  id           uuid,
  sender_id    uuid,
  sender_label text,
  content      text,
  created_at   timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_exists boolean;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.kind = 'job_team_internal'::public.conversation_kind
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'not an internal team thread';
  END IF;

  -- ZERO TRACE: the body performs NO write of any kind; it only returns rows.
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
  -- Enforce zero-trace: the body must not INSERT into the audit table. Match the
  -- write pattern (lower-cased) so an explanatory comment can never trip the guard.
  IF lower(pg_get_functiondef(to_regprocedure('public.admin_open_internal_thread(uuid)'))) LIKE '%insert%audit_events%' THEN
    RAISE EXCEPTION 'SELFTEST: admin_open_internal_thread still writes audit_events (must be zero-trace)';
  END IF;
  RAISE NOTICE 'admin_open_internal_thread is now zero-trace (no audit write).';
END
$test$;

COMMIT;
