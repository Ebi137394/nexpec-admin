-- ============================================================================
--  20260801120300_notification_consent.sql
--
--  PHASE 2 · NOTIFICATION CONSENT — one predicate, enforced at the chokepoint.
--
--  GOAL: user mute preferences are mathematically respected for push + email,
--  while the in-app bell ALWAYS works.
--
--  REALITY MAPPED FROM CODE:
--    • The mobile UI (app/notification-settings.tsx) reads/writes
--      public.notification_preferences(user_id, preferences jsonb) where
--      `preferences` is { "<toggle_id>": boolean } — e.g. push_notifications,
--      email_notifications, sms_alerts (master switches) + per-category toggles
--      (new_message, payout_processed, contract_assigned, …).
--    • That table had NO migration (created out of band, or silently missing →
--      saves failing). src/utils/notificationUtils.ts targets a DIFFERENT,
--      mismatched table (notification_settings) and is effectively dead.
--
--  THIS MIGRATION:
--    1) Defines notification_preferences (IF NOT EXISTS) + RLS so the UI's
--       reads/writes are real and mutes actually persist.
--    2) should_deliver(recipient, kind, channel) — the SINGLE source of truth.
--       in_app ⇒ always true; safety/system ⇒ always true; else master channel
--       switch AND per-category toggle, defaulting to DELIVER (opt-out) and
--       FAILING OPEN on any error (a predicate bug must never drop a message).
--    3) A BEFORE INSERT trigger on notifications that gates the EMAIL overlay at
--       the lowest layer — catching every path (enqueue_notification AND direct
--       trigger inserts like the bridge). External transactional emails carrying
--       `override_to` (vendor invitations) are exempt.
--
--  PUSH is gated in the notify-job-event Edge Function (the only push sender),
--  which calls should_deliver(...,'push') and skips the device push while still
--  writing the in-app row.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) notification_preferences — canonical per-user prefs (matches the UI).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  preferences jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_self ON public.notification_preferences;
CREATE POLICY notification_preferences_self
  ON public.notification_preferences
  FOR ALL
  USING (user_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.nx_is_admin());

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_notification_preferences_touch()
RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$t$;

DROP TRIGGER IF EXISTS tg_notification_preferences_touch ON public.notification_preferences;
CREATE TRIGGER tg_notification_preferences_touch
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_notification_preferences_touch();

-- ─────────────────────────────────────────────────────────────────────
-- 2) should_deliver — the single consent predicate.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.should_deliver(
  p_recipient uuid,
  p_kind      text,
  p_channel   text                       -- 'in_app' | 'push' | 'email' | 'sms'
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prefs       jsonb;
  v_channel_key text;
  v_cat_key     text;
BEGIN
  -- The in-app bell is always reliable.
  IF p_channel = 'in_app' THEN RETURN true; END IF;
  -- Defensive: unknown recipient/kind must never be suppressed.
  IF p_recipient IS NULL OR p_kind IS NULL THEN RETURN true; END IF;
  -- Hard-critical safety/security always delivers on every channel.
  IF p_kind IN ('system','system_updates','urgent_safety','security') THEN
    RETURN true;
  END IF;

  SELECT preferences INTO v_prefs
    FROM public.notification_preferences
   WHERE user_id = p_recipient;

  -- No prefs row → opt-out default = deliver.
  IF v_prefs IS NULL THEN RETURN true; END IF;

  -- Master channel switch (default ON; SMS defaults OFF to match the UI).
  v_channel_key := CASE p_channel
                     WHEN 'push'  THEN 'push_notifications'
                     WHEN 'email' THEN 'email_notifications'
                     WHEN 'sms'   THEN 'sms_alerts'
                     ELSE NULL END;
  IF v_channel_key IS NOT NULL
     AND COALESCE((v_prefs ->> v_channel_key)::boolean,
                  CASE WHEN p_channel = 'sms' THEN false ELSE true END) IS FALSE
  THEN
    RETURN false;
  END IF;

  -- Map notification kind → UI category toggle id.
  v_cat_key := CASE p_kind
    WHEN 'message'            THEN 'new_message'
    WHEN 'new_message'        THEN 'new_message'
    WHEN 'payout_released'    THEN 'payout_processed'
    WHEN 'payout_processed'   THEN 'payout_processed'
    WHEN 'assignment'         THEN 'contract_assigned'
    WHEN 'contract_assigned'  THEN 'contract_assigned'
    WHEN 'report_submitted'   THEN 'report_approved_rejected'
    WHEN 'report_approved'    THEN 'report_approved_rejected'
    WHEN 'document_uploaded'  THEN 'document_uploaded'
    WHEN 'application_status'  THEN 'new_applicant'
    WHEN 'invoice'            THEN 'invoice_generated'
    WHEN 'invoice_generated'  THEN 'invoice_generated'
    ELSE NULL END;

  -- Unknown/transactional kind → governed only by the master switch above.
  IF v_cat_key IS NULL THEN RETURN true; END IF;

  RETURN COALESCE((v_prefs ->> v_cat_key)::boolean, true);
EXCEPTION WHEN OTHERS THEN
  -- FAIL OPEN — a consent-predicate error must never silently drop a message.
  RETURN true;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.should_deliver(uuid, text, text)
  TO authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Email chokepoint — BEFORE INSERT on notifications.
--    Gates the email overlay for EVERY insert path. external transactional
--    emails (override_to, e.g. vendor invitations) are exempt.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notifications_consent_gate()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.email_required IS NOT TRUE THEN RETURN NEW; END IF;
  -- External/transactional recipients aren't NEXPEC users → not user-mutable.
  IF COALESCE(NEW.email_template_data, '{}'::jsonb) ? 'override_to' THEN
    RETURN NEW;
  END IF;
  -- Old-shape rows without recipient/kind: leave untouched.
  IF NEW.recipient_id IS NULL OR NEW.kind IS NULL THEN RETURN NEW; END IF;

  IF NOT public.should_deliver(NEW.recipient_id, NEW.kind, 'email') THEN
    NEW.email_required := false;   -- suppress email; the in-app row still lands
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;                       -- fail open
END
$fn$;

DROP TRIGGER IF EXISTS tg_notifications_consent_gate ON public.notifications;
CREATE TRIGGER tg_notifications_consent_gate
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_consent_gate();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION
--   -- master email mute suppresses email but keeps in-app:
--   INSERT INTO public.notification_preferences(user_id, preferences)
--     VALUES ('<uid>', '{"email_notifications": false}') ON CONFLICT (user_id)
--     DO UPDATE SET preferences = excluded.preferences;
--   SELECT public.should_deliver('<uid>','payout_released','email'); -- false
--   SELECT public.should_deliver('<uid>','payout_released','in_app'); -- true
--   SELECT public.should_deliver('<uid>','system','email');           -- true (critical)
-- ─────────────────────────────────────────────────────────────────────
