-- ════════════════════════════════════════════════════════════════════════════
--  20260801274000_audit_public_anonymize_inspector.sql
--
--  ISSUE 2 (identity leak): the client's "Activity & Audit Trail" showed the
--  inspector's REAL name (e.g. "Test Inspector (Live)") in plain text, breaking
--  anti-poaching pseudonymity. The non-admin audit view audit_events_public
--  passed actor_label through verbatim.
--
--  FIX — anonymize the actor IN THE DATABASE so the real name never leaves the
--  server for a non-admin reader: for actors whose role is 'inspector', emit the
--  deterministic NX pseudonym (public.nx_handle(actor_id)) instead of the real
--  actor_label. Callers still see their OWN name (actor_id = auth.uid()); every
--  other role's label is unchanged. Admins are unaffected — admin surfaces read
--  the base table audit_events directly. This fixes the leak for EVERY non-admin
--  surface at once (mobile + web) with no frontend change.
--
--  Preserves the price-blind delta/metadata redaction (migration 154000), the
--  column set/order/types, and security_invoker (caller RLS still applies).
--  Idempotent (CREATE OR REPLACE VIEW); self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE VIEW public.audit_events_public WITH (security_invoker = true) AS
 SELECT
    id,
    created_at,
    event_type,
    severity,
    actor_id,
    actor_role,
    -- ★ Anti-poaching: inspectors are pseudonymous to everyone but themselves.
    CASE
      WHEN actor_id = auth.uid()        THEN actor_label               -- your own actions: real label
      WHEN actor_role = 'inspector'     THEN public.nx_handle(actor_id) -- inspectors → NX pseudonym
      ELSE actor_label
    END AS actor_label,
    subject_table,
    subject_id,
    job_id,
    summary,
    public.audit_redact_pricing(delta) AS delta,
    public.audit_redact_pricing(
      metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text]
    ) AS metadata,
    correlation_id
   FROM public.audit_events;

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin facing view of audit_events. RLS inherited (security_invoker). Inspector actors are shown as their NX pseudonym (nx_handle) to everyone but themselves (anti-poaching); metadata masks ip/ua/ai_label/admin_notes; delta+metadata redacted of payout/spread/margin (price-blindness). Admins read audit_events directly.';

-- Self-test: the view definition must pseudonymize inspector actors via nx_handle
-- while preserving the price-blind redactor.
DO $test$
DECLARE v_def text;
BEGIN
  v_def := pg_get_viewdef('public.audit_events_public'::regclass, true);
  IF position('nx_handle' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public does not pseudonymize the actor (nx_handle missing)';
  END IF;
  IF position('inspector' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public actor CASE missing the inspector branch';
  END IF;
  IF position('audit_redact_pricing' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public dropped the price-blind redaction (154000 regression)';
  END IF;
  RAISE NOTICE 'audit anonymization LIVE: inspector actors render as NX pseudonym for non-admin readers.';
END
$test$;

COMMIT;
