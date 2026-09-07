-- tg_send_daily_brief linked to '/admin', which has no page.tsx and 404s for
-- an authenticated admin. The real landing route is /admin/dashboard.
CREATE OR REPLACE FUNCTION public.tg_send_daily_brief(p_force boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  s jsonb; q jsonb; r RECORD; n int := 0; v_body text;
  v_local timestamptz := NOW(); v_hour int; v_today date;
BEGIN
  v_hour  := EXTRACT(hour FROM (v_local AT TIME ZONE 'America/Toronto'))::int;
  v_today := (v_local AT TIME ZONE 'America/Toronto')::date;
  IF NOT p_force AND v_hour <> 8 THEN RETURN 0; END IF;

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
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications
       WHERE recipient_id = r.id AND kind = 'daily_brief'
         AND (created_at AT TIME ZONE 'America/Toronto')::date = v_today);
    PERFORM public.notify_safe(r.id,'daily_brief','NEXPEC Daily Brief',v_body,'/admin/dashboard',NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_send_daily_brief: %', SQLERRM; RETURN 0;
END $$;
REVOKE ALL ON FUNCTION public.tg_send_daily_brief(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_send_daily_brief(boolean) TO service_role;
