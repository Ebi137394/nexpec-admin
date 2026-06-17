-- ════════════════════════════════════════════════════════════════════════════
--  20260801130000_anonymize_seal_notification_client.sql
--
--  ANTI-POACHING / IDENTITY ESCROW — close a pre-reveal leak in the
--  report-seal notification.
--
--  tg_notify_inspection_report_sealed (added in 20260610120000) fires AFTER an
--  inspector seals their report — i.e. BEFORE admin has confirmed/forwarded it
--  (admin_confirmed_at) and therefore BEFORE the client is allowed to know the
--  inspector's real identity. The original function, being SECURITY DEFINER,
--  read profiles.full_name/email (bypassing the profiles RLS lockdown) and
--  wrote the inspector's REAL NAME into:
--    • the in-app notification body sent to the client, and
--    • template_data.inspector_name (rendered into the client's email).
--
--  This migration CREATE-OR-REPLACEs the function so the client-facing text +
--  email use a non-identifying label ("Your assigned inspector"). Everything
--  else (links, seal metadata, verify hash, recipient, template key, error
--  handling) is byte-for-byte preserved. The trigger binding is unchanged
--  (CREATE OR REPLACE keeps it). Idempotent. ADDITIVE.
--
--  Note: the real name is still revealed to the client AFTER report sign-off /
--  completion through the normal gated surfaces (rating, final-report review).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_notify_inspection_report_sealed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job        RECORD;
  v_link       text;
  v_verify     text;
  v_template_data jsonb;
BEGIN
  -- Job context — bail silently if we can't resolve the client.
  SELECT id, title, client_id
    INTO v_job
    FROM public.jobs
   WHERE id = NEW.job_id;

  IF v_job.id IS NULL OR v_job.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_link   := '/client/jobs/' || NEW.job_id::text || '#countersign';
  v_verify := '/verify?seal_id=' || NEW.id::text
              || '&hash=' || NEW.root_sha256;

  -- ANTI-POACHING: the client is PRE-REVEAL at seal time (before admin
  -- confirms the report). Never place the inspector's real name in any
  -- client-facing notification text or email. `inspector_id` (opaque UUID) is
  -- retained for internal correlation; the human-readable label is generic.
  v_template_data := jsonb_build_object(
    'seal_id',                    NEW.id,
    'report_id',                  NEW.report_id,
    'job_id',                     NEW.job_id,
    'job_title',                  COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'inspector_id',               NEW.inspector_id,
    'inspector_name',             'Your assigned inspector',
    'root_sha256',                NEW.root_sha256,
    'captures_count',             NEW.captures_count,
    'items_count',                NEW.items_count,
    'chain_verified',             NEW.chain_verified,
    'algorithm',                  NEW.algorithm,
    'inspector_sealed_at',        NEW.inspector_sealed_at,
    'inspector_signature_sha256', NEW.inspector_signature_sha256,
    'countersign_link',           v_link,
    'verify_link',                v_verify
  );

  -- Pings client + queues email (identity-free body).
  PERFORM public.enqueue_notification(
    v_job.client_id,
    'inspection_sealed_awaiting_countersign',
    'Your inspection report is sealed — ready to countersign',
    'Your assigned inspector sealed the report for '
      || COALESCE(NULLIF(v_job.title, ''), 'this job')
      || '. Open it to review and add your countersignature.',
    v_link,
    NEW.job_id,
    true,
    'inspection_report.sealed_awaiting_countersign',
    v_template_data
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_inspection_report_sealed: %', SQLERRM;
  RETURN NEW;
END
$fn$;

-- ── Self-test ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.tg_notify_inspection_report_sealed()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: tg_notify_inspection_report_sealed missing';
  END IF;
  v_src := pg_get_functiondef('public.tg_notify_inspection_report_sealed()'::regprocedure);
  IF position('Your assigned inspector' IN v_src) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: anonymized label not present';
  END IF;
  IF position('v_inspector.full_name' IN v_src) > 0 THEN
    RAISE EXCEPTION 'SELFTEST: real-name reference still present in client notification';
  END IF;
  RAISE NOTICE 'Seal-notification anonymized: client no longer receives the inspector real name pre-reveal.';
END $$;

COMMIT;
