-- ════════════════════════════════════════════════════════════════════════════
--  Three defects in my own Telegram work, found by an adversarial pass.
--
--  1 · SUSPENDED ADMINS KEPT TELEGRAM AUTHORITY  (the serious one)
--      tg_bot_actor verified only that the paired profile still holds an
--      admin role. NEXPEC does not disable an account by changing its role —
--      it sets profiles.status = 'suspended' (with suspended_at / suspended_by).
--      So the documented way to cut off a
--      compromised or departing admin did NOT revoke their Telegram mutation
--      authority: the allowlist row stayed active, the role was untouched, and
--      the bot kept acting as them. Suspension now revokes immediately, which
--      is what "disabling the admin removes authority" has to mean.
--
--  2 · TELEGRAM JOB ACTIONS WERE INVISIBLE ON JOB-SCOPED AUDIT SURFACES
--      audit_events.job_id exists and job-scoped views filter on it, but
--      tg_audit_action never set it. The row carrying the Telegram identity
--      therefore had job_id NULL and did not appear in a job's own audit
--      trail, while the canonical row that DID appear is labelled
--      'Command Console' and carries no Telegram identity. Anyone auditing a
--      single job saw console activity and no sign Telegram was involved.
--
--  3 · A SECURITY DEFINER WRAPPER DEFEATED A DELIBERATE REVOKE
--      Migration 616000 revoked anon from nx_profile_missing_fields and
--      documented the residual authenticated-level exposure as accepted.
--      Migration 622000 then added nx_missing_fields_label as a SECURITY
--      DEFINER wrapper over that same function and never revoked it, so it
--      kept PostgreSQL's default PUBLIC EXECUTE. Verified live: an
--      unauthenticated caller holding only the publishable key got HTTP 200
--      and "Company, Phone, Location" for a real user, while the parent
--      function correctly returned 401. The wrapper re-opened exactly what the
--      earlier migration had closed.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Suspension revokes Telegram authority ─────────────────────────────
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

  -- The paired profile must still be an admin AND still be an enabled account.
  -- Checking the role alone was not enough: NEXPEC suspends an account with
  -- profiles.status/suspended_at/active, never by changing the role, so a
  -- suspended admin previously kept full Telegram authority.
  IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = v_profile
           AND p.role IN ('admin', 'super_admin')
           AND COALESCE(p.status, 'active') <> 'suspended'
           AND p.suspended_at IS NULL
           AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'the profile paired to telegram chat % is not an active admin', p_chat_id
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

-- ── 2 · The audit row joins the job's own trail ───────────────────────────
CREATE OR REPLACE FUNCTION public.tg_audit_action(p_chat_id bigint,
                                                  p_actor   uuid,
                                                  p_action  text,
                                                  p_subject_table text,
                                                  p_subject uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tg_user bigint;
  v_job     uuid;
BEGIN
  SELECT c.telegram_user_id INTO v_tg_user
    FROM public.telegram_admin_chats c WHERE c.chat_id = p_chat_id;

  -- Populate job_id when the subject IS a job, so the action shows up on the
  -- job's own audit trail instead of only in the global feed.
  IF p_subject_table = 'jobs' THEN
    v_job := p_subject;
  END IF;

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                   subject_table, subject_id, job_id, summary, metadata)
  VALUES ('telegram.admin_action', 'warning', p_actor,
          'Telegram Admin Control Center (chat ' || p_chat_id::text || ')',
          p_subject_table, p_subject, v_job,
          'Telegram action ' || p_action,
          jsonb_build_object('source', 'telegram_admin_control_center',
                             'action', p_action,
                             'telegram_chat_id', p_chat_id,
                             'telegram_user_id', v_tg_user,
                             'nexpec_admin_id', p_actor,
                             'atomic_with_mutation', true));
END $$;

REVOKE ALL ON FUNCTION public.tg_audit_action(bigint, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_audit_action(bigint, uuid, text, text, uuid) TO service_role;

-- ── 3 · Close the wrapper that re-opened a closed hole ────────────────────
--  Matches the parent function's ACL exactly, so the wrapper can no longer be
--  a way around it. No view, RLS policy, index or client calls these.
REVOKE ALL ON FUNCTION public.nx_missing_fields_label(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_missing_fields_label(uuid) TO authenticated, service_role;

-- The pure label helpers touch no data, but there is no reason for an
-- unauthenticated caller to hold EXECUTE on them either.
REVOKE ALL ON FUNCTION public.nx_field_label(text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nx_role_label(text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nx_is_test_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_field_label(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_role_label(text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_is_test_account(text) TO authenticated, service_role;
