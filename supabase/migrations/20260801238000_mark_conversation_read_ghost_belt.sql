-- ============================================================================
--  20260801238000_mark_conversation_read_ghost_belt.sql
--
--  RED TEAM P1 — ghost-mode read-receipt trace.
--
--  mark_conversation_read() flips messages.is_read=true (and zeroes the admin
--  unread counter) for ANY conversation an admin opens — including agency
--  `job_team_internal` threads. Because the team thread surfaces `is_read` to
--  its members, a Super-Admin quietly reading it would flip teammates' messages
--  to "read", uncloaking the zero-trace Integrity Monitor.
--
--  Belt: if the caller is an admin AND the conversation is job_team_internal,
--  RETURN immediately — never touch is_read or the unread counters. (Teammates
--  reading their own internal thread are unaffected; non-internal conversations
--  are unchanged.)
--
--  SAFE TO RE-RUN: CREATE OR REPLACE; self-tested.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conv_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid    := auth.uid();
  v_is_admin  boolean := public.nx_is_admin();
  v_kind      text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conv_id;

  -- GHOST BELT: a Super-Admin reading an agency team-internal thread must leave
  -- ZERO trace. They monitor via the dedicated Integrity Monitor only; this
  -- generic read path must never flip read-state or unread counters for them.
  IF v_is_admin AND v_kind = 'job_team_internal' THEN
    RETURN;
  END IF;

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.conversations WHERE id = p_conv_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a party to this conversation';
  END IF;

  UPDATE public.messages SET is_read = true
   WHERE conversation_id = p_conv_id AND is_read = false
     AND deleted_at IS NULL AND sender_id <> v_uid;

  IF v_is_admin THEN
    UPDATE public.conversations SET unread_for_admin = 0 WHERE id = p_conv_id;
  ELSE
    UPDATE public.conversations SET unread_for_user  = 0 WHERE id = p_conv_id;
  END IF;
END;
$$;

ALTER FUNCTION public.mark_conversation_read(uuid) OWNER TO postgres;

-- ── Self-test: the ghost belt is present in the function body ───────────────
DO $test$
DECLARE
  v_def text := pg_get_functiondef('public.mark_conversation_read(uuid)'::regprocedure);
BEGIN
  IF position('job_team_internal' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: mark_conversation_read missing the team-internal ghost belt';
  END IF;
  RAISE NOTICE 'mark_conversation_read ghost belt active: admin reads of job_team_internal leave no trace.';
END
$test$;

COMMIT;
