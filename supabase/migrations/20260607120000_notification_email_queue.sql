-- ════════════════════════════════════════════════════════════════════════════
--  20260607120000_notification_email_queue.sql
--
--  Sprint goal — real-time notification fanout + email-queue plumbing
--  ──────────────────────────────────────────────────────────────────
--  The existing notifications infra (notify_safe + supabase_realtime
--  publication) already pushes in-app pings. This migration:
--
--  1) Extends `public.notifications` with an email-queue overlay
--     (email_required, email_dispatched_at, email_attempts,
--      email_send_error, email_template_kind, email_template_data).
--     The Edge Function `dispatch-notification-emails` reads queued
--     rows via `claim_pending_notification_emails(...)` and writes
--     results back via `mark_notification_email_sent(...)` /
--     `mark_notification_email_failed(...)`.
--
--  2) Adds three Procurement Control Plane fanout triggers — these
--     are the **real-time hooks** that turn database state changes
--     into both an in-app notifications row AND a queued transactional
--     email:
--
--        ▸ tg_notify_approval_requested   (approval_requests AFTER INSERT)
--            — Pings every eligible approver in the org whose
--              org_member.role is in the snapshotted
--              required_approver_roles. Also pings the requester
--              with a "submitted, awaiting review" receipt.
--
--        ▸ tg_notify_approval_decided     (approval_decisions AFTER INSERT)
--            — Pings the requester immediately on every decision.
--              When the request reaches the approved/rejected
--              terminal state inside the same statement, pings the
--              other approvers + the requester with the final verdict.
--
--        ▸ tg_notify_evidence_pack_assembled
--                                         (audit_events AFTER INSERT
--                                          WHERE event_type =
--                                          'compliance.evidence_pack.assembled')
--            — Pings the user who assembled the pack with a receipt
--              link, plus broadcasts to the org's procurement_admin /
--              owner seats so compliance leadership stays aware.
--
--  All three triggers route through `enqueue_notification(...)`, which
--  is a thin wrapper over `notify_safe` that ALSO stamps the email
--  queue overlay so the dispatcher picks the row up.
--
--  DOCTRINE
--  ────────
--  • Idempotent — DROP IF EXISTS + CREATE OR REPLACE everywhere.
--  • Defensive — every trigger body wrapped in EXCEPTION block; a
--    notification failure must NEVER abort the underlying business
--    write (approval submitted, decision recorded, evidence pack
--    assembled). The audit trail is more important than the ping.
--  • SECURITY DEFINER + `SET search_path = public, pg_temp` on every
--    function. Matches the existing notify_safe contract.
--  • Customer-facing copy NEVER mentions the literal string
--    "super_admin"; we use "NEXPEC Admin" / "NEXPEC System" in
--    accordance with the Singular Platform Owner doctrine.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Extend notifications with the email-queue overlay.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS email_required       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_dispatched_at  timestamptz,
  ADD COLUMN IF NOT EXISTS email_attempts       int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_send_error     text,
  ADD COLUMN IF NOT EXISTS email_template_kind  text,
  ADD COLUMN IF NOT EXISTS email_template_data  jsonb       NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.notifications.email_required IS
  'TRUE means this notification should also be delivered as a transactional email. The dispatch-notification-emails Edge Function polls rows where email_required AND email_dispatched_at IS NULL AND email_attempts < 5.';
COMMENT ON COLUMN public.notifications.email_template_kind IS
  'Which Resend template to render. e.g. approval.requested, approval.decided, evidence_pack.assembled. The template lives in the Edge Function — this column tells it which one to use.';
COMMENT ON COLUMN public.notifications.email_template_data IS
  'JSON bag of template-specific variables (approver name, job title, currency-formatted amount, links, ...). Frozen at trigger time so retries are deterministic.';

-- Hot-path index: the Edge Function polls "give me emails to send".
CREATE INDEX IF NOT EXISTS notifications_email_queue_idx
  ON public.notifications (email_attempts, created_at)
  WHERE email_required = true
    AND email_dispatched_at IS NULL
    AND email_attempts < 5;

-- Helper view-style index: "which recipients still have unread emails"
CREATE INDEX IF NOT EXISTS notifications_email_pending_recipient_idx
  ON public.notifications (recipient_id, email_required, email_dispatched_at)
  WHERE email_required = true AND email_dispatched_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2) enqueue_notification — the canonical fanout helper.
--
--    A thin wrapper over notify_safe that ALSO stamps the email queue
--    overlay. Returns the created notification id (or NULL if recipient
--    was NULL or the insert silently failed inside notify_safe).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_recipient       uuid,
  p_kind            text,
  p_title           text,
  p_body            text   DEFAULT NULL,
  p_link            text   DEFAULT NULL,
  p_job_id          uuid   DEFAULT NULL,
  p_email_required  boolean DEFAULT false,
  p_template_kind   text   DEFAULT NULL,
  p_template_data   jsonb  DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  -- Reuse notify_safe so the in-app push, realtime publication, and
  -- profile unread-count update all stay in one code path.
  v_id := public.notify_safe(
    p_recipient,
    p_kind,
    p_title,
    p_body,
    p_link,
    p_job_id
  );

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Stamp the email overlay if requested.
  IF p_email_required IS TRUE THEN
    UPDATE public.notifications
       SET email_required      = true,
           email_template_kind = p_template_kind,
           email_template_data = COALESCE(p_template_data, '{}'::jsonb)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'enqueue_notification(%, %): %', p_kind, p_recipient, SQLERRM;
  RETURN NULL;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.enqueue_notification(
  uuid, text, text, text, text, uuid, boolean, text, jsonb
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Edge-Function-facing claim/mark RPCs.
--
--    These are the service-role-only handles the dispatcher calls.
-- ─────────────────────────────────────────────────────────────────────

-- Claim up to `p_limit` pending email-required notifications.
-- The dispatcher pulls these, renders + sends via Resend, then marks
-- them sent (or failed). The claim atomically bumps email_attempts
-- so two concurrent dispatchers don't double-send.
CREATE OR REPLACE FUNCTION public.claim_pending_notification_emails(
  p_limit int DEFAULT 25
) RETURNS TABLE (
  id                  uuid,
  recipient_id        uuid,
  recipient_email     text,
  recipient_name      text,
  kind                text,
  title               text,
  body                text,
  link_href           text,
  job_id              uuid,
  email_template_kind text,
  email_template_data jsonb,
  email_attempts      int,
  created_at          timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT n.id
      FROM public.notifications n
     WHERE n.email_required = true
       AND n.email_dispatched_at IS NULL
       AND n.email_attempts < 5
     ORDER BY n.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  bumped AS (
    UPDATE public.notifications n
       SET email_attempts        = n.email_attempts + 1,
           email_last_attempt_at = now()
      FROM claimed
     WHERE n.id = claimed.id
    RETURNING n.*
  )
  SELECT b.id,
         b.recipient_id,
         p.email                                          AS recipient_email,
         COALESCE(NULLIF(p.full_name, ''), p.email)        AS recipient_name,
         b.kind,
         b.title,
         b.body,
         b.link_href,
         b.job_id,
         b.email_template_kind,
         b.email_template_data,
         b.email_attempts,
         b.created_at
    FROM bumped b
    JOIN public.profiles p ON p.id = b.recipient_id
   ORDER BY b.created_at ASC;
END
$fn$;

REVOKE ALL ON FUNCTION public.claim_pending_notification_emails(int) FROM PUBLIC;
-- service_role is implicit; no GRANT to authenticated.

-- Mark a notification email as successfully dispatched.
CREATE OR REPLACE FUNCTION public.mark_notification_email_sent(
  p_notification_id uuid,
  p_provider_id     text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.notifications
     SET email_dispatched_at = now(),
         email_send_error    = NULL,
         email_template_data = email_template_data
           || jsonb_build_object('resend_id', COALESCE(p_provider_id, ''))
   WHERE id = p_notification_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.mark_notification_email_sent(uuid, text) FROM PUBLIC;

-- Mark a notification email send as failed. Edge Function will retry
-- up to email_attempts = 5; after that it's parked and surfaced via
-- the admin email-queue dashboard.
CREATE OR REPLACE FUNCTION public.mark_notification_email_failed(
  p_notification_id uuid,
  p_error_message   text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.notifications
     SET email_send_error = LEFT(COALESCE(p_error_message, 'unknown error'), 1000)
   WHERE id = p_notification_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.mark_notification_email_failed(uuid, text) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Helper: format cents+currency into a display string for the
--    notification body. Mirrors the web's formatCents() but kept here
--    so the trigger payload is self-contained.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.format_amount_for_notification(
  p_amount_cents bigint,
  p_currency     text
) RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $fn$
DECLARE
  v_dollars numeric;
  v_symbol  text;
BEGIN
  IF p_amount_cents IS NULL THEN RETURN ''; END IF;
  v_dollars := (p_amount_cents::numeric) / 100.0;
  v_symbol  := CASE upper(COALESCE(p_currency, ''))
                 WHEN 'USD' THEN '$'
                 WHEN 'EUR' THEN '€'
                 WHEN 'GBP' THEN '£'
                 WHEN 'JPY' THEN '¥'
                 WHEN 'CHF' THEN 'CHF '
                 WHEN 'AED' THEN 'AED '
                 WHEN 'CAD' THEN 'CA$'
                 WHEN 'AUD' THEN 'A$'
                 WHEN 'SGD' THEN 'S$'
                 ELSE COALESCE(p_currency, '') || ' '
               END;
  RETURN v_symbol || trim(to_char(v_dollars, 'FM999,999,999,990.00'));
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) TRIGGER A — approval_requests AFTER INSERT.
--
--    Fans out to every eligible approver (org_members whose role is
--    in the snapshotted required_approver_roles), plus a receipt
--    to the requester.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_approval_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job        RECORD;
  v_org        RECORD;
  v_dept_name  text;
  v_requester  RECORD;
  v_amount_str text;
  v_approver   RECORD;
  v_link_approver text;
  v_link_requester text;
  v_template_data jsonb;
BEGIN
  -- Job context.
  SELECT id, title, client_id, agency_id
    INTO v_job
    FROM public.jobs
   WHERE id = NEW.job_id;

  -- Org context.
  SELECT id, name
    INTO v_org
    FROM public.organizations
   WHERE id = NEW.org_id;

  -- Department label (optional).
  IF NEW.department_id IS NOT NULL THEN
    SELECT name INTO v_dept_name
      FROM public.departments
     WHERE id = NEW.department_id;
  END IF;

  -- Requester profile.
  SELECT id, full_name, email
    INTO v_requester
    FROM public.profiles
   WHERE id = NEW.requested_by;

  v_amount_str := public.format_amount_for_notification(
    NEW.amount_cents,
    NEW.currency::text
  );

  v_link_approver  := '/client/approvals?request=' || NEW.id::text;
  v_link_requester := '/client/jobs/' || NEW.job_id::text;

  v_template_data := jsonb_build_object(
    'approval_request_id',   NEW.id,
    'job_id',                NEW.job_id,
    'job_title',             COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'org_id',                NEW.org_id,
    'org_name',              COALESCE(NULLIF(v_org.name, ''), 'Your organization'),
    'department_id',         NEW.department_id,
    'department_name',       v_dept_name,
    'requester_id',          NEW.requested_by,
    'requester_name',        COALESCE(NULLIF(v_requester.full_name, ''), v_requester.email),
    'amount_cents',          NEW.amount_cents,
    'currency',              NEW.currency::text,
    'amount_display',        v_amount_str,
    'min_approvers_required', NEW.min_approvers_required,
    'required_approver_roles', to_jsonb(NEW.required_approver_roles),
    'requires_sod',          NEW.requires_sod,
    'requested_at',          NEW.requested_at,
    'approver_link',         v_link_approver,
    'requester_link',        v_link_requester
  );

  -- Fan out to every eligible approver. SoD: skip the requester
  -- (they cannot approve their own request, ever).
  FOR v_approver IN
    SELECT om.user_id, p.full_name, p.email, om.role
      FROM public.org_members om
      JOIN public.profiles    p ON p.id = om.user_id
     WHERE om.org_id = NEW.org_id
       AND om.role::text = ANY (NEW.required_approver_roles)
       AND om.user_id <> NEW.requested_by
  LOOP
    PERFORM public.enqueue_notification(
      v_approver.user_id,
      'approval_requested',
      'Approval needed: ' || COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
      COALESCE(NULLIF(v_requester.full_name, ''), v_requester.email)
        || ' submitted '
        || v_amount_str
        || CASE WHEN v_dept_name IS NOT NULL THEN ' for ' || v_dept_name ELSE '' END
        || '.',
      v_link_approver,
      NEW.job_id,
      true,
      'approval.requested',
      v_template_data || jsonb_build_object(
        'recipient_role', v_approver.role,
        'recipient_full_name', COALESCE(NULLIF(v_approver.full_name, ''), v_approver.email)
      )
    );
  END LOOP;

  -- Receipt to requester (in-app only; no email — they just clicked
  -- "submit", they don't need their inbox flooded).
  PERFORM public.enqueue_notification(
    NEW.requested_by,
    'approval_submitted',
    'Approval request submitted',
    'Your '
      || v_amount_str
      || ' job is queued for review. We''ll notify you once a decision is made.',
    v_link_requester,
    NEW.job_id,
    false,
    NULL,
    v_template_data
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Notifications must never block the underlying business write.
  RAISE NOTICE 'tg_notify_approval_requested: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_approval_requested ON public.approval_requests;
CREATE TRIGGER tg_notify_approval_requested
  AFTER INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_approval_requested();

-- ─────────────────────────────────────────────────────────────────────
-- 6a) TRIGGER B-1 — approval_decisions AFTER INSERT.
--
--     Per-decision ping to the requester ("Carla approved your job").
--     We do NOT compute terminal state here — submit_job_approval
--     updates approval_requests.status in a SEPARATE statement that
--     runs AFTER this trigger fires, so reading it here would always
--     see the stale 'pending' value. The terminal-state announcement
--     lives in trigger B-2 below, on approval_requests UPDATE OF status.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_approval_decided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_req         RECORD;
  v_decider     RECORD;
  v_job         RECORD;
  v_amount_str  text;
  v_template_data jsonb;
  v_link_requester text;
  v_link_approver  text;
BEGIN
  SELECT id, org_id, job_id, department_id, requested_by,
         amount_cents, currency, status,
         min_approvers_required, required_approver_roles
    INTO v_req
    FROM public.approval_requests
   WHERE id = NEW.approval_request_id;

  IF v_req.id IS NULL THEN
    -- FK should prevent this; defensive only.
    RETURN NEW;
  END IF;

  SELECT id, full_name, email
    INTO v_decider
    FROM public.profiles
   WHERE id = NEW.decided_by;

  SELECT id, title
    INTO v_job
    FROM public.jobs
   WHERE id = v_req.job_id;

  v_amount_str := public.format_amount_for_notification(
    v_req.amount_cents,
    v_req.currency::text
  );

  v_link_requester := '/client/jobs/' || v_req.job_id::text;
  v_link_approver  := '/client/approvals?request=' || v_req.id::text;

  v_template_data := jsonb_build_object(
    'approval_request_id', v_req.id,
    'job_id',              v_req.job_id,
    'job_title',           COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'org_id',              v_req.org_id,
    'department_id',       v_req.department_id,
    'requester_id',        v_req.requested_by,
    'decider_id',          NEW.decided_by,
    'decider_name',        COALESCE(NULLIF(v_decider.full_name, ''), v_decider.email),
    'decider_role_at_time', NEW.decider_role_at_time,
    'decision',            NEW.decision,
    'comment',             NEW.comment,
    'amount_cents',        v_req.amount_cents,
    'currency',            v_req.currency::text,
    'amount_display',      v_amount_str,
    'requester_link',      v_link_requester,
    'approver_link',       v_link_approver
  );

  -- Tell the requester this approver weighed in. In-app only; the
  -- email goes from trigger B-2 once the terminal state lands.
  PERFORM public.enqueue_notification(
    v_req.requested_by,
    'approval_progress',
    CASE NEW.decision
      WHEN 'approved' THEN 'Approval received: ' || COALESCE(NULLIF(v_job.title, ''), 'Inspection job')
      WHEN 'rejected' THEN 'Approval rejected: '  || COALESCE(NULLIF(v_job.title, ''), 'Inspection job')
      ELSE 'Approval updated'
    END,
    COALESCE(NULLIF(v_decider.full_name, ''), v_decider.email)
      || ' ' || NEW.decision
      || CASE WHEN NEW.comment IS NOT NULL AND length(NEW.comment) > 0
              THEN ' — "' || LEFT(NEW.comment, 180) || '"' ELSE '' END,
    v_link_requester,
    v_req.job_id,
    false,
    NULL,
    v_template_data
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_approval_decided: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_approval_decided ON public.approval_decisions;
CREATE TRIGGER tg_notify_approval_decided
  AFTER INSERT ON public.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_approval_decided();

-- ─────────────────────────────────────────────────────────────────────
-- 6b) TRIGGER B-2 — approval_requests AFTER UPDATE OF status.
--
--     Fires the loud "final verdict" notification (with email) the
--     moment status transitions from pending → approved/rejected.
--     Runs AFTER submit_job_approval has finished updating, so the
--     row already reflects the final state. Also broadcasts to the
--     other approvers so the pending-approvals queue clears for them.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_approval_finalised()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job          RECORD;
  v_amount_str   text;
  v_decider      RECORD;
  v_other        RECORD;
  v_link_requester text;
  v_link_approver  text;
  v_verdict_text   text;
  v_template_kind  text;
  v_template_data  jsonb;
  v_last_comment   text;
BEGIN
  -- Only act when status FLIPS into a terminal state.
  IF NOT (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')) THEN
    RETURN NEW;
  END IF;

  v_verdict_text  := NEW.status;
  v_template_kind := CASE NEW.status
                       WHEN 'approved' THEN 'approval.decided.approved'
                       WHEN 'rejected' THEN 'approval.decided.rejected'
                     END;

  SELECT id, title
    INTO v_job
    FROM public.jobs
   WHERE id = NEW.job_id;

  v_amount_str := public.format_amount_for_notification(
    NEW.amount_cents,
    NEW.currency::text
  );

  -- The decider that pushed us into terminal state.
  IF NEW.final_decision_by IS NOT NULL THEN
    SELECT id, full_name, email
      INTO v_decider
      FROM public.profiles
     WHERE id = NEW.final_decision_by;
  END IF;

  -- Last comment, in case the requester needs context (rejection reason
  -- or the closing approver's note).
  SELECT comment
    INTO v_last_comment
    FROM public.approval_decisions
   WHERE approval_request_id = NEW.id
   ORDER BY decided_at DESC
   LIMIT 1;

  v_link_requester := '/client/jobs/' || NEW.job_id::text;
  v_link_approver  := '/client/approvals?request=' || NEW.id::text;

  v_template_data := jsonb_build_object(
    'approval_request_id', NEW.id,
    'job_id',              NEW.job_id,
    'job_title',           COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'org_id',              NEW.org_id,
    'department_id',       NEW.department_id,
    'requester_id',        NEW.requested_by,
    'decider_id',          NEW.final_decision_by,
    'decider_name',        COALESCE(NULLIF(v_decider.full_name, ''), v_decider.email),
    'comment',             v_last_comment,
    'amount_cents',        NEW.amount_cents,
    'currency',            NEW.currency::text,
    'amount_display',      v_amount_str,
    'requester_link',      v_link_requester,
    'approver_link',       v_link_approver,
    'request_status',      NEW.status,
    'final_decision_at',   NEW.final_decision_at,
    'rejection_reason',    NEW.rejection_reason
  );

  -- A) Loud notification to the requester (in-app + email).
  PERFORM public.enqueue_notification(
    NEW.requested_by,
    CASE NEW.status
      WHEN 'approved' THEN 'approval_granted'
      WHEN 'rejected' THEN 'approval_denied'
    END,
    CASE NEW.status
      WHEN 'approved' THEN 'Approved: ' || COALESCE(NULLIF(v_job.title, ''), 'Inspection job')
      WHEN 'rejected' THEN 'Not approved: ' || COALESCE(NULLIF(v_job.title, ''), 'Inspection job')
    END,
    CASE NEW.status
      WHEN 'approved' THEN 'Your '
        || v_amount_str
        || ' request cleared approvals and the job is now live.'
      WHEN 'rejected' THEN 'Your '
        || v_amount_str
        || ' request was not approved'
        || CASE WHEN NEW.rejection_reason IS NOT NULL AND length(NEW.rejection_reason) > 0
                THEN ' — ' || LEFT(NEW.rejection_reason, 180) ELSE '' END
        || '.'
    END,
    v_link_requester,
    NEW.job_id,
    true,
    v_template_kind,
    v_template_data
  );

  -- B) Broadcast to the OTHER approvers so the pending queue clears.
  FOR v_other IN
    SELECT om.user_id, p.full_name, p.email, om.role
      FROM public.org_members om
      JOIN public.profiles    p ON p.id = om.user_id
     WHERE om.org_id = NEW.org_id
       AND om.role::text = ANY (NEW.required_approver_roles)
       AND om.user_id <> NEW.requested_by
       AND om.user_id <> COALESCE(NEW.final_decision_by, '00000000-0000-0000-0000-000000000000'::uuid)
  LOOP
    PERFORM public.enqueue_notification(
      v_other.user_id,
      'approval_finalised',
      'Approval ' || v_verdict_text || ': '
        || COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
      COALESCE(NULLIF(v_decider.full_name, ''), v_decider.email)
        || ' ' || v_verdict_text || ' the request — no action needed.',
      v_link_approver,
      NEW.job_id,
      false,
      NULL,
      v_template_data || jsonb_build_object(
        'recipient_role', v_other.role,
        'recipient_full_name', COALESCE(NULLIF(v_other.full_name, ''), v_other.email)
      )
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_approval_finalised: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_approval_finalised ON public.approval_requests;
CREATE TRIGGER tg_notify_approval_finalised
  AFTER UPDATE OF status ON public.approval_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_notify_approval_finalised();

-- ─────────────────────────────────────────────────────────────────────
-- 7) TRIGGER C — audit_events AFTER INSERT
--                WHERE event_type = 'compliance.evidence_pack.assembled'.
--
--    Pings the assembler with a download link and broadcasts to the
--    org's procurement_admin/owner seats. Identifies the org via the
--    job_id → jobs.client_id/agency_id (which is itself an org).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_evidence_pack_assembled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job         RECORD;
  v_org_id      uuid;
  v_assembler   RECORD;
  v_member      RECORD;
  v_link        text;
  v_root_hash   text;
  v_pack_id     text;
  v_template_data jsonb;
BEGIN
  -- Filter at the function body level (rather than WHEN clause) so we
  -- can keep the trigger definition simple and not depend on event_type
  -- being a stable text literal in pg_catalog.
  IF NEW.event_type IS DISTINCT FROM 'compliance.evidence_pack.assembled' THEN
    RETURN NEW;
  END IF;

  -- Pull job + org.
  IF NEW.job_id IS NOT NULL THEN
    SELECT id, title, COALESCE(client_id, agency_id) AS org_id
      INTO v_job
      FROM public.jobs
     WHERE id = NEW.job_id;
    v_org_id := v_job.org_id;
  END IF;

  -- Pull assembler.
  SELECT id, full_name, email
    INTO v_assembler
    FROM public.profiles
   WHERE id = NEW.actor_id;

  v_root_hash := COALESCE(NEW.metadata ->> 'root_hash', NEW.delta ->> 'root_hash');
  v_pack_id   := COALESCE(NEW.metadata ->> 'pack_id',   NEW.delta ->> 'pack_id');
  v_link      := CASE
                   WHEN NEW.job_id IS NOT NULL
                     THEN '/client/jobs/' || NEW.job_id::text || '#evidence'
                   ELSE '/client/compliance'
                 END;

  v_template_data := jsonb_build_object(
    'audit_event_id',  NEW.id,
    'event_type',      NEW.event_type,
    'job_id',          NEW.job_id,
    'job_title',       COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'org_id',          v_org_id,
    'assembler_id',    NEW.actor_id,
    'assembler_name',  COALESCE(NULLIF(v_assembler.full_name, ''), v_assembler.email),
    'root_hash',       v_root_hash,
    'pack_id',         v_pack_id,
    'assembled_at',    NEW.created_at,
    'pack_link',       v_link,
    'verify_link',     '/verify'
  );

  -- Receipt to the assembler.
  IF NEW.actor_id IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      NEW.actor_id,
      'evidence_pack_assembled',
      'Evidence pack ready',
      'Pack ' || COALESCE(LEFT(v_root_hash, 12), 'verified')
        || ' for ' || COALESCE(NULLIF(v_job.title, ''), 'this job')
        || ' is ready to share.',
      v_link,
      NEW.job_id,
      true,
      'evidence_pack.assembled',
      v_template_data || jsonb_build_object('recipient_role', 'assembler')
    );
  END IF;

  -- Broadcast to compliance leadership for the same org.
  IF v_org_id IS NOT NULL THEN
    FOR v_member IN
      SELECT om.user_id, p.full_name, p.email, om.role
        FROM public.org_members om
        JOIN public.profiles    p ON p.id = om.user_id
       WHERE om.org_id = v_org_id
         AND om.role IN ('owner', 'procurement_admin')
         AND om.user_id <> COALESCE(NEW.actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      PERFORM public.enqueue_notification(
        v_member.user_id,
        'evidence_pack_assembled',
        'New evidence pack assembled',
        COALESCE(NULLIF(v_assembler.full_name, ''), v_assembler.email)
          || ' assembled an evidence pack for '
          || COALESCE(NULLIF(v_job.title, ''), 'an inspection job') || '.',
        v_link,
        NEW.job_id,
        false,   -- In-app only for leadership; assembler already got the email.
        NULL,
        v_template_data || jsonb_build_object(
          'recipient_role', v_member.role,
          'recipient_full_name', COALESCE(NULLIF(v_member.full_name, ''), v_member.email)
        )
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_evidence_pack_assembled: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_evidence_pack_assembled ON public.audit_events;
CREATE TRIGGER tg_notify_evidence_pack_assembled
  AFTER INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_evidence_pack_assembled();

COMMIT;
