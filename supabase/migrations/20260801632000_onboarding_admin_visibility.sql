-- ════════════════════════════════════════════════════════════════════════════
--  Surface onboarding state to admins, using the role-aware rule.
--
--  The Telegram read models were still using nx_profile_missing_fields, the
--  flat four-field rule. That over-reports inspectors (asks them for a company
--  they may not have) and under-reports them (never asks for any professional
--  signal). They now use nx_role_missing_fields, so Telegram, the daily brief
--  and the onboarding message can never disagree about who is incomplete.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_role_missing_labels(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT NULLIF(string_agg(public.nx_field_label(f), ', '), '')
    FROM unnest(public.nx_role_missing_fields(p_user_id)) AS f;
$$;
REVOKE ALL ON FUNCTION public.nx_role_missing_labels(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_role_missing_labels(uuid) TO authenticated, service_role;

-- ── New-user alert now carries role + confirmation state ──────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_admins_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_missing text;
BEGIN
  BEGIN
    IF public.nx_is_test_account(NEW.email) THEN RETURN NULL; END IF;
    IF COALESCE(NEW.role, '') IN ('admin', 'super_admin') THEN RETURN NULL; END IF;

    v_missing := public.nx_role_missing_labels(NEW.id);

    PERFORM public.nx_notify_admins(
      'New ' || public.nx_role_label(NEW.role) || ' registered',
      COALESCE(NULLIF(btrim(NEW.full_name), ''), 'Unnamed')
        || ' — ' || COALESCE(NEW.email, 'no email')
        || E'\nRole: ' || public.nx_role_label(NEW.role) || ' — not yet confirmed'
        || CASE WHEN v_missing IS NULL THEN E'\nProfile complete'
                ELSE E'\nMissing: ' || v_missing END,
      'system',
      '/admin/users/' || NEW.id::text,
      NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- signup must never fail because an alert could not be delivered
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tg_notify_admins_new_user() FROM PUBLIC, anon, authenticated;

-- ── The attention queue speaks the same role-aware language ───────────────
CREATE OR REPLACE FUNCTION public.tg_attention_queue()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH items AS (
  SELECT 'urgent'::text AS tier, 1 AS rank, 'critical_alert'::text AS kind,
         n.id::text AS id, left(COALESCE(n.title,'Critical alert'), 70) AS label,
         EXTRACT(epoch FROM (NOW() - n.created_at))/3600 AS age_hours, '/admin' AS link
    FROM public.notifications n
   WHERE n.severity = 'critical' AND n.created_at > NOW() - interval '24 hours'
  UNION ALL
  SELECT 'urgent', 2, 'delivery_failure', n.id::text, 'Notification delivery failing',
         EXTRACT(epoch FROM (NOW() - COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at)))/3600, '/admin'
    FROM public.notifications n
   WHERE (n.telegram_send_error IS NOT NULL OR n.email_send_error IS NOT NULL)
     AND COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at) > NOW() - interval '24 hours'
  UNION ALL
  -- A user telling us their account type is wrong is blocked until an admin acts.
  SELECT 'urgent', 3, 'role_dispute', p.id::text,
         COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1))
           || ' says their account type (' || public.nx_role_label(p.role) || ') is wrong',
         EXTRACT(epoch FROM (NOW() - r.role_dispute_at))/3600,
         '/admin/users/' || p.id::text
    FROM public.profile_completion_reminders r JOIN public.profiles p ON p.id = r.user_id
   WHERE r.role_dispute_at IS NOT NULL AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT CASE WHEN j.created_at < NOW() - interval '72 hours' THEN 'urgent' ELSE 'needs_action' END,
         CASE WHEN j.created_at < NOW() - interval '72 hours' THEN 4 ELSE 10 END,
         'moderation', j.id::text, left(COALESCE(NULLIF(j.title,''),'Untitled job'), 70),
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600, '/admin/jobs/' || j.id::text
    FROM public.jobs j LEFT JOIN public.profiles p ON p.id = j.client_id
   WHERE j.moderation_status = 'pending_review' AND j.deleted_at IS NULL
     AND j.status = 'open' AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT CASE WHEN c.last_message_at < NOW() - interval '48 hours' THEN 'urgent' ELSE 'needs_action' END,
         CASE WHEN c.last_message_at < NOW() - interval '48 hours' THEN 5 ELSE 11 END,
         'support', c.id::text,
         left(COALESCE(NULLIF(c.last_message_preview,''), 'Support message'), 70),
         EXTRACT(epoch FROM (NOW() - c.last_message_at))/3600, '/admin/support'
    FROM public.conversations c LEFT JOIN public.profiles p ON p.id = COALESCE(c.user_id, c.client_id)
   WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
     AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT 'needs_action', 12, 'report', r.id::text, 'Inspection report awaiting QA',
         EXTRACT(epoch FROM (NOW() - r.created_at))/3600, '/admin/reports'
    FROM public.inspection_reports r LEFT JOIN public.profiles p ON p.id = r.inspector_id
   WHERE COALESCE(r.status,'') = 'pending' AND r.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT 'follow_up', 20, 'zero_applicants', j.id::text,
         left(COALESCE(NULLIF(j.title,''),'Untitled job'), 70),
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600, '/admin/jobs/' || j.id::text
    FROM public.jobs j LEFT JOIN public.profiles p ON p.id = j.client_id
   WHERE j.status = 'open' AND j.moderation_status = 'approved' AND j.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)
     AND j.created_at < NOW() - interval '48 hours'
     AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id AND a.deleted_at IS NULL)
  UNION ALL
  SELECT 'follow_up',
         CASE WHEN EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL) THEN 21
              WHEN p.created_at > NOW() - interval '7 days' THEN 22 ELSE 23 END,
         'incomplete_profile', p.id::text,
         COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1))
           || ' (' || public.nx_role_label(p.role) || ') — missing: '
           || COALESCE(public.nx_role_missing_labels(p.id), 'details'),
         EXTRACT(epoch FROM (NOW() - p.created_at))/3600,
         '/admin/users/' || p.id::text
    FROM public.profiles p
   WHERE COALESCE(array_length(public.nx_role_missing_fields(p.id), 1), 0) > 0
     AND p.role NOT IN ('admin','super_admin')
     AND NOT public.nx_is_test_account(p.email)
     AND (p.created_at > NOW() - interval '14 days'
          OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL))
),
ranked AS (SELECT *, row_number() OVER (PARTITION BY tier ORDER BY rank, age_hours DESC) AS rn FROM items)
SELECT jsonb_build_object(
  'generated_at', NOW(),
  'totals', jsonb_build_object(
      'urgent',(SELECT count(*) FROM items WHERE tier='urgent'),
      'needs_action',(SELECT count(*) FROM items WHERE tier='needs_action'),
      'follow_up',(SELECT count(*) FROM items WHERE tier='follow_up')),
  'urgent',       (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' ORDER BY r.rank, r.age_hours DESC),'[]'::jsonb) FROM ranked r WHERE r.tier='urgent' AND r.rn<=5),
  'needs_action', (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' ORDER BY r.rank, r.age_hours DESC),'[]'::jsonb) FROM ranked r WHERE r.tier='needs_action' AND r.rn<=5),
  'follow_up',    (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' ORDER BY r.rank, r.age_hours DESC),'[]'::jsonb) FROM ranked r WHERE r.tier='follow_up' AND r.rn<=5),
  'suppressed', jsonb_build_object(
      'test_account_moderation',(SELECT count(*) FROM public.jobs j LEFT JOIN public.profiles p ON p.id=j.client_id
          WHERE j.moderation_status='pending_review' AND j.deleted_at IS NULL AND public.nx_is_test_account(p.email)),
      'stale_moderation_job_not_open',(SELECT count(*) FROM public.jobs
          WHERE moderation_status='pending_review' AND deleted_at IS NULL AND status<>'open'),
      'test_account_support',(SELECT count(*) FROM public.conversations c LEFT JOIN public.profiles p ON p.id=COALESCE(c.user_id,c.client_id)
          WHERE c.kind='help_support' AND COALESCE(c.unread_for_admin,0)>0 AND public.nx_is_test_account(p.email)),
      'dormant_incomplete_profiles',(SELECT count(*) FROM public.profiles p
          WHERE COALESCE(array_length(public.nx_role_missing_fields(p.id),1),0)>0
            AND p.role NOT IN ('admin','super_admin') AND NOT public.nx_is_test_account(p.email)
            AND p.created_at <= NOW() - interval '14 days'
            AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id=p.id AND j.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id=p.id AND a.deleted_at IS NULL)),
      'test_accounts_total',(SELECT count(*) FROM public.profiles WHERE public.nx_is_test_account(email))));
$$;
REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO service_role;
