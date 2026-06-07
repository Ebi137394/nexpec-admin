-- ════════════════════════════════════════════════════════════════════════════
--  20260801134000_flash_report_notifications.sql
--
--  PHASE B — alerts for Flash Reports (NCRs).
--
--  Until now a raised flash report only wrote an audit_events row; no one was
--  pinged. This adds the missing notification fanout, mirroring the existing
--  enqueue_notification pattern (tg_notify_inspection_report_sealed /
--  tg_notify_approval_*):
--
--    • EVERY raise   → in-app ping to every admin / super_admin (email on
--                      critical, so observations don't flood inboxes).
--    • CRITICAL only → an additional in-app + email ping to the job's client.
--
--  Implementation is an AFTER INSERT trigger on public.flash_reports. It is
--  ADDITIVE — it does NOT touch the flash_report_create RPC. Because the RPC's
--  offline-idempotent replay does NOT re-insert (it returns the existing row),
--  this fires exactly once per real raise, on web and mobile alike.
--
--  IDENTITY ESCROW (anti-poaching): every body references severity / category /
--  reporter ROLE only — never a name. No profiles.full_name is read. The
--  reporter is excluded from their own alert.
--
--  DOCTRINE: SECURITY DEFINER + SET search_path; the whole body is wrapped in
--  EXCEPTION WHEN OTHERS so a notification failure can NEVER abort the raise.
--  Idempotent + ADDITIVE + self-tested.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_notify_flash_report_raised()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job          RECORD;
  v_admin        RECORD;
  v_is_critical  boolean;
  v_sev_label    text;
  v_admin_link   text;
  v_client_link  text;
  v_template     jsonb;
BEGIN
  SELECT id, title, client_id
    INTO v_job
    FROM public.jobs
   WHERE id = NEW.job_id;

  IF v_job.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_critical := (NEW.severity = 'critical');
  v_sev_label   := initcap(NEW.severity);   -- "Critical" / "Major" / "Minor" / "Observation"
  v_admin_link  := '/admin/jobs?inspect=' || NEW.job_id::text || '#moderation';
  v_client_link := '/client/jobs/' || NEW.job_id::text;

  -- Identity-safe payload — role + severity + category only, never a name.
  v_template := jsonb_build_object(
    'flash_report_id', NEW.id,
    'job_id',          NEW.job_id,
    'job_title',       COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'severity',        NEW.severity,
    'category',        NEW.category,
    'report_title',    NEW.title,
    'reporter_role',   NEW.reporter_role,
    'status',          NEW.status,
    'raised_at',       NEW.created_at
  );

  -- 1) Every admin / super_admin (except the reporter). Email on critical only.
  --    role::text guards against enum-label-not-found; admin == super_admin per
  --    the Singular Platform Owner doctrine, so cover both labels.
  FOR v_admin IN
    SELECT id
      FROM public.profiles
     WHERE role::text IN ('admin', 'super_admin')
       AND id <> NEW.reporter_id
  LOOP
    PERFORM public.enqueue_notification(
      v_admin.id,
      'flash_report_raised',
      v_sev_label || ' flash report — '
        || COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
      'A ' || NEW.severity || ' ' || replace(NEW.category, '_', ' ')
        || ' flash report was raised: ' || NEW.title,
      v_admin_link,
      NEW.job_id,
      v_is_critical,                       -- email only when critical
      'flash_report.raised',
      v_template
    );
  END LOOP;

  -- 2) Client — CRITICAL severities only (in-app + email). Excludes the
  --    reporter if the client raised it themselves. Identity-free body.
  IF v_is_critical
     AND v_job.client_id IS NOT NULL
     AND v_job.client_id <> NEW.reporter_id THEN
    PERFORM public.enqueue_notification(
      v_job.client_id,
      'flash_report_critical',
      'Critical issue raised on your job',
      'A critical ' || replace(NEW.category, '_', ' ')
        || ' issue was raised on '
        || COALESCE(NULLIF(v_job.title, ''), 'your job')
        || '. Open the job to review and acknowledge.',
      v_client_link,
      NEW.job_id,
      true,                                -- always email the client on critical
      'flash_report.critical_client',
      v_template
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification failure must never abort the underlying raise.
  RAISE NOTICE 'tg_notify_flash_report_raised: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_notify_flash_report_raised ON public.flash_reports;
CREATE TRIGGER trg_notify_flash_report_raised
  AFTER INSERT ON public.flash_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_notify_flash_report_raised();

-- ── Self-test ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.tg_notify_flash_report_raised()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: tg_notify_flash_report_raised missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_notify_flash_report_raised' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST: trg_notify_flash_report_raised not attached to public.flash_reports';
  END IF;
  v_src := pg_get_functiondef('public.tg_notify_flash_report_raised()'::regprocedure);
  -- Identity-escrow invariant — no full_name read anywhere in the body.
  IF position('full_name' IN v_src) > 0 THEN
    RAISE EXCEPTION 'SELFTEST: full_name reference present — identity-escrow violation';
  END IF;
  -- Canonical fanout path must be used.
  IF position('enqueue_notification' IN v_src) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: enqueue_notification not used';
  END IF;
  RAISE NOTICE 'Flash-report notifications live: admins on every raise (email on critical); client on critical only.';
END $$;

COMMIT;
