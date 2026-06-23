-- ════════════════════════════════════════════════════════════════════════════
--  20260801166000_session_management.sql
--
--  Real active-session listing + per-device revoke for the Security screen
--  (replaces the hardcoded "This Device" placeholder).
--
--  GoTrue stores live sessions in auth.sessions (id, user_id, created_at,
--  updated_at, not_after, user_agent, ip, aal). PostgREST does NOT expose the
--  auth schema, so the client can't read it directly. These SECURITY DEFINER
--  RPCs (scoped to auth.uid()) are the secure bridge — a user sees ONLY their
--  own sessions, and the current one is flagged via the JWT's session_id claim.
--
--  list_my_sessions() uses dynamic SQL so the migration applies cleanly across
--  GoTrue versions (any column drift surfaces at call time and the client
--  degrades gracefully to "this device" rather than the migration failing).
--
--  Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. List the caller's active sessions ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS TABLE (
  id          uuid,
  created_at  timestamptz,
  updated_at  timestamptz,
  not_after   timestamptz,
  user_agent  text,
  ip          text,
  aal         text,
  is_current  boolean
)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = auth, public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_current uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY EXECUTE
    'SELECT s.id, s.created_at, s.updated_at, s.not_after,
            s.user_agent, s.ip::text, s.aal::text, (s.id = $2) AS is_current
       FROM auth.sessions s
      WHERE s.user_id = $1
      ORDER BY (s.id = $2) DESC, s.updated_at DESC NULLS LAST'
    USING v_uid, v_current;
END $fn$;
REVOKE ALL ON FUNCTION public.list_my_sessions() FROM public;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;

-- ── 2. Revoke ONE other session (per-device logout) ───────────────────────────
--   Deleting the auth.sessions row invalidates that device's refresh token —
--   the same mechanism signOut() uses. Scoped to the caller's own sessions;
--   the current session is protected (use Sign Out for that).
CREATE OR REPLACE FUNCTION public.revoke_session(p_session_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = auth, public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_current uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_deleted int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_session_id = v_current THEN
    RAISE EXCEPTION 'CANNOT_REVOKE_CURRENT: use Sign Out to end the current session.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM auth.sessions WHERE id = p_session_id AND user_id = v_uid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_deleted > 0, 'revoked', v_deleted);
END $fn$;
REVOKE ALL ON FUNCTION public.revoke_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_session(uuid) TO authenticated;

-- ── 3. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: auth.sessions not found';
  END IF;
  IF to_regprocedure('public.list_my_sessions()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: list_my_sessions missing';
  END IF;
  IF to_regprocedure('public.revoke_session(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: revoke_session missing';
  END IF;
  RAISE NOTICE 'Session management RPCs OK (list_my_sessions + revoke_session).';
END $$;

COMMIT;
