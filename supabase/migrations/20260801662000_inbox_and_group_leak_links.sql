-- ════════════════════════════════════════════════════════════════════════════
--  20260801662000_inbox_and_group_leak_links.sql
--
--  P1 — 29 delivered notifications point at '/inbox/<id>', which resolves on
--  NEITHER platform, and 2 point at a literal expo-router route group.
--
--  ── DEFECT 1: /inbox/<conversation_id> ─────────────────────────────────────
--  Five live producers write it:
--      admin_send_user_message, admin_request_job_edits,
--      nx_send_profile_completion_nudge, nx_onboarding_reminder_sweep,
--      nx_send_role_onboarding
--  Measured on Production: 29 delivered rows — 14 inspectors, 13 clients,
--  1 agency, 1 supplier — newest today. Among them are the onboarding messages
--  sent to real users.
--
--  Web had no /inbox route until this change's companion web deploy added one.
--  Mobile is the harder half: app/notifications.tsx:229 only follows a
--  link_href matching
--      ^/(job-details|messages|contracts|report|chat/(direct|…))/
--  '/inbox/' is not in that allowlist, so on the phone the tap is silently
--  DROPPED — no navigation, no error, nothing.
--
--  Re-pointing the producers at '/messages/<id>' fixes both platforms at once:
--  the web route added in 20260801660000 resolves it per role, and '/messages/'
--  is already inside the mobile allowlist. That matters because the mobile
--  allowlist can only be changed by shipping a new app build; this fix reaches
--  the phones already in users' hands.
--
--  ── DEFECT 2: '/(admin)/job-moderation' ────────────────────────────────────
--  _spawn_inspection_for_award emits a literal expo-router route group.
--  Parentheses add no URL segment in either router, so '(admin)' can never
--  match a route. Repointed at '/admin/jobs', which exists.
--
--  ── WHY A MECHANICAL REWRITE ───────────────────────────────────────────────
--  The five producers are large functions living in five different migrations.
--  Transcribing all five bodies by hand to change one string literal in each is
--  the higher-risk option — a single typo silently changes behaviour in a
--  SECURITY DEFINER function. Instead each definition is read back with
--  pg_get_functiondef, the exact literal '/inbox/' is replaced with
--  '/messages/', and the result is re-executed. pg_get_functiondef emits a
--  complete CREATE OR REPLACE statement, so signature, volatility,
--  SECURITY DEFINER, search_path and grants all carry over untouched by
--  construction.
--
--  The rewrite is guarded: it refuses to run if a definition contains no
--  '/inbox/' after all, and asserts at the end that zero producers still emit
--  it. Nothing else in any body is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  r        record;
  v_def    text;
  v_new    text;
  v_count  int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'c')
       AND pg_get_functiondef(p.oid) LIKE '%''/inbox/%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '''/inbox/', '''/messages/');

    IF v_new = v_def THEN
      RAISE EXCEPTION 'no substitution made in %, refusing to continue', r.proname;
    END IF;

    EXECUTE v_new;
    v_count := v_count + 1;
    RAISE NOTICE 'repointed /inbox/ -> /messages/ in %', r.proname;
  END LOOP;

  IF v_count = 0 THEN
    RAISE NOTICE 'no producers emitted /inbox/ — already fixed';
  END IF;

  -- Nothing may still emit the dead prefix.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'c')
       AND pg_get_functiondef(p.oid) LIKE '%''/inbox/%'
  ) THEN
    RAISE EXCEPTION 'a producer still emits /inbox/ after the rewrite';
  END IF;
END $$;

-- Defect 2, one literal in one function. Small enough to do the same way, and
-- guarded identically.
DO $$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'c')
       AND pg_get_functiondef(p.oid) LIKE '%/(admin)/job-moderation%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '/(admin)/job-moderation', '/admin/jobs');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'no substitution made in %, refusing to continue', r.proname;
    END IF;
    EXECUTE v_new;
    RAISE NOTICE 'repointed route-group leak in %', r.proname;
  END LOOP;
END $$;

-- ── Repair the rows already sitting in users' notification lists ───────────
-- 29 rows for /inbox/, 2 for the route-group leak. Nothing is deleted.
UPDATE public.notifications
   SET link_href = '/messages/' || split_part(link_href, '/', 3)
 WHERE link_href LIKE '/inbox/%'
   AND split_part(link_href, '/', 3) <> '';

UPDATE public.notifications
   SET link_href = '/messages'
 WHERE link_href = '/inbox';

UPDATE public.notifications
   SET link_href = '/admin/jobs'
 WHERE link_href LIKE '/(admin)/job-moderation%';

-- Queued email payloads carry the same path.
UPDATE public.notifications
   SET email_template_data = jsonb_set(
         email_template_data, '{profile_path}', '"/profile"')
 WHERE email_template_data ? 'profile_path'
   AND email_template_data->>'profile_path' LIKE '/inbox%';

COMMIT;
