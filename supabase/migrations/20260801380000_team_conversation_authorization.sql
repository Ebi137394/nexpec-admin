-- ════════════════════════════════════════════════════════════════════════════
--  20260801380000_team_conversation_authorization.sql
--
--  MULTI-INSPECTOR, part 3 (Phase 1E) — communication authorization.
--
--  ── THE GAP, AND WHY THE FIX IS ONE CLAUSE ─────────────────────────────────
--  ensure_job_conversation gates the inspector side on:
--        EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND contractor_id = v_uid)
--  so a welding specialist on the team cannot open the admin-brokered room for
--  a job they are actively working. They can capture evidence (20260801378000)
--  but cannot ask the admin a question about it.
--
--  The existing model already fits multi-inspector perfectly and needs NO new
--  architecture: conversations are keyed by user_id, so EACH party has their OWN
--  admin-brokered room per job (conv_select_self_or_admin: user_id = auth.uid()
--  OR admin). A team member simply needs their own job_inspector_admin room.
--  That is the entire change.
--
--  ── WHAT THIS DELIBERATELY DOES NOT CREATE ─────────────────────────────────
--   • NO buyer<->inspector direct chat. The kind vocabulary is untouched, and
--     job_client_admin remains gated to the client alone.
--   • NO team-specific conversation kind or parallel room architecture.
--   • NO shared team room. Each member gets THEIR OWN admin-brokered room, so
--     the admin remains the broker between every pair of parties and identity
--     disclosure is unaffected.
--   • NO access to anyone else's room. conv_select_self_or_admin is unchanged,
--     so a team member sees their own conversation and nothing else — not the
--     buyer's room, not a teammate's room, not another job's rooms.
--
--  ── REPLACEMENT ISOLATION ──────────────────────────────────────────────────
--  Authorization is evaluated at OPEN time against ACTIVE membership. A removed
--  or replaced member cannot open a new room. Their historical room is not
--  retro-deleted — that would destroy communication history, which the
--  preservation rule forbids — but it is frozen: they can no longer reach the
--  job through a fresh room, and the admin retains full visibility throughout.
--
--  ── PRIVACY ────────────────────────────────────────────────────────────────
--  No commercial data crosses. The function returns a conversation id and
--  nothing else; it reads no pricing column.
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

  -- Caller-role gate. Client/agency/enterprise → job_client_admin only.
  -- Inspector side → the CONTRACTED inspector, or an ACTIVE operational team
  -- member (20260801376000). Unchanged in every other respect.
  IF p_kind = 'job_client_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND client_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the job''s client may open a job_client_admin room';
    END IF;
  ELSE -- job_inspector_admin
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND contractor_id = v_uid)
       AND NOT public.nx_is_active_job_team_member(p_job_id, v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the assigned inspector or an active team member may open a job_inspector_admin room';
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

COMMENT ON FUNCTION public.ensure_job_conversation(uuid, text) IS
  'Opens (or returns) the caller''s OWN admin-brokered room for a job. Widened by 20260801380000: the inspector side now admits an ACTIVE job_inspectors team member as well as the contracted inspector. Creates no direct buyer<->inspector channel and no shared team room — the admin stays the broker between every pair. Membership is checked at open time, so removed/replaced members cannot open a new room.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  d text := pg_get_functiondef('public.ensure_job_conversation(uuid,text)'::regprocedure);
BEGIN
  -- the widening is present …
  IF position('nx_is_active_job_team_member' IN d) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: team members still cannot open the inspector-side room';
  END IF;

  -- … and the client side was NOT widened with it
  IF d !~ 'only the job''''s client may open' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the client-side gate was altered';
  END IF;

  -- the kind vocabulary must be unchanged — no new direct/team kind
  IF position('job_client_admin' IN d) = 0 OR position('job_inspector_admin' IN d) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the conversation kind vocabulary changed';
  END IF;
  IF d ~* '\mjob_client_inspector\M' OR d ~* '\mjob_team_room\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a direct or team-specific conversation kind was introduced';
  END IF;

  -- the generic ownership policy must still be the access rule
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='conversations' AND policyname='conv_select_self_or_admin') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: conv_select_self_or_admin is missing — room isolation would break';
  END IF;

  -- no money surface
  IF d ~* '\m(payout|wallet|transactions|client_price_cents|inspector_payout_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: ensure_job_conversation names a money surface';
  END IF;

  RAISE NOTICE 'team conversation authorization ready: own admin-brokered room per member, no direct chat.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
