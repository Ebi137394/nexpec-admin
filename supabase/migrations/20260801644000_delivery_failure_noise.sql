-- ════════════════════════════════════════════════════════════════════════════
--  A bounce we have already suppressed is RESOLVED, not outstanding.
--
--  Classifying the four fake addresses put four "Notification delivery
--  failing" rows into the owner's URGENT tier — permanently, because the
--  bounce timestamp never moves. That is exactly the flooding the brief warns
--  against: the owner should hear about a systemic delivery problem, not about
--  four dead addresses that the system has already stopped mailing.
--
--  Only failures against an address we would still attempt remain urgent.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_attention_queue()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH items AS (
  SELECT 'urgent'::text AS tier, 1 AS rank, 'critical_alert'::text AS kind,
         n.id::text AS id, left(COALESCE(n.title,'Critical alert'), 70) AS label,
         EXTRACT(epoch FROM (NOW() - n.created_at))/3600 AS age_hours,
         EXTRACT(epoch FROM (NOW() - n.created_at))/3600 AS order_val, '/admin' AS link
    FROM public.notifications n
   WHERE n.severity = 'critical' AND n.created_at > NOW() - interval '24 hours'
  UNION ALL
  -- Still-deliverable addresses only: a suppressed one is handled, not pending.
  SELECT 'urgent', 2, 'delivery_failure', n.id::text,
         'Notification delivery failing',
         EXTRACT(epoch FROM (NOW() - COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at)))/3600,
         EXTRACT(epoch FROM (NOW() - COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at)))/3600,
         '/admin'
    FROM public.notifications n
   WHERE (n.telegram_send_error IS NOT NULL OR n.email_send_error IS NOT NULL)
     AND COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at) > NOW() - interval '24 hours'
     AND NOT public.nx_email_suppressed(n.recipient_id)
  UNION ALL
  SELECT 'urgent', 3, 'role_dispute', p.id::text,
         COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1))
           || ' says their account type (' || public.nx_role_label(p.role) || ') is wrong',
         EXTRACT(epoch FROM (NOW() - r.role_dispute_at))/3600,
         EXTRACT(epoch FROM (NOW() - r.role_dispute_at))/3600,
         '/admin/users/' || p.id::text
    FROM public.profile_completion_reminders r JOIN public.profiles p ON p.id = r.user_id
   WHERE r.role_dispute_at IS NOT NULL AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT CASE WHEN j.created_at < NOW() - interval '72 hours' THEN 'urgent' ELSE 'needs_action' END,
         CASE WHEN j.created_at < NOW() - interval '72 hours' THEN 4 ELSE 10 END,
         'moderation', j.id::text, left(COALESCE(NULLIF(j.title,''),'Untitled job'), 70),
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,
         '/admin/jobs/' || j.id::text
    FROM public.jobs j LEFT JOIN public.profiles p ON p.id = j.client_id
   WHERE j.moderation_status = 'pending_review' AND j.deleted_at IS NULL
     AND j.status = 'open' AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT CASE WHEN c.last_message_at < NOW() - interval '48 hours' THEN 'urgent' ELSE 'needs_action' END,
         CASE WHEN c.last_message_at < NOW() - interval '48 hours' THEN 5 ELSE 11 END,
         'support', c.id::text,
         left(COALESCE(NULLIF(c.last_message_preview,''), 'Support message'), 70),
         EXTRACT(epoch FROM (NOW() - c.last_message_at))/3600,
         EXTRACT(epoch FROM (NOW() - c.last_message_at))/3600, '/admin/support'
    FROM public.conversations c LEFT JOIN public.profiles p ON p.id = COALESCE(c.user_id, c.client_id)
   WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
     AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT 'needs_action', 12, 'report', r.id::text, 'Inspection report awaiting QA',
         EXTRACT(epoch FROM (NOW() - r.created_at))/3600,
         EXTRACT(epoch FROM (NOW() - r.created_at))/3600, '/admin/reports'
    FROM public.inspection_reports r LEFT JOIN public.profiles p ON p.id = r.inspector_id
   WHERE COALESCE(r.status,'') = 'pending' AND r.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT 'follow_up',
         CASE WHEN p.created_at > NOW() - interval '7 days' THEN 20
              WHEN EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
                OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL)
                   THEN 21 ELSE 23 END,
         'incomplete_profile', p.id::text,
         COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1))
           || ' (' || public.nx_role_label(p.role) || ') — missing: '
           || COALESCE(public.nx_role_missing_labels(p.id), 'details'),
         EXTRACT(epoch FROM (NOW() - p.created_at))/3600,
         CASE WHEN p.created_at > NOW() - interval '7 days'
                OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
                OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL)
              THEN -EXTRACT(epoch FROM (NOW() - p.created_at))/3600
              ELSE  EXTRACT(epoch FROM (NOW() - p.created_at))/3600 END,
         '/admin/users/' || p.id::text
    FROM public.profiles p
   WHERE COALESCE(array_length(public.nx_role_missing_fields(p.id), 1), 0) > 0
     AND p.role NOT IN ('admin','super_admin')
     AND NOT public.nx_is_test_account(p.email)
     AND (p.created_at > NOW() - interval '14 days'
          OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL))
  UNION ALL
  SELECT 'follow_up', 22, 'zero_applicants', j.id::text,
         left(COALESCE(NULLIF(j.title,''),'Untitled job'), 70),
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,
         '/admin/jobs/' || j.id::text
    FROM public.jobs j LEFT JOIN public.profiles p ON p.id = j.client_id
   WHERE j.status = 'open' AND j.moderation_status = 'approved' AND j.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)
     AND j.created_at < NOW() - interval '48 hours'
     AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id AND a.deleted_at IS NULL)
),
ranked AS (SELECT *, row_number() OVER (PARTITION BY tier ORDER BY rank, order_val DESC) AS rn FROM items)
SELECT jsonb_build_object(
  'generated_at', NOW(),
  'totals', jsonb_build_object(
      'urgent',(SELECT count(*) FROM items WHERE tier='urgent'),
      'needs_action',(SELECT count(*) FROM items WHERE tier='needs_action'),
      'follow_up',(SELECT count(*) FROM items WHERE tier='follow_up')),
  'urgent',       (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' - 'order_val' ORDER BY r.rank, r.order_val DESC),'[]'::jsonb) FROM ranked r WHERE r.tier='urgent' AND r.rn<=5),
  'needs_action', (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' - 'order_val' ORDER BY r.rank, r.order_val DESC),'[]'::jsonb) FROM ranked r WHERE r.tier='needs_action' AND r.rn<=5),
  'follow_up',    (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' - 'order_val' ORDER BY r.rank, r.order_val DESC),'[]'::jsonb) FROM ranked r WHERE r.tier='follow_up' AND r.rn<=5),
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
      'known_test_or_fake',(SELECT count(*) FROM public.account_quality WHERE state='known_test_or_fake'),
      'suspicious_awaiting_review',(SELECT count(*) FROM public.account_quality WHERE state='suspicious'),
      'email_suppressed',(SELECT count(*) FROM public.account_quality WHERE email_suppressed)));
$$;
REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO service_role;
