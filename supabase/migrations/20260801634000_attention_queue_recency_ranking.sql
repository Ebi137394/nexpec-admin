-- ════════════════════════════════════════════════════════════════════════════
--  /pending ranked the newest work last. Fix the ordering, not the freshness.
--
--  DIAGNOSIS (read-only, against Production):
--    · NOT staleness. tg_admin_status()->>'generated_at' equals now() on every
--      call, so each command recomputes from base tables.
--    · NOT edge-function memory. The webhook holds no module-level state or
--      cache; every command issues its own db.rpc().
--    · NOT Telegram message reuse. Zero editMessageText calls — each reply is
--      a new sendMessage.
--    · NOT replica lag. The newest real profile was 02:46 and the alerts the
--      owner received were 02:45/02:50; /today's "3 (Inspector 3)" was correct.
--
--    IT WAS THE ORDERING. Every tier sorted `ORDER BY rank, age_hours DESC` —
--    OLDEST FIRST — and zero-applicant jobs (rank 20) outranked every
--    incomplete profile. With only 5 rows shown per tier, Follow-up was
--    2204h, 64h, 65h, 165h, 92h — exactly the "92d, 7d, 4d" the owner saw —
--    while the three inspectors who had just registered sat at position 15+
--    and never appeared.
--
--  THE FIX: sort direction becomes a property of the row, not of the tier.
--  order_val = -age_hours where newer is more urgent, +age_hours where age
--  itself is the urgency. One ORDER BY then does the right thing everywhere:
--    Follow-up  20 new registrations (<7d)      newest first
--               21 engaged incomplete users     newest first
--               22 open jobs, no applicants     oldest first (age = urgency)
--               23 older stale incomplete       oldest first, always last
--    Urgent / Needs action keep oldest-first: there, age IS the breach.
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
         EXTRACT(epoch FROM (NOW() - n.created_at))/3600 AS order_val,   -- older = worse
         '/admin' AS link
    FROM public.notifications n
   WHERE n.severity = 'critical' AND n.created_at > NOW() - interval '24 hours'
  UNION ALL
  SELECT 'urgent', 2, 'delivery_failure', n.id::text, 'Notification delivery failing',
         EXTRACT(epoch FROM (NOW() - COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at)))/3600,
         EXTRACT(epoch FROM (NOW() - COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at)))/3600,
         '/admin'
    FROM public.notifications n
   WHERE (n.telegram_send_error IS NOT NULL OR n.email_send_error IS NOT NULL)
     AND COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at) > NOW() - interval '24 hours'
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
         EXTRACT(epoch FROM (NOW() - c.last_message_at))/3600,
         '/admin/support'
    FROM public.conversations c LEFT JOIN public.profiles p ON p.id = COALESCE(c.user_id, c.client_id)
   WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
     AND NOT public.nx_is_test_account(p.email)
  UNION ALL
  SELECT 'needs_action', 12, 'report', r.id::text, 'Inspection report awaiting QA',
         EXTRACT(epoch FROM (NOW() - r.created_at))/3600,
         EXTRACT(epoch FROM (NOW() - r.created_at))/3600,
         '/admin/reports'
    FROM public.inspection_reports r LEFT JOIN public.profiles p ON p.id = r.inspector_id
   WHERE COALESCE(r.status,'') = 'pending' AND r.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)

  -- ══ Follow-up: newest actionable people first ══
  UNION ALL
  SELECT 'follow_up',
         CASE WHEN p.created_at > NOW() - interval '7 days' THEN 20   -- just registered
              WHEN EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
                OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL)
                   THEN 21                                            -- actively using
              ELSE 23 END,                                            -- older, stale, last
         'incomplete_profile', p.id::text,
         COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1))
           || ' (' || public.nx_role_label(p.role) || ') — missing: '
           || COALESCE(public.nx_role_missing_labels(p.id), 'details'),
         EXTRACT(epoch FROM (NOW() - p.created_at))/3600,
         -- Negated: a newer registration sorts ahead of an older one.
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
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,   -- unfilled longer = worse
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
      'test_accounts_total',(SELECT count(*) FROM public.profiles WHERE public.nx_is_test_account(email))));
$$;
REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO service_role;

-- ── /today gains a "Newest activity" section ──────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_today_summary(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH w AS (SELECT NOW() - make_interval(hours => GREATEST(COALESCE(p_hours,24), 1)) AS since)
  SELECT jsonb_build_object(
    'generated_at', NOW(),
    'window_hours', GREATEST(COALESCE(p_hours,24), 1),
    'new_users_by_role', COALESCE((
       SELECT jsonb_object_agg(public.nx_role_label(role), c)
         FROM (SELECT p.role, count(*) c FROM public.profiles p, w
                WHERE p.created_at > w.since AND NOT public.nx_is_test_account(p.email)
                GROUP BY p.role) z), '{}'::jsonb),
    'new_users', (SELECT count(*) FROM public.profiles p, w
                   WHERE p.created_at > w.since AND NOT public.nx_is_test_account(p.email)),
    -- The five most recent real signups, newest first, regardless of window.
    'newest_users', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'name', COALESCE(NULLIF(t.full_name,''), split_part(COALESCE(t.email,'user'),'@',1)),
                'role', public.nx_role_label(t.role),
                'age_hours', ROUND(EXTRACT(epoch FROM (NOW()-t.created_at))/3600),
                'incomplete', COALESCE(array_length(public.nx_role_missing_fields(t.id),1),0) > 0,
                'link', '/admin/users/' || t.id::text) ORDER BY t.created_at DESC)
         FROM (SELECT p.* FROM public.profiles p
                WHERE NOT public.nx_is_test_account(p.email)
                  AND p.role NOT IN ('admin','super_admin')
                ORDER BY p.created_at DESC LIMIT 5) t), '[]'::jsonb),
    'jobs_created', (SELECT count(*) FROM public.jobs j
                       LEFT JOIN public.profiles p ON p.id=j.client_id, w
                      WHERE j.created_at > w.since AND j.deleted_at IS NULL
                        AND NOT public.nx_is_test_account(p.email)),
    'jobs_approved', (SELECT count(*) FROM public.jobs j
                        LEFT JOIN public.profiles p ON p.id=j.client_id, w
                       WHERE j.moderation_reviewed_at > w.since AND j.deleted_at IS NULL
                         AND j.moderation_status='approved' AND NOT public.nx_is_test_account(p.email)),
    'jobs_rejected', (SELECT count(*) FROM public.jobs j
                        LEFT JOIN public.profiles p ON p.id=j.client_id, w
                       WHERE j.moderation_reviewed_at > w.since AND j.deleted_at IS NULL
                         AND j.moderation_status IN ('rejected','changes_requested')
                         AND NOT public.nx_is_test_account(p.email)),
    'applications', (SELECT count(*) FROM public.applications a
                       LEFT JOIN public.profiles p ON p.id=a.applicant_id, w
                      WHERE a.created_at > w.since AND a.deleted_at IS NULL
                        AND NOT public.nx_is_test_account(p.email)),
    'support_messages', (SELECT count(*) FROM public.messages m
                           LEFT JOIN public.profiles p ON p.id=m.sender_id
                           JOIN public.conversations c ON c.id=m.conversation_id, w
                          WHERE m.created_at > w.since AND m.deleted_at IS NULL
                            AND c.kind='help_support' AND NOT public.nx_is_test_account(p.email)),
    'reports_submitted', (SELECT count(*) FROM public.inspection_reports r
                            LEFT JOIN public.profiles p ON p.id=r.inspector_id, w
                           WHERE r.created_at > w.since AND r.deleted_at IS NULL
                             AND NOT public.nx_is_test_account(p.email)),
    'critical_alerts', (SELECT count(*) FROM public.notifications n, w
                         WHERE n.severity='critical' AND n.created_at > w.since),
    'delivery_failures', (SELECT count(*) FROM public.notifications n, w
                           WHERE (n.telegram_send_error IS NOT NULL OR n.email_send_error IS NOT NULL)
                             AND COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at) > w.since)
  );
$$;
REVOKE ALL ON FUNCTION public.tg_today_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_today_summary(integer) TO service_role;
