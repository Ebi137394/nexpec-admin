-- ════════════════════════════════════════════════════════════════════════════
--  Telegram: signal quality. Ranked attention queue, honest counts, readable
--  labels, and a daily brief that lands at 08:00 America/Toronto year-round.
--
--  NOTHING IS DELETED. Every filter below is a READ-MODEL decision; all history
--  stays exactly where it is and remains visible through /incomplete, the web
--  console and a "suppressed" tally the queue always reports, so a filtered
--  item can never vanish silently.
--
--  WHAT THE PRODUCTION DATA ACTUALLY SHOWED (measured, not assumed):
--    · 16 jobs sat in pending_review. ALL 16 belong to QA accounts
--      (client@test.com "Client Admin", agency@test.com, inspector@test.com
--      "Test Inspector"), with titles like "Jk n jk jk jk jk" and "job to test
--      the app". Genuinely actionable moderation: ZERO.
--    · 8 of those 16 are moot regardless of who owns them: the job's own status
--      is 'completed' or 'in_progress', so moderating it decides nothing. That
--      is a stale read model, not a backlog.
--    · All 4 waiting support threads belong to the same QA accounts.
--    · 41 "incomplete profiles" included 18 QA accounts. 23 are real; 17 of
--      those are actually engaged (have a job, an application, or registered in
--      the last 14 days).
--    · "Reports to review" counted is_published = false, which is 0 — but all
--      six reports are published=true and five are status='pending'. The
--      predicate was simply wrong; it agreed with reality only by accident.
--      Corrected here to status='pending', which is the real QA signal.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · The synthetic-account marker ──────────────────────────────────────
--  Evidence-based, not a guess. @test.com holds 11 numbered QA accounts;
--  @example.com is RFC 2606 reserved and holds 5 throwaway inspectors;
--  @acme.com is a single placeholder enterprise; apple_tester@ is the account
--  created for Apple App Review. The pre-existing markers are folded in so
--  there is ONE definition instead of a regex copy-pasted per query.
CREATE OR REPLACE FUNCTION public.nx_is_test_account(p_email text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(p_email, '') ~* '(@test[.]com$|@example[.]com$|@acme[.]com$|@nexpec[.]test$|@synthetic[.]invalid$|^e2e[.]|^apple_tester@)';
$$;

COMMENT ON FUNCTION public.nx_is_test_account(text) IS
  'Single definition of a QA/synthetic account. Used to keep the owner-facing Telegram queue honest. It NEVER deletes or hides data — filtered items are still counted in the queue''s suppressed tally and remain fully visible in /incomplete and the web console.';

-- ── 2 · Human-readable field labels (§4) ──────────────────────────────────
--  Canonical column names are untouched; this is presentation only.
CREATE OR REPLACE FUNCTION public.nx_field_label(p_field text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_field, ''))
    WHEN 'full_name'            THEN 'Name'
    WHEN 'company_name'         THEN 'Company'
    WHEN 'phone'                THEN 'Phone'
    WHEN 'location'             THEN 'Location'
    WHEN 'avatar_url'           THEN 'Photo'
    WHEN 'bio'                  THEN 'Bio'
    WHEN 'website'              THEN 'Website'
    WHEN 'country_of_residence' THEN 'Country'
    WHEN 'years_experience'     THEN 'Experience'
    WHEN 'certifications'       THEN 'Certifications'
    WHEN 'specializations'      THEN 'Specializations'
    WHEN 'hourly_rate'          THEN 'Rate'
    WHEN 'tax_id'               THEN 'Tax ID'
    ELSE initcap(replace(COALESCE(p_field, ''), '_', ' '))
  END;
$$;

CREATE OR REPLACE FUNCTION public.nx_role_label(p_role text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_role, ''))
    WHEN 'client'      THEN 'Client'
    WHEN 'inspector'   THEN 'Inspector'
    WHEN 'senior'      THEN 'Senior Inspector'
    WHEN 'agency'      THEN 'Agency'
    WHEN 'enterprise'  THEN 'Enterprise'
    WHEN 'supplier'    THEN 'Supplier'
    WHEN 'admin'       THEN 'Admin'
    WHEN 'super_admin' THEN 'Owner'
    ELSE initcap(replace(COALESCE(p_role, ''), '_', ' '))
  END;
$$;

CREATE OR REPLACE FUNCTION public.nx_missing_fields_label(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT NULLIF(array_to_string(
           ARRAY(SELECT public.nx_field_label(f)
                   FROM unnest(public.nx_profile_missing_fields(p_user_id)) AS f),
           ', '), '');
$$;

-- ── 3 · Honest status counts (§6) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_admin_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'generated_at', NOW(),

    -- Actionable moderation: the job must still be OPEN (moderating a completed
    -- job decides nothing) and must not belong to a QA account.
    'jobs_awaiting_moderation',
      (SELECT count(*) FROM public.jobs j
         LEFT JOIN public.profiles p ON p.id = j.client_id
        WHERE j.moderation_status = 'pending_review' AND j.deleted_at IS NULL
          AND j.status = 'open' AND NOT public.nx_is_test_account(p.email)),
    -- Same rows the old count returned, kept visible so nothing is hidden.
    'jobs_moderation_stale',
      (SELECT count(*) FROM public.jobs
        WHERE moderation_status = 'pending_review' AND deleted_at IS NULL
          AND status <> 'open'),
    'jobs_moderation_test',
      (SELECT count(*) FROM public.jobs j
         LEFT JOIN public.profiles p ON p.id = j.client_id
        WHERE j.moderation_status = 'pending_review' AND j.deleted_at IS NULL
          AND public.nx_is_test_account(p.email)),

    'jobs_open',
      (SELECT count(*) FROM public.jobs j
         LEFT JOIN public.profiles p ON p.id = j.client_id
        WHERE j.status = 'open' AND j.moderation_status = 'approved'
          AND j.deleted_at IS NULL AND NOT public.nx_is_test_account(p.email)),
    'jobs_zero_applicants_48h',
      (SELECT count(*) FROM public.jobs j
         LEFT JOIN public.profiles p ON p.id = j.client_id
        WHERE j.status = 'open' AND j.moderation_status = 'approved'
          AND j.deleted_at IS NULL AND NOT public.nx_is_test_account(p.email)
          AND j.created_at < NOW() - interval '48 hours'
          AND NOT EXISTS (SELECT 1 FROM public.applications a
                           WHERE a.job_id = j.id AND a.deleted_at IS NULL)),
    'applications_24h',
      (SELECT count(*) FROM public.applications a
         LEFT JOIN public.profiles p ON p.id = a.applicant_id
        WHERE a.created_at > NOW() - interval '24 hours' AND a.deleted_at IS NULL
          AND NOT public.nx_is_test_account(p.email)),
    'users_24h',
      (SELECT count(*) FROM public.profiles
        WHERE created_at > NOW() - interval '24 hours'
          AND NOT public.nx_is_test_account(email)),

    -- Only profiles that are actually trying to use NEXPEC (§3).
    'incomplete_profiles',
      (SELECT count(*) FROM public.profiles p
        WHERE COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) > 0
          AND p.role NOT IN ('admin','super_admin')
          AND NOT public.nx_is_test_account(p.email)
          AND (p.created_at > NOW() - interval '14 days'
               OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
               OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL))),
    'incomplete_profiles_all_real',
      (SELECT count(*) FROM public.profiles p
        WHERE COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) > 0
          AND p.role NOT IN ('admin','super_admin')
          AND NOT public.nx_is_test_account(p.email)),

    'support_unread',
      (SELECT count(*) FROM public.conversations c
         LEFT JOIN public.profiles p ON p.id = COALESCE(c.user_id, c.client_id)
        WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
          AND NOT public.nx_is_test_account(p.email)),
    'support_unread_test',
      (SELECT count(*) FROM public.conversations c
         LEFT JOIN public.profiles p ON p.id = COALESCE(c.user_id, c.client_id)
        WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
          AND public.nx_is_test_account(p.email)),

    -- CORRECTED: the QA signal is status='pending'. is_published is about
    -- client visibility and was false for nothing, so the old count could
    -- never have surfaced a real report awaiting review.
    'reports_awaiting_review',
      (SELECT count(*) FROM public.inspection_reports r
         LEFT JOIN public.profiles p ON p.id = r.inspector_id
        WHERE COALESCE(r.status,'') = 'pending' AND r.deleted_at IS NULL
          AND NOT public.nx_is_test_account(p.email)),

    'critical_alerts_24h',
      (SELECT count(*) FROM public.notifications
        WHERE severity = 'critical' AND created_at > NOW() - interval '24 hours'),
    'telegram_delivery_failures_24h',
      (SELECT count(*) FROM public.notifications
        WHERE telegram_send_error IS NOT NULL
          AND telegram_last_attempt_at > NOW() - interval '24 hours'),
    'email_delivery_failures_24h',
      (SELECT count(*) FROM public.notifications
        WHERE email_send_error IS NOT NULL
          AND email_last_attempt_at > NOW() - interval '24 hours')
  );
$$;

REVOKE ALL ON FUNCTION public.tg_admin_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_admin_status() TO service_role;

-- ── 4 · Ranked attention queue (§1, §2) ───────────────────────────────────
--  One definition, three tiers, ordered by real urgency rather than by
--  category. Every row carries its own age and a deep link, and the queue
--  always reports what it suppressed so filtering can never read as an
--  all-clear it did not earn.
--
--  Tier rules, all derived from actual NEXPEC state and timestamps:
--    urgent      — a production signal that is failing NOW (critical alert,
--                  delivery failure) or an SLA already breached (moderation
--                  waiting > 72h, real support unanswered > 48h)
--    needs_action— a decision the owner owes someone today
--    follow_up   — real but not time-critical
CREATE OR REPLACE FUNCTION public.tg_attention_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH items AS (
  -- ═══ operational failure: something in production is broken right now ═══
  SELECT 'urgent'::text AS tier, 1 AS rank, 'critical_alert'::text AS kind,
         n.id::text AS id, left(COALESCE(n.title,'Critical alert'), 70) AS label,
         EXTRACT(epoch FROM (NOW() - n.created_at))/3600 AS age_hours,
         '/admin' AS link
    FROM public.notifications n
   WHERE n.severity = 'critical' AND n.created_at > NOW() - interval '24 hours'

  UNION ALL
  SELECT 'urgent', 2, 'delivery_failure',
         n.id::text, 'Notification delivery failing',
         EXTRACT(epoch FROM (NOW() - COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at)))/3600,
         '/admin'
    FROM public.notifications n
   WHERE (n.telegram_send_error IS NOT NULL OR n.email_send_error IS NOT NULL)
     AND COALESCE(n.telegram_last_attempt_at, n.email_last_attempt_at) > NOW() - interval '24 hours'

  -- ═══ moderation: only OPEN jobs from real clients ═══
  UNION ALL
  SELECT CASE WHEN j.created_at < NOW() - interval '72 hours' THEN 'urgent' ELSE 'needs_action' END,
         CASE WHEN j.created_at < NOW() - interval '72 hours' THEN 3 ELSE 10 END,
         'moderation', j.id::text, left(COALESCE(NULLIF(j.title,''),'Untitled job'), 70),
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,
         '/admin/jobs/' || j.id::text
    FROM public.jobs j LEFT JOIN public.profiles p ON p.id = j.client_id
   WHERE j.moderation_status = 'pending_review' AND j.deleted_at IS NULL
     AND j.status = 'open' AND NOT public.nx_is_test_account(p.email)

  -- ═══ support: real users waiting on a reply ═══
  UNION ALL
  SELECT CASE WHEN c.last_message_at < NOW() - interval '48 hours' THEN 'urgent' ELSE 'needs_action' END,
         CASE WHEN c.last_message_at < NOW() - interval '48 hours' THEN 4 ELSE 11 END,
         'support', c.id::text,
         left(COALESCE(NULLIF(c.last_message_preview,''), 'Support message'), 70),
         EXTRACT(epoch FROM (NOW() - c.last_message_at))/3600,
         '/admin/support'
    FROM public.conversations c
    LEFT JOIN public.profiles p ON p.id = COALESCE(c.user_id, c.client_id)
   WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
     AND NOT public.nx_is_test_account(p.email)

  -- ═══ reports awaiting QA ═══
  UNION ALL
  SELECT 'needs_action', 12, 'report', r.id::text,
         'Inspection report awaiting QA',
         EXTRACT(epoch FROM (NOW() - r.created_at))/3600,
         '/admin/reports'
    FROM public.inspection_reports r LEFT JOIN public.profiles p ON p.id = r.inspector_id
   WHERE COALESCE(r.status,'') = 'pending' AND r.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)

  -- ═══ follow-up: real, not time-critical ═══
  UNION ALL
  SELECT 'follow_up', 20, 'zero_applicants', j.id::text,
         left(COALESCE(NULLIF(j.title,''),'Untitled job'), 70),
         EXTRACT(epoch FROM (NOW() - j.created_at))/3600,
         '/admin/jobs/' || j.id::text
    FROM public.jobs j LEFT JOIN public.profiles p ON p.id = j.client_id
   WHERE j.status = 'open' AND j.moderation_status = 'approved' AND j.deleted_at IS NULL
     AND NOT public.nx_is_test_account(p.email)
     AND j.created_at < NOW() - interval '48 hours'
     AND NOT EXISTS (SELECT 1 FROM public.applications a
                      WHERE a.job_id = j.id AND a.deleted_at IS NULL)

  -- Incomplete profiles, ordered by how actively the person is using NEXPEC:
  -- a client who already posted a job outranks a brand-new signup, which
  -- outranks an inspector who has only applied.
  UNION ALL
  SELECT 'follow_up',
         CASE WHEN EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL) THEN 21
              WHEN p.created_at > NOW() - interval '7 days' THEN 22
              ELSE 23 END,
         'incomplete_profile', p.id::text,
         COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1))
           || ' (' || public.nx_role_label(p.role) || ') — missing: '
           || COALESCE(public.nx_missing_fields_label(p.id), 'details'),
         EXTRACT(epoch FROM (NOW() - p.created_at))/3600,
         '/admin/users/' || p.id::text
    FROM public.profiles p
   WHERE COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) > 0
     AND p.role NOT IN ('admin','super_admin')
     AND NOT public.nx_is_test_account(p.email)
     AND (p.created_at > NOW() - interval '14 days'
          OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id = p.id AND j.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id = p.id AND a.deleted_at IS NULL))
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY tier ORDER BY rank, age_hours DESC) AS rn
    FROM items
)
SELECT jsonb_build_object(
  'generated_at', NOW(),
  'totals', jsonb_build_object(
      'urgent',       (SELECT count(*) FROM items WHERE tier='urgent'),
      'needs_action', (SELECT count(*) FROM items WHERE tier='needs_action'),
      'follow_up',    (SELECT count(*) FROM items WHERE tier='follow_up')),
  'urgent',       (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' ORDER BY r.rank, r.age_hours DESC), '[]'::jsonb)
                     FROM ranked r WHERE r.tier='urgent' AND r.rn <= 5),
  'needs_action', (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' ORDER BY r.rank, r.age_hours DESC), '[]'::jsonb)
                     FROM ranked r WHERE r.tier='needs_action' AND r.rn <= 5),
  'follow_up',    (SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tier' - 'rn' ORDER BY r.rank, r.age_hours DESC), '[]'::jsonb)
                     FROM ranked r WHERE r.tier='follow_up' AND r.rn <= 5),
  -- Always reported, so a quiet queue is never mistaken for a clean database.
  'suppressed', jsonb_build_object(
      'test_account_moderation',
        (SELECT count(*) FROM public.jobs j LEFT JOIN public.profiles p ON p.id=j.client_id
          WHERE j.moderation_status='pending_review' AND j.deleted_at IS NULL
            AND public.nx_is_test_account(p.email)),
      'stale_moderation_job_not_open',
        (SELECT count(*) FROM public.jobs
          WHERE moderation_status='pending_review' AND deleted_at IS NULL AND status <> 'open'),
      'test_account_support',
        (SELECT count(*) FROM public.conversations c
           LEFT JOIN public.profiles p ON p.id=COALESCE(c.user_id,c.client_id)
          WHERE c.kind='help_support' AND COALESCE(c.unread_for_admin,0)>0
            AND public.nx_is_test_account(p.email)),
      'dormant_incomplete_profiles',
        (SELECT count(*) FROM public.profiles p
          WHERE COALESCE(array_length(public.nx_profile_missing_fields(p.id),1),0)>0
            AND p.role NOT IN ('admin','super_admin')
            AND NOT public.nx_is_test_account(p.email)
            AND p.created_at <= NOW() - interval '14 days'
            AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.client_id=p.id AND j.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.applicant_id=p.id AND a.deleted_at IS NULL)),
      'test_accounts_total',
        (SELECT count(*) FROM public.profiles WHERE public.nx_is_test_account(email)))
);
$$;

REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO service_role;

-- ── 5 · /today — a deterministic 24h operating summary (§7) ───────────────
--  No model in the loop: this is operational fact, and it must read the same
--  every time it is asked. QA accounts are excluded so the numbers describe
--  the real business.
CREATE OR REPLACE FUNCTION public.tg_today_summary(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    'jobs_created', (SELECT count(*) FROM public.jobs j
                       LEFT JOIN public.profiles p ON p.id=j.client_id, w
                      WHERE j.created_at > w.since AND j.deleted_at IS NULL
                        AND NOT public.nx_is_test_account(p.email)),
    'jobs_approved', (SELECT count(*) FROM public.jobs j
                        LEFT JOIN public.profiles p ON p.id=j.client_id, w
                       WHERE j.moderation_reviewed_at > w.since AND j.deleted_at IS NULL
                         AND j.moderation_status='approved'
                         AND NOT public.nx_is_test_account(p.email)),
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
                            AND c.kind='help_support'
                            AND NOT public.nx_is_test_account(p.email)),
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

-- ── 6 · Daily brief at 08:00 America/Toronto, DST-proof (§5) ──────────────
--  MEASURED, not assumed: pg_cron 1.6.4 with cron.timezone = GMT and the
--  database on UTC. pg_cron has no per-job timezone, so any fixed UTC hour
--  MUST drift by an hour twice a year: 08:00 Toronto is 12:00 UTC under EDT
--  and 13:00 UTC under EST. The old '30 6 * * *' was firing at 02:30 Toronto.
--
--  The robust fix that survives DST without maintenance: let pg_cron wake the
--  function during a UTC window that covers both offsets, and let the FUNCTION
--  decide, using the IANA zone, whether it is 08:00 in Toronto right now. The
--  zone database handles DST, so nothing has to be re-scheduled in March or
--  November. The existing per-admin-per-day guard is re-expressed in Toronto
--  local days so a brief cannot double-send inside the window.
CREATE OR REPLACE FUNCTION public.tg_send_daily_brief(p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  s        jsonb;
  q        jsonb;
  r        RECORD;
  n        int := 0;
  v_body   text;
  v_local  timestamptz := NOW();
  v_hour   int;
  v_today  date;
BEGIN
  v_hour  := EXTRACT(hour FROM (v_local AT TIME ZONE 'America/Toronto'))::int;
  v_today := (v_local AT TIME ZONE 'America/Toronto')::date;

  -- Fire only in the 08:00 Toronto hour, whatever UTC offset is in effect.
  IF NOT p_force AND v_hour <> 8 THEN
    RETURN 0;
  END IF;

  s := public.tg_admin_status();
  q := public.tg_attention_queue();

  v_body :=
      'Needs attention: '     || (q->'totals'->>'urgent') || ' urgent · '
                              || (q->'totals'->>'needs_action') || ' to action · '
                              || (q->'totals'->>'follow_up') || ' follow-up' ||
    E'\nAwaiting moderation: '|| (s->>'jobs_awaiting_moderation') ||
    E'\nOpen jobs: '          || (s->>'jobs_open') ||
    E'\nNo applicants 48h+: ' || (s->>'jobs_zero_applicants_48h') ||
    E'\nApplications 24h: '   || (s->>'applications_24h') ||
    E'\nNew users 24h: '      || (s->>'users_24h') ||
    E'\nIncomplete (active): '|| (s->>'incomplete_profiles') ||
    E'\nSupport awaiting: '   || (s->>'support_unread') ||
    E'\nReports awaiting QA: '|| (s->>'reports_awaiting_review') ||
    E'\nCritical alerts 24h: '|| (s->>'critical_alerts_24h');

  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin') LOOP
    -- Dedupe on the Toronto day, matching the schedule's own frame of reference.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications
       WHERE recipient_id = r.id AND kind = 'daily_brief'
         AND (created_at AT TIME ZONE 'America/Toronto')::date = v_today);
    PERFORM public.notify_safe(r.id, 'daily_brief', 'NEXPEC Daily Brief', v_body, '/admin', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_send_daily_brief: %', SQLERRM;
  RETURN 0;
END $$;

REVOKE ALL ON FUNCTION public.tg_send_daily_brief(boolean) FROM PUBLIC, anon, authenticated;

-- ── 7 · Recent registrations, through the same single definition ──────────
--  /users could have filtered QA accounts with a regex copy-pasted into the
--  edge function, but then the marker would live in two places and could
--  drift. It goes through nx_is_test_account like everything else.
CREATE OR REPLACE FUNCTION public.tg_recent_users(p_chat_id bigint,
                                                  p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  PERFORM public.tg_bot_actor(p_chat_id, false);
  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_out
    FROM (
      SELECT p.id,
             COALESCE(NULLIF(p.full_name,''), split_part(COALESCE(p.email,'user'),'@',1)) AS name,
             public.nx_role_label(p.role) AS role,
             p.created_at,
             public.nx_missing_fields_label(p.id) AS missing,
             ROUND(EXTRACT(epoch FROM (NOW()-p.created_at))/3600) AS age_hours
        FROM public.profiles p
       WHERE NOT public.nx_is_test_account(p.email)
         AND p.role NOT IN ('admin','super_admin')
       ORDER BY p.created_at DESC
       LIMIT GREATEST(COALESCE(p_limit,8),1)) t;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.tg_recent_users(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_recent_users(bigint, integer) TO service_role;
