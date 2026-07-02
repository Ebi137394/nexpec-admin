-- ============================================================================
--  20260801230000_audit_events_redact_and_lockdown.sql
--
--  RED TEAM P0 — audit_events raw-table leak (price-blindness + anti-poaching).
--
--  audit_capture() dumps changed `jobs` columns into audit_events.delta. Two
--  RLS policies (audit_events_select_parties, audit_events_select_scoped) let
--  the assigned inspector (contractor_id) and the client/agency read the RAW
--  table — i.e. un-redacted inspector_payout_cents, platform_spread_cents, AND
--  the inspector's identity (contractor_id/hired_inspector_id) BEFORE the
--  reveal boundary. Redaction existed only in the audit_events_public VIEW,
--  which non-admins bypassed by reading the table directly.
--
--  Fix:
--    1. Extend the redactor to also strip inspector-IDENTITY keys (anti-poaching).
--    2. Make audit_events_public a SECURITY DEFINER view (security_invoker=false)
--       that scopes rows internally (own-actor / job-party / org-member / admin)
--       and redacts — so non-admins get only their rows, fully redacted, without
--       touching the base table.
--    3. Drop the two leaky raw-table SELECT policies; keep admin-only SELECT +
--       own-actor INSERT. Admins still read the raw table (audit.ts); every
--       non-admin reader must use audit_events_public (client patch ships with
--       this change).
--
--  SAFE TO RE-RUN: CREATE OR REPLACE + DROP POLICY IF EXISTS; self-tested.
-- ============================================================================

BEGIN;

-- 1) Redactor: pricing (existing) + inspector identity (new). Recursive, any depth.
CREATE OR REPLACE FUNCTION public.audit_redact_pricing(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  deny text[] := ARRAY[
    -- pricing / margin
    'platform_spread_cents','platform_spread','platform_fee_cents',
    'platform_margin_cents','spread_cents','margin_cents','commission_cents',
    'inspector_payout_cents','inspector_payout',
    'contractor_payout_amount_cents','contractor_payout_cents','contractor_payout',
    'payout_amount_cents','payout_cents','client_price_cents',
    'budget_cents','budget_min_cents','budget_max_cents',
    -- inspector identity (pre-reveal anti-poaching): never expose to a non-admin
    -- reader via the audit trail.
    'inspector_id','contractor_id','hired_inspector_id','assigned_inspector_id',
    'applicant_id'
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
      IF k = ANY(deny) THEN
        CONTINUE;
      END IF;
      result := result || jsonb_build_object(k, public.audit_redact_pricing(v));
    END LOOP;
    RETURN result;
  WHEN 'array' THEN
    SELECT COALESCE(jsonb_agg(public.audit_redact_pricing(elem)), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(input) AS elem
     WHERE NOT (jsonb_typeof(elem) = 'string' AND (elem #>> '{}') = ANY(deny));
    RETURN result;
  ELSE
    RETURN input;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.audit_redact_pricing(jsonb) IS
  'Recursively strips inspector payout / platform spread / margin / client price / budget AND inspector-identity keys from a JSONB payload. Enforces price-blindness + anti-poaching for non-admin audit readers.';

-- 2) Non-admin view: SECURITY DEFINER + internal row scoping + redaction.
--    Replicates the scoping that the dropped table policies provided, so the
--    base table can be locked to admins only.
CREATE OR REPLACE VIEW public.audit_events_public WITH (security_invoker = false) AS
 SELECT
    id,
    created_at,
    event_type,
    severity,
    actor_id,
    actor_role,
    actor_label,
    subject_table,
    subject_id,
    job_id,
    summary,
    public.audit_redact_pricing(delta) AS delta,
    public.audit_redact_pricing(
      metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text]
    ) AS metadata,
    correlation_id
   FROM public.audit_events ae
  WHERE
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
    );

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin audit view. SECURITY DEFINER: scopes rows to own-actor / job-party / org-member / admin internally, and redacts pricing + inspector identity. Non-admins MUST read this view (the base audit_events table is admin-only). Admins read audit_events directly (un-redacted).';

-- 3) Lock the raw table to admins (+ own-actor INSERT). Drop the leaky reads.
DROP POLICY IF EXISTS audit_events_select_parties ON public.audit_events;
DROP POLICY IF EXISTS audit_events_select_scoped  ON public.audit_events;

-- ── Self-test ──────────────────────────────────────────────────────────────
DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='audit_events'
      AND policyname IN ('audit_events_select_parties','audit_events_select_scoped')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a leaky audit_events SELECT policy survives';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='audit_events' AND policyname='audit_events_select_admin'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin audit read policy missing';
  END IF;
  RAISE NOTICE 'audit_events locked to admin + redacted definer view (price-blind + identity-blind).';
END
$test$;

COMMIT;
