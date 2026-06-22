-- ════════════════════════════════════════════════════════════════════════════
-- 20260801154000_audit_public_price_blind.sql
-- Server-side price-blindness for the public audit trail (anti-poaching).
--
-- The non-admin audit trail (mobile + web) reads `public.audit_events_public`.
-- That view previously passed `delta` through verbatim, leaking
-- platform_spread_cents / inspector_payout_cents / contractor_payout_amount_cents
-- to the CLIENT in both the structured diff and the raw payload. This migration
-- redacts those fields (and related margin/payout aliases) IN THE DATABASE, so
-- the sensitive bytes never leave the server for a non-admin reader.
--
-- Admins are unaffected: admin surfaces read the base table `public.audit_events`
-- directly (RLS-gated to admins). This view is the non-admin path only, so the
-- redaction can be unconditional here without touching admin visibility.
-- Idempotent: CREATE OR REPLACE for both the function and the view.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Pure, recursive JSONB redactor. Removes deny-listed keys at ANY depth and
--    drops deny-listed field-name strings from arrays (e.g. metadata.changed_keys).
--    Mirrors the client-side guard (isSensitivePricingField in src/lib/audit.ts).
CREATE OR REPLACE FUNCTION public.audit_redact_pricing(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  deny text[] := ARRAY[
    'platform_spread_cents','platform_spread','platform_fee_cents',
    'platform_margin_cents','spread_cents','margin_cents','commission_cents',
    'inspector_payout_cents','inspector_payout',
    'contractor_payout_amount_cents','contractor_payout_cents','contractor_payout',
    'payout_amount_cents','payout_cents'
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
        CONTINUE;  -- strip sensitive key
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
    RETURN input;  -- scalar (string/number/bool) — pass through
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.audit_redact_pricing(jsonb) IS
  'Recursively strips inspector-payout / platform-spread / margin fields from a JSONB payload. Used by audit_events_public to enforce price-blindness for non-admin readers (anti-poaching).';

-- 2) Recreate the non-admin view with BOTH delta and metadata redacted.
--    Preserves: column set/order/types (required by CREATE OR REPLACE VIEW),
--    security_invoker (caller RLS still applies), and the pre-existing
--    admin-only metadata masking (ip/ua/ai_label/admin_notes).
CREATE OR REPLACE VIEW public.audit_events_public WITH (security_invoker = true) AS
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
   FROM public.audit_events;

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin facing view of audit_events. RLS inherited from base table (security_invoker). Metadata masking strips ip/ua/ai_label/admin_notes; delta + metadata are additionally redacted of platform_spread / inspector_payout / contractor_payout (+ margin/commission aliases) for price-blindness. Admins read audit_events directly.';
