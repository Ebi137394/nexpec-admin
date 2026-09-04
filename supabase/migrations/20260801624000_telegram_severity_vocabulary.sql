-- ════════════════════════════════════════════════════════════════════════════
--  Route the notification kinds NEXPEC actually emits, and humanise the copy.
--
--  FOUND BY AUDITING THE LIVE VOCABULARY RATHER THAN THE ONE I ASSUMED.
--  nx_notification_severity was written against invented kind names
--  ('application', 'report', 'moderation', 'verification'). Production emits
--  none of those. Of the 18 kinds actually present, only THREE were routed to
--  Telegram (assignment, job_moderated, message); everything else fell through
--  to 'informational' and was silently dropped by the routing gate.
--
--  Kinds that were never reaching the owner, with live counts at the time of
--  writing:
--     fraud_alert (1)           "Cancellation spam detected"
--     dispute_opened (4)        "Dispute opened"
--     report_at_risk (2)        "Final reminder — report overdue"
--     job_created (4)           "New job for moderation"
--     source_job_created (2)    "Source/FAT job created"
--     contract_voided (2)       "Contract voided"
--     application_received (2)  "New applicant"
--     application_status (22)   "New inspector application"
--
--  A fraud alert and an opened dispute are exactly the "operational failure
--  requiring action" the control centre exists to surface, so this is the gap
--  that mattered most.
--
--  Kinds are matched FIRST and titles only as a fallback, so a renamed title
--  can no longer silently demote a critical alert.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_notification_severity(p_kind text, p_title text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- ── critical: money, safety, security, or something actively broken ──
    WHEN p_kind IN ('fraud_alert', 'security', 'system_alert', 'payment_exception')
      THEN 'critical'
    WHEN p_title ILIKE '%failed%' OR p_title ILIKE '%error%' OR p_title ILIKE '%anomaly%'
      THEN 'critical'

    -- ── action_required: the owner owes someone a decision ──
    WHEN p_kind IN ('job_created', 'source_job_created', 'job_moderated',
                    'dispute_opened', 'report_at_risk', 'contract_voided',
                    'moderation', 'verification', 'dispute', 'daily_brief')
      THEN 'action_required'
    WHEN p_title ILIKE '%review required%' OR p_title ILIKE '%awaiting%'
      OR p_title ILIKE '%needs%' OR p_title ILIKE '%requested%'
      OR p_title ILIKE '%overdue%' OR p_title ILIKE '%for moderation%'
      THEN 'action_required'

    -- ── operational: worth knowing today, no decision owed ──
    WHEN p_kind IN ('application_received', 'application_status', 'assignment',
                    'message', 'report', 'contract_assigned', 'agreement_presented',
                    'dispute_resolved_paid', 'rfq_quote_awarded', 'job_in_progress')
      THEN 'operational'
    WHEN p_title ILIKE '%registered%' OR p_title ILIKE '%submitted%'
      THEN 'operational'

    ELSE 'informational'
  END;
$$;

-- ── Owner-facing copy: real field names, not column names (§4) ────────────
--  Only the message body changes. The trigger keeps its swallow-all handler so
--  a signup can still never fail because an alert could not be built, and it
--  keeps skipping synthetic identities.
CREATE OR REPLACE FUNCTION public.tg_notify_admins_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_missing text;
  v_label   text;
BEGIN
  BEGIN
    -- Skip synthetic identities. Now shares ONE definition with the Telegram
    -- read models instead of repeating the regex, so the two cannot drift.
    IF public.nx_is_test_account(NEW.email) THEN
      RETURN NULL;
    END IF;
    IF COALESCE(NEW.role, '') IN ('admin', 'super_admin') THEN
      RETURN NULL;
    END IF;

    v_missing := public.nx_missing_fields_label(NEW.id);
    v_label   := COALESCE(NULLIF(btrim(NEW.full_name), ''), 'Unnamed');

    PERFORM public.nx_notify_admins(
      'New ' || public.nx_role_label(NEW.role) || ' registered',
      v_label || ' — ' || COALESCE(NEW.email, 'no email')
        || CASE WHEN v_missing IS NULL THEN ' · profile complete'
                ELSE ' · Missing: ' || v_missing END,
      'system',
      '/admin/users/' || NEW.id::text,
      NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- signup must never fail because an alert could not be delivered
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.nx_notification_severity(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_admins_new_user() FROM PUBLIC, anon, authenticated;
