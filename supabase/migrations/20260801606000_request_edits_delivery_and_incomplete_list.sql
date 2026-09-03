-- ════════════════════════════════════════════════════════════════════════════
--  Closeout: deliver "Request edits" to the client, and list incomplete profiles
--
--  ADDITIVE ONLY. Two new functions. admin_review_job_with_pricing() — the RPC
--  Approve and Reject use — is NOT modified, so those two paths behave exactly
--  as before. Nothing the published binaries call changes.
--
--  GAP FOUND: admin_review_job_with_pricing() writes jobs.moderation_notes and
--  nothing else — no notification, no message, no audit row. The admin's reason
--  was stored where only an admin could ever read it, so "Request edits" was
--  silent to the client it was addressed to.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Request edits, and actually tell the client ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_request_job_edits(
  p_job_id uuid,
  p_notes  text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_role     text;
  v_client   uuid;
  v_title    text;
  v_conv_id  uuid;
  v_body     text;
  v_last     text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'a reason is required so the client knows what to change';
  END IF;

  SELECT client_id, title INTO v_client, v_title FROM public.jobs WHERE id = p_job_id;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'job not found, or it has no client to notify';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  -- Existing state machine, untouched: 'edits_requested' is already one of the
  -- four values allowed by jobs_moderation_status_check.
  UPDATE public.jobs
     SET moderation_status      = 'edits_requested',
         moderation_notes       = btrim(p_notes),
         moderation_reviewed_at = NOW(),
         moderation_reviewed_by = v_actor,
         updated_at             = NOW()
   WHERE id = p_job_id;

  v_body := 'Our team reviewed your inspection request "' || COALESCE(v_title, 'your job')
         || '" and needs a few changes before it can be published:' || E'\n\n'
         || btrim(p_notes) || E'\n\n'
         || 'Reply here once updated and we will continue the review.';

  -- Canonical Help & Support thread — the same one /admin/messages shows and
  -- the released mobile inbox reads. No parallel message table.
  SELECT id INTO v_conv_id
    FROM public.conversations WHERE user_id = v_client AND kind = 'help_support' LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (kind, user_id, title)
    VALUES ('help_support', v_client, 'Help & Support')
    RETURNING id INTO v_conv_id;
  END IF;

  -- Retry guard: if the newest message in this thread is byte-identical, the
  -- action is being replayed (double submit, refresh) — do not post twice.
  SELECT content INTO v_last
    FROM public.messages
   WHERE conversation_id = v_conv_id
   ORDER BY created_at DESC LIMIT 1;

  IF v_last IS DISTINCT FROM v_body THEN
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (v_conv_id, v_actor, v_body);

    BEGIN
      PERFORM public.notify_safe(
        v_client, 'system', 'Changes requested on your inspection request',
        left(btrim(p_notes), 140), '/inbox/' || v_conv_id::text, p_job_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, job_id, summary, metadata)
  VALUES ('job.edits_requested', 'warning', v_actor, v_role, 'Command Console',
          'jobs', p_job_id, p_job_id,
          'Edits requested: ' || left(btrim(p_notes), 200),
          jsonb_build_object('client_id', v_client, 'conversation_id', v_conv_id,
                             'duplicate_suppressed', (v_last IS NOT DISTINCT FROM v_body)));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.admin_request_job_edits(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_request_job_edits(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_request_job_edits(uuid, text) IS
  'Request edits on a job AND deliver the reason to the client''s canonical Help & Support thread, with a duplicate guard and an audit row. Approve/Reject continue to use admin_review_job_with_pricing unchanged.';

-- ── 2 · Incomplete profiles listing for the Command Console ────────────────
CREATE OR REPLACE FUNCTION public.admin_list_incomplete_profiles(
  p_role  text DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS TABLE (
  id                 uuid,
  full_name          text,
  email              text,
  role               text,
  created_at         timestamptz,
  verification_status text,
  missing_fields     text[],
  completeness_pct   integer,
  reminder_sent_at   timestamptz,
  reminder_count     integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id, p.full_name, p.email, p.role, p.created_at, p.verification_status,
         public.nx_profile_missing_fields(p.id) AS missing_fields,
         -- Four tracked fields; percentage is simply how many are filled.
         (100 - (COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) * 25))::int
           AS completeness_pct,
         r.last_sent_at, r.send_count
    FROM public.profiles p
    LEFT JOIN public.profile_completion_reminders r ON r.user_id = p.id
   WHERE public.nx_is_admin()                               -- admin-only, enforced here
     AND COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) > 0
     AND p.role NOT IN ('admin', 'super_admin')
     AND COALESCE(p.email, '') !~* '(@nexpec\.test$|@synthetic\.invalid$|^e2e\.)'
     AND (p_role IS NULL OR p.role = p_role)
   ORDER BY p.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
$$;

REVOKE ALL ON FUNCTION public.admin_list_incomplete_profiles(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_incomplete_profiles(text, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_list_incomplete_profiles(text, integer) IS
  'Command Console: users whose profile is missing required contact/organisation fields, with reminder state. Admin-only (checked inside). A profile that becomes complete drops out automatically because the predicate is computed live.';
