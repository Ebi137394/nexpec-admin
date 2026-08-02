-- ════════════════════════════════════════════════════════════════════════════
--  20260801292000_audit_public_application_gate_and_internal_redaction.sql
--
--  SECURITY / PRIVACY BUG — the audit trail bypasses the application forward
--  gate AND leaks the internal admin↔inspector negotiation channel to clients.
--
--  REPRODUCTION (reported from the mobile Client portal, job "Pressure"):
--    Client → Job Details → "Activity & Audit Trail" → tap "Application
--    submitted" → the diff sheet renders 35 changes, including admin_comment,
--    admin_attachment, admin_feedback, admin_counter_cents, admin_countered_at,
--    admin_countered_by, negotiation_status and inspector_decision* — for an
--    application the admin had NOT yet forwarded to that client.
--
--  ROOT CAUSE — three independent facts compose into the leak:
--    1. public.audit_capture() (baseline trigger on public.applications) writes
--       delta = jsonb_build_object('after', to_jsonb(NEW)) on INSERT — i.e. the
--       ENTIRE applications row, all ~36 columns, admin columns included. On
--       UPDATE it writes the changed keys, so an admin counter-offer lands in
--       the delta as admin_counter_cents / admin_comment / admin_countered_at.
--    2. public.audit_events_public (20260801290000) authorises ANY job party —
--       "j.client_id = auth.uid() OR j.contractor_id … OR j.agency_id …" — to
--       read EVERY audit row carrying that job_id, with NO awareness of
--       applications.forwarded_to_client_at. 20260801272000 deliberately gated
--       client visibility of applications behind that admin "Forward to Client"
--       stamp AT THE RLS LAYER, but the audit view reaches the same bytes by a
--       different path, so the gate is bypassed wholesale.
--    3. public.audit_redact_pricing() only strips a payout/spread/margin
--       deny-list. Every admin_* / negotiation column passes through untouched.
--
--  IMPACT (all pre-fix):
--    • A client sees an application — and its full contents — BEFORE the admin
--      forwards it, defeating 20260801272000 (workflow bypass).
--    • A client sees the admin's counter-offer amount (admin_counter_cents)
--      against the inspector's bid → the platform margin is derivable
--      (anti-poaching / price-blindness violation).
--    • A client sees admin-internal vetting prose (admin_comment,
--      admin_feedback, admin_attachment) never intended to leave the back office.
--    • A HIRED inspector (j.contractor_id) sees COMPETING applicants' full rows
--      for the same job.
--
--  FIX — two changes, both inside audit_events_public (the single non-admin read
--  path; raw audit_events remains admin-only and is left untouched):
--    A. FORWARD-GATE PARITY. An 'applications'-subject event is visible to a
--       non-admin only if they are the applicant, or they are the job's
--       client/agency AND that application carries forwarded_to_client_at.
--       Applied as an AND-guard on top of the existing disjuncts, so every other
--       access path (own rows, job-party rows for jobs/contracts/payouts, org
--       members) is preserved byte-for-byte — this migration can only REMOVE
--       application-event visibility that bypassed the gate, never widen access.
--    B. INTERNAL-FIELD REDACTION. New public.audit_redact_internal(jsonb)
--       recursively strips the internal negotiation channel (any admin_* key,
--       negotiation_status, inspector_decision*, forwarded_to_client_by, and the
--       counterparty-private client note/feedback fields) from delta + metadata
--       for non-admin readers. Admin reads through the view are unchanged.
--
--  Nothing about the trigger, the raw table, or any RLS policy changes; this is
--  purely the non-admin projection. Idempotent (CREATE OR REPLACE) + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── A) Internal-negotiation redactor ────────────────────────────────────────
--  Sibling of audit_redact_pricing. Prefix-matched on 'admin_' so a future
--  admin_* column on applications is protected the day it is added, without a
--  code change (the failure mode we are fixing was exactly a hardcoded list
--  that did not know about these columns).
CREATE OR REPLACE FUNCTION public.audit_redact_internal(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  deny text[] := ARRAY[
    -- admin↔inspector negotiation channel
    'negotiation_status',
    'inspector_decision', 'inspector_decision_note', 'inspector_decision_at',
    -- which admin released the application (back-office identity)
    'forwarded_to_client_by',
    -- counterparty-private notes: the buyer's private notes must not reach the
    -- inspector via their own audit timeline, and vice versa
    'client_notes', 'client_note', 'client_feedback'
  ];
  result jsonb;
  k text;
  v jsonb;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  CASE jsonb_typeof(input)
  WHEN 'object' THEN
    result := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(input) LOOP
      -- prefix rule: every admin_* / internal_* key is back-office only
      IF k = ANY(deny) OR k LIKE 'admin\_%' OR k LIKE 'internal\_%' THEN
        CONTINUE;
      END IF;
      result := result || jsonb_build_object(k, public.audit_redact_internal(v));
    END LOOP;
    RETURN result;
  WHEN 'array' THEN
    SELECT COALESCE(jsonb_agg(public.audit_redact_internal(elem)), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(input) AS elem
     WHERE NOT (
       jsonb_typeof(elem) = 'string'
       AND (
         (elem #>> '{}') = ANY(deny)
         OR (elem #>> '{}') LIKE 'admin\_%'
         OR (elem #>> '{}') LIKE 'internal\_%'
       )
     );
    RETURN result;
  ELSE
    RETURN input;  -- scalar — pass through
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.audit_redact_internal(jsonb) IS
  'Recursively strips the internal admin/inspector negotiation channel (any admin_* or internal_* key, negotiation_status, inspector_decision*, forwarded_to_client_by, and counterparty-private client note/feedback fields) from a JSONB audit payload. Used by audit_events_public so back-office negotiation state never reaches a client/inspector audit timeline.';

-- ── B) Non-admin view: forward-gate parity + internal redaction ──────────────
--  Everything from 20260801290000 is preserved verbatim (SECURITY DEFINER,
--  inspector anonymisation, pricing redaction, metadata masking, and all four
--  access disjuncts). Added: the applications AND-guard, and the non-admin
--  internal redaction wrapper.
CREATE OR REPLACE VIEW public.audit_events_public WITH (security_invoker = false) AS
 SELECT
    id,
    created_at,
    event_type,
    severity,
    actor_id,
    actor_role,
    -- Anti-poaching (from 274000): inspectors are pseudonymous to everyone but
    -- themselves; you always see your own real label.
    CASE
      WHEN actor_id = auth.uid()    THEN actor_label
      WHEN actor_role = 'inspector' THEN public.nx_handle(actor_id)
      ELSE actor_label
    END AS actor_label,
    subject_table,
    subject_id,
    job_id,
    summary,
    -- Pricing redaction unchanged for every reader; internal-negotiation
    -- redaction added for non-admins only (admin reads keep full fidelity).
    CASE
      WHEN public.nx_is_admin() THEN public.audit_redact_pricing(delta)
      ELSE public.audit_redact_internal(public.audit_redact_pricing(delta))
    END AS delta,
    CASE
      WHEN public.nx_is_admin() THEN public.audit_redact_pricing(
             metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text]
           )
      ELSE public.audit_redact_internal(public.audit_redact_pricing(
             metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text]
           ))
    END AS metadata,
    correlation_id
   FROM public.audit_events ae
  WHERE
    (
      -- ── existing access disjuncts, preserved verbatim from 20260801290000 ──
      public.nx_is_admin()
      OR ae.actor_id = auth.uid()
      OR (
        ae.job_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.id = ae.job_id
            AND (j.client_id = auth.uid() OR j.contractor_id = auth.uid() OR j.agency_id = auth.uid())
        )
      )
      OR (
        (ae.metadata ->> 'org_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_member_of_org(((ae.metadata ->> 'org_id'))::uuid)
      )
    )
    AND (
      -- ★ FORWARD-GATE PARITY (this migration). Application events obey the same
      --   visibility rule as the applications table itself (20260801272000):
      --   the applicant always sees their own; the buyer only after the admin
      --   stamped forwarded_to_client_at; nobody else (which also stops a hired
      --   contractor from reading competing applicants' rows). Fail-closed: a
      --   deleted/unknown application is invisible to non-admins.
      ae.subject_table <> 'applications'
      OR public.nx_is_admin()
      OR EXISTS (
        SELECT 1
          FROM public.applications a
         WHERE a.id = ae.subject_id
           AND (
             a.applicant_id = auth.uid()
             OR (
               a.forwarded_to_client_at IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM public.jobs j
                  WHERE j.id = a.job_id
                    AND (j.client_id = auth.uid() OR j.agency_id = auth.uid())
               )
             )
           )
      )
    );

ALTER VIEW public.audit_events_public OWNER TO postgres;

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin facing view of audit_events. SECURITY DEFINER (security_invoker=false) with an explicit own/job-party WHERE — raw audit_events stays admin-only. Non-admins read ONLY their own + job-party rows, redacted (payout/spread/margin AND internal admin/negotiation fields stripped) and anonymized (inspector actors → nx_handle). Application-subject events additionally obey the 20260801272000 forward gate: the applicant sees their own, the buyer only after admin forwarding.';

-- ── C) Self-tests — lock every property this migration establishes ───────────
DO $test$
DECLARE
  v_opts text[];
  v_def  text;
BEGIN
  -- (a) must stay SECURITY DEFINER (invoker RLS would hide non-admin own rows —
  --     the 20260801290000 regression). Re-asserted so we cannot undo that fix.
  SELECT c.reloptions INTO v_opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'audit_events_public';
  IF v_opts IS NOT NULL AND 'security_invoker=true' = ANY (v_opts) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public must NOT be security_invoker=true';
  END IF;

  v_def := pg_get_viewdef('public.audit_events_public'::regclass);

  -- (b) own/job-party scoping still present (no broad SELECT opened)
  IF position('auth.uid()' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public lost its own/job-party scoping';
  END IF;

  -- (c) the forward gate is actually wired into the audit projection
  IF position('forwarded_to_client_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public does not enforce the application forward gate';
  END IF;

  -- (d) internal-negotiation redaction is applied
  IF position('audit_redact_internal' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public does not redact internal admin/negotiation fields';
  END IF;

  -- (e) price-blindness preserved
  IF position('audit_redact_pricing' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public lost price-blindness redaction';
  END IF;

  -- (f) the redactor really drops the reported columns (behavioural, not textual)
  IF public.audit_redact_internal(jsonb_build_object(
       'after', jsonb_build_object(
         'status','pending',
         'admin_comment','internal vetting note',
         'admin_attachment','s3://internal/doc.pdf',
         'admin_feedback','internal feedback',
         'admin_counter_cents', 123456,
         'admin_countered_at','2026-07-10T00:57:00Z',
         'admin_countered_by','00000000-0000-0000-0000-000000000001',
         'negotiation_status','admin_countered',
         'inspector_decision','accepted'
       )
     )) <> jsonb_build_object('after', jsonb_build_object('status','pending')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_redact_internal did not strip the internal negotiation fields';
  END IF;

  RAISE NOTICE 'audit_events_public hardened: application forward-gate parity + internal-negotiation redaction (pricing redaction, anonymisation and own-read preserved).';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
