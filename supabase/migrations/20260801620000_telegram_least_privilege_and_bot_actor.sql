-- ════════════════════════════════════════════════════════════════════════════
--  Telegram: least privilege on the tables, and a real authorization path
--  for the bot's own actions.
--
--  Both problems were found by an adversarial pass over my own work.
--
--  A · TABLE GRANTS. I revoked `anon` on the three telegram tables and stopped
--      there. Supabase's default privileges still left `authenticated` holding
--      SELECT/INSERT/UPDATE/DELETE, with only the permissive RLS policy
--      (USING nx_is_admin()) in front — and nx_is_admin() admits ANY admin, not
--      only the owner. Every property migration 618000 claims to enforce lived
--      solely inside the mint/consume functions, so over PostgREST an admin
--      account could read a live pairing token in plaintext, PATCH consumed_at
--      back to NULL to resurrect a spent one, extend expires_at past its clamp,
--      INSERT a token bound to a profile of their choosing (bypassing the
--      CSPRNG, the TTL clamp, the owner-binding and the audit event), or DELETE
--      the owner's link. Nothing in the app reads these tables — they are
--      service_role surfaces reached only by the edge functions — so the fix is
--      simply to stop granting them to `authenticated`.
--
--  B · THE BOT COULD NOT ACT. telegram-webhook builds its client with the
--      service-role key. That JWT carries no `sub`, so auth.uid() IS NULL
--      inside every RPC it calls, and nx_is_admin() is therefore FALSE for the
--      bot. Verified on Production: admin_list_incomplete_profiles returned 0
--      rows while the true count was 41. So /incomplete reported a false
--      all-clear, and BOTH mutations (Request Profile Completion, Request Job
--      Edits) would have refused — the entire can_act + action-token tier had
--      never actually executed.
--
--      The fix does NOT weaken those admin RPCs. Instead the bot's authority is
--      derived from the thing that already proves it: its allowlist row. A
--      helper resolves chat_id -> the paired admin profile, and adopts that
--      identity for the current transaction only, so the canonical admin_*
--      RPCs run with a real admin actor and keep every check they already had.
--      A chat that is not allowlisted, not active, or (for mutations) lacks
--      can_act cannot obtain an identity at all.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Least privilege on the telegram tables ────────────────────────────
REVOKE ALL ON public.telegram_bootstrap     FROM anon, authenticated;
REVOKE ALL ON public.telegram_admin_chats   FROM anon, authenticated;
REVOKE ALL ON public.telegram_action_tokens FROM anon, authenticated;

-- The read models are reached by the bot (service_role). Nothing in the web or
-- mobile client calls them, and neither carries its own authorization check, so
-- `authenticated` must not hold EXECUTE: any signed-up user could otherwise
-- read the admin queue, including other users' support-ticket previews.
REVOKE ALL ON FUNCTION public.tg_admin_status()    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_admin_status()    TO service_role;
REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO service_role;

-- ── B · The bot's actor identity ──────────────────────────────────────────
--  Returns the admin profile this Telegram chat is paired to, and adopts that
--  identity for the remainder of the current transaction so the canonical
--  admin_* RPCs see a real admin in auth.uid(). Raises rather than returning
--  NULL, so a caller can never proceed unauthorized by ignoring a return value.
CREATE OR REPLACE FUNCTION public.tg_bot_actor(p_chat_id bigint,
                                               p_require_can_act boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile uuid;
  v_can_act boolean;
BEGIN
  SELECT c.profile_id, c.can_act INTO v_profile, v_can_act
    FROM public.telegram_admin_chats c
   WHERE c.chat_id = p_chat_id AND c.is_active IS TRUE;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'telegram chat % is not an active admin chat', p_chat_id
      USING ERRCODE = '42501';
  END IF;

  IF p_require_can_act AND COALESCE(v_can_act, false) IS FALSE THEN
    RAISE EXCEPTION 'telegram chat % is read-only', p_chat_id
      USING ERRCODE = '42501';
  END IF;

  -- Belt and braces: the paired profile must still hold an admin role today.
  -- A demoted admin's chat therefore stops acting even before it is removed
  -- from the allowlist.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = v_profile AND p.role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'the profile paired to telegram chat % is no longer an admin', p_chat_id
      USING ERRCODE = '42501';
  END IF;

  -- Transaction-local only (is_local = true): the identity is gone at COMMIT.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_profile::text,
                                       'role', 'authenticated')::text, true);
  RETURN v_profile;
END $$;

REVOKE ALL ON FUNCTION public.tg_bot_actor(bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_bot_actor(bigint, boolean) TO service_role;

-- ── Bot-scoped wrappers over the CANONICAL admin RPCs ─────────────────────
--  These add authorization and change nothing else: the work itself is still
--  done by the same admin_* functions the web console calls, so Telegram and
--  Web cannot drift apart.

--  Returns jsonb rather than SETOF record: a record-returning function needs a
--  column definition list at the call site, which PostgREST cannot supply.
CREATE OR REPLACE FUNCTION public.tg_incomplete_profiles(p_chat_id bigint,
                                                         p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  PERFORM public.tg_bot_actor(p_chat_id, false);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_out
    FROM public.admin_list_incomplete_profiles(NULL, p_limit) t;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.tg_do_request_profile_completion(p_chat_id bigint,
                                                                   p_user_id uuid,
                                                                   p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.tg_bot_actor(p_chat_id, true);   -- mutation: can_act required
  PERFORM public.admin_request_profile_completion(p_user_id, p_note);
  RETURN true;
END $$;

--  admin_request_job_edits refuses an empty reason on purpose, so the client is
--  always told what to change. The bot therefore always supplies one.
CREATE OR REPLACE FUNCTION public.tg_do_request_job_edits(p_chat_id bigint,
                                                          p_job_id uuid,
                                                          p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.tg_bot_actor(p_chat_id, true);   -- mutation: can_act required
  PERFORM public.admin_request_job_edits(
    p_job_id,
    COALESCE(NULLIF(btrim(p_note), ''),
             'Please review and complete the job details so it can be approved.'));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.tg_incomplete_profiles(bigint, integer)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_do_request_profile_completion(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_do_request_job_edits(bigint, uuid, text)          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_incomplete_profiles(bigint, integer)        TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_do_request_profile_completion(bigint, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_do_request_job_edits(bigint, uuid, text)        TO service_role;
