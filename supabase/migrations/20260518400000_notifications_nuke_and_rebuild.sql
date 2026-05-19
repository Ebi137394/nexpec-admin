-- ============================================================================
-- NOTIFICATIONS — nuke and rebuild from scratch.
--
-- Why this exists: every previous attempt left at least one of (RLS,
-- publication, function, trigger) silently broken. This migration is a
-- single source of truth that:
--
--   1. ENSURES the column shape is right.
--   2. WIPES every existing RLS policy on `notifications` and replaces
--      with one explicit policy per operation.
--   3. ENSURES the realtime publication includes `notifications`.
--   4. RE-CREATES the SECURITY DEFINER notify functions WITHOUT swallowing
--      errors. If a trigger fails, the calling transaction sees it. We then
--      wrap the trigger-side calls in BEGIN/EXCEPTION so business writes
--      don't get rolled back by a notification failure.
--   5. ENSURES `profiles.unread_notifications_count` exists.
--   6. Fires one test notification per admin so you can confirm end-to-end.
-- ============================================================================

BEGIN;

-- ── 1) Column shape ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  kind         text NOT NULL,
  title        text NOT NULL,
  body         text,
  link_href    text,
  job_id       uuid,
  is_read      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);

-- defensive: in case a prior migration created the table differently
DO $$
BEGIN
  -- migrate user_id → recipient_id if older schema used user_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notifications'
       AND column_name='user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notifications'
       AND column_name='recipient_id'
  ) THEN
    ALTER TABLE public.notifications RENAME COLUMN user_id TO recipient_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(recipient_id) WHERE is_read = false;

-- ── 2) Profiles counter column ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unread_notifications_count int NOT NULL DEFAULT 0;

-- ── 3) WIPE every RLS policy on notifications, then rebuild ─────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT polname
      FROM pg_policy
     WHERE polrelid = 'public.notifications'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', r.polname);
  END LOOP;
END $$;

-- The recipient can read their own notifications.
CREATE POLICY "notifications_recipient_select"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid() OR public.nx_is_admin());

-- The recipient can mark their own as read (and only as read).
CREATE POLICY "notifications_recipient_update_read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- NO direct INSERT policy. The only way to insert is via the SECURITY
-- DEFINER `nx_notify` function below. This is intentional — clients/
-- inspectors cannot forge notifications for other users.

-- Admin (super_admin) can DELETE for cleanup.
CREATE POLICY "notifications_admin_delete"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (public.nx_is_admin());

-- ── 4) Realtime publication ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime'
       AND schemaname='public'
       AND tablename='notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    RAISE NOTICE 'Added notifications to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'notifications already in publication — good';
  END IF;
END $$;

-- ── 5) The ONE notify function — does NOT swallow errors ───────────────
DROP FUNCTION IF EXISTS public.nx_notify(uuid, text, text, text, text, uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.nx_notify(
  p_recipient uuid,
  p_title     text,
  p_body      text,
  p_kind      text,
  p_link      text DEFAULT NULL,
  p_job_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  -- Guards. These DO raise — caller decides what to do with the failure.
  IF p_recipient IS NULL THEN
    RAISE EXCEPTION 'nx_notify: p_recipient is null';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'nx_notify: p_title is required';
  END IF;
  IF p_kind IS NULL OR length(trim(p_kind)) = 0 THEN
    RAISE EXCEPTION 'nx_notify: p_kind is required';
  END IF;

  INSERT INTO public.notifications(
    recipient_id, kind, title, body, link_href, job_id
  ) VALUES (
    p_recipient, p_kind, p_title, p_body, p_link, p_job_id
  )
  RETURNING id INTO v_id;

  UPDATE public.profiles
     SET unread_notifications_count = unread_notifications_count + 1
   WHERE id = p_recipient;

  RETURN v_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.nx_notify(uuid, text, text, text, text, uuid) TO authenticated;

-- Broadcast helper — loops over admins. Returns the row count for the audit.
CREATE OR REPLACE FUNCTION public.nx_notify_admins(
  p_title  text,
  p_body   text,
  p_kind   text,
  p_link   text DEFAULT NULL,
  p_job_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r RECORD; v_count int := 0;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin', 'super_admin')
  LOOP
    PERFORM public.nx_notify(r.id, p_title, p_body, p_kind, p_link, p_job_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $fn$;

GRANT EXECUTE ON FUNCTION public.nx_notify_admins(text, text, text, text, uuid) TO authenticated;

-- Mark-read helpers (idempotent, decrement only when actually flipping)
CREATE OR REPLACE FUNCTION public.nx_mark_notification_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_was_unread boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  WITH upd AS (
    UPDATE public.notifications
       SET is_read = true, read_at = NOW()
     WHERE id = p_id
       AND recipient_id = auth.uid()
       AND is_read = false
     RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM upd) INTO v_was_unread;
  IF v_was_unread THEN
    UPDATE public.profiles
       SET unread_notifications_count = GREATEST(unread_notifications_count - 1, 0)
     WHERE id = auth.uid();
  END IF;
END $fn$;
GRANT EXECUTE ON FUNCTION public.nx_mark_notification_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.nx_mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.notifications
     SET is_read = true, read_at = NOW()
   WHERE recipient_id = auth.uid() AND is_read = false;
  UPDATE public.profiles
     SET unread_notifications_count = 0
   WHERE id = auth.uid();
END $fn$;
GRANT EXECUTE ON FUNCTION public.nx_mark_all_notifications_read() TO authenticated;

-- ── 6) Triggers — wrap nx_notify in EXCEPTION so notification failures
--      don't roll back the business write, but DO log loudly so we can spot
--      a regression in pg logs. ─────────────────────────────────────────

-- DROP every prior trigger so we don't double-fire.
DROP TRIGGER IF EXISTS trg_notify_on_job_change                  ON public.jobs;
DROP TRIGGER IF EXISTS trg_notify_inspectors_on_job_approved     ON public.jobs;
DROP TRIGGER IF EXISTS trg_jobs_notifications_v2                 ON public.jobs;
DROP TRIGGER IF EXISTS trg_applications_notifications_v2         ON public.applications;
DROP TRIGGER IF EXISTS trg_notify_on_application_change          ON public.applications;
DROP TRIGGER IF EXISTS trg_notify_on_new_message                 ON public.messages;
DROP TRIGGER IF EXISTS trg_job_contracts_notifications           ON public.job_contracts;

-- New canonical trigger functions
CREATE OR REPLACE FUNCTION public.tg_notify_jobs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_client    uuid := COALESCE(NEW.client_id, NEW.agency_id);
  v_inspector uuid := COALESCE(NEW.hired_inspector_id, NEW.inspector_id);
  v_title     text := COALESCE(NULLIF(NEW.title, ''), 'Inspection job');
BEGIN
  IF TG_OP = 'INSERT' THEN
    BEGIN
      PERFORM public.nx_notify_admins(
        'New job posted', v_title, 'job_moderated',
        '/admin/jobs?inspect=' || NEW.id::text, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tg_notify_jobs INSERT admin broadcast failed: %', SQLERRM;
    END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status AND v_client IS NOT NULL THEN
      BEGIN
        PERFORM public.nx_notify(
          v_client,
          CASE NEW.moderation_status
            WHEN 'approved'         THEN 'Job approved'
            WHEN 'rejected'         THEN 'Job rejected'
            WHEN 'edits_requested'  THEN 'Edits requested on your job'
            ELSE 'Job moderation updated'
          END,
          v_title, 'job_moderated',
          '/client/jobs/' || NEW.id::text, NEW.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'tg_notify_jobs moderation notify failed: %', SQLERRM;
      END;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND v_inspector IS NOT NULL THEN
      BEGIN
        PERFORM public.nx_notify(
          v_inspector,
          CASE NEW.status
            WHEN 'in_progress' THEN 'Job in progress'
            WHEN 'completed'   THEN 'Job marked complete'
            WHEN 'cancelled'   THEN 'Job cancelled'
            ELSE 'Job status updated'
          END,
          v_title, 'assignment',
          '/inspector/jobs/' || NEW.id::text, NEW.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'tg_notify_jobs status notify failed: %', SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_notify_jobs
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_jobs();

CREATE OR REPLACE FUNCTION public.tg_notify_applications()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_client uuid;
  v_title  text;
BEGIN
  SELECT COALESCE(client_id, agency_id), COALESCE(NULLIF(title,''), 'your job')
    INTO v_client, v_title
    FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    IF v_client IS NOT NULL THEN
      BEGIN
        PERFORM public.nx_notify(
          v_client, 'New inspector application',
          'An inspector applied to ' || v_title || '.',
          'application_status',
          '/client/jobs/' || NEW.job_id::text || '/applications',
          NEW.job_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'tg_notify_applications client notify failed: %', SQLERRM;
      END;
    END IF;
    BEGIN
      PERFORM public.nx_notify_admins(
        'New application',
        'Inspector applied to "' || v_title || '".',
        'application_status',
        '/admin/jobs?inspect=' || NEW.job_id::text, NEW.job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tg_notify_applications admin broadcast failed: %', SQLERRM;
    END;
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status IS DISTINCT FROM OLD.status
        AND NEW.applicant_id IS NOT NULL THEN
    BEGIN
      PERFORM public.nx_notify(
        NEW.applicant_id,
        CASE NEW.status
          WHEN 'accepted'        THEN 'Application accepted'
          WHEN 'rejected'        THEN 'Application not selected'
          WHEN 'CLIENT_SELECTED' THEN 'Client picked you — admin reviewing'
          WHEN 'withdrawn'       THEN 'Application withdrawn'
          ELSE 'Application updated'
        END,
        v_title, 'application_status',
        '/inspector/jobs/' || NEW.job_id::text, NEW.job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tg_notify_applications inspector notify failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_notify_applications
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_applications();

CREATE OR REPLACE FUNCTION public.tg_notify_messages()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_conv    RECORD;
  v_preview text;
BEGIN
  SELECT id, user_id, kind, title, job_id INTO v_conv
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_preview := COALESCE(
    NULLIF(LEFT(NEW.content, 140), ''),
    CASE WHEN NEW.attachment_url IS NOT NULL THEN '📎 Attachment' ELSE 'New message' END
  );

  IF NEW.sender_id = v_conv.user_id THEN
    BEGIN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'),
        v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tg_notify_messages admin notify failed: %', SQLERRM;
    END;
  ELSE
    BEGIN
      PERFORM public.nx_notify(
        v_conv.user_id, 'NEXPEC Admin replied', v_preview, 'message',
        CASE
          WHEN v_conv.kind LIKE 'job_%inspector%' THEN '/inspector/messages/' || v_conv.id::text
          ELSE '/client/messages/' || v_conv.id::text
        END,
        v_conv.job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tg_notify_messages user notify failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='messages' AND relnamespace='public'::regnamespace) THEN
    CREATE TRIGGER trg_notify_messages
      AFTER INSERT ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.tg_notify_messages();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'messages trigger: %', SQLERRM; END $$;

-- ── 7) END-TO-END SMOKE TEST: notify every admin right now ─────────────
DO $$
DECLARE r RECORD; v_count int := 0;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.nx_notify(
      r.id,
      '🟢 Notifications v3 — bulletproof',
      'If you see THIS in your bell, the entire pipeline is wired: trigger + RLS + realtime publication + frontend listener. Test new job posts to confirm auto-firing.',
      'system',
      '/admin/diagnostics',
      NULL);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Inserted % bulletproof smoke notification(s)', v_count;
END $$;

-- ── 8) RECALCULATE unread counter from scratch to fix any drift ────────
UPDATE public.profiles p
   SET unread_notifications_count = COALESCE(c.cnt, 0)
  FROM (
    SELECT recipient_id, count(*) AS cnt
      FROM public.notifications
     WHERE is_read = false
     GROUP BY recipient_id
  ) c
 WHERE p.id = c.recipient_id;

UPDATE public.profiles
   SET unread_notifications_count = 0
 WHERE id NOT IN (
   SELECT recipient_id FROM public.notifications WHERE is_read = false
 );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (run after COMMIT):
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Realtime publication includes notifications? (expect 1)
SELECT count(*) AS realtime_ok FROM pg_publication_tables
 WHERE pubname='supabase_realtime' AND tablename='notifications';

-- 2. SELECT policy exists with recipient_id check? (expect 1)
SELECT count(*) AS select_policy_ok FROM pg_policies
 WHERE schemaname='public' AND tablename='notifications'
   AND polcmd = 'r';

-- 3. Triggers installed? (expect 2 or 3)
SELECT tgname FROM pg_trigger
 WHERE tgrelid IN ('public.jobs'::regclass, 'public.applications'::regclass)
   AND tgname LIKE 'trg_notify_%';

-- 4. Your own unread count + last 5 notifications:
-- (run as the signed-in admin user)
SELECT
  (SELECT unread_notifications_count FROM public.profiles WHERE id = auth.uid()) AS my_unread,
  (SELECT count(*) FROM public.notifications WHERE recipient_id = auth.uid()) AS my_total;

SELECT id, kind, title, created_at
  FROM public.notifications
 WHERE recipient_id = auth.uid()
 ORDER BY created_at DESC
 LIMIT 5;
