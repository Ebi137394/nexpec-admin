-- ════════════════════════════════════════════════════════════════════════════
--  20260801294000_audit_public_actor_anonymity_and_internal_fields.sql
--
--  SECURITY / PRIVACY BUG (second wave) — the client-facing audit trail exposes
--  (1) the platform Admin's real identity and (2) raw internal job columns.
--
--  REPRODUCTION (mobile Client portal, job "Pressure"):
--    • job.updated  → ACTOR renders "Ebrahim Feyzi, super_admin", the summary
--      reads "Job fields updated: moderation_reviewed_at, moderation_reviewed_by,
--      moderation_status", and the diff shows the admin's raw UUID in
--      moderation_reviewed_by.
--    • jobs.created → "CHANGES 64": client_id, agency_id, payout_status,
--      escrow_status, moderation_*, and every other internal jobs column.
--
--  WHY 20260801292000 DID NOT COVER THIS: that migration scoped its guard and
--  its redactor to the admin↔inspector NEGOTIATION channel on subject_table
--  'applications'. These events are subject_table 'jobs', and the leaking
--  columns are moderation / operational / financial-state columns plus the
--  actor identity — none of which were in scope there.
--
--  ROOT CAUSES (three distinct defects):
--    1. ACTOR IDENTITY. audit_events_public pseudonymises ONLY inspectors
--       (actor_role='inspector' → nx_handle). Admin and super_admin actors fall
--       through the ELSE branch, so their REAL NAME and ROLE are published to
--       every job party. Worse, the raw `actor_id` column was projected
--       unmasked for ALL actors — so even the inspector pseudonymisation was
--       undone by the accompanying UUID.
--    2. WHOLE-ROW DELTA. public.audit_capture() writes to_jsonb(NEW) on INSERT,
--       so a jobs INSERT emits all 76 columns; UPDATE emits every changed key.
--       audit_redact_pricing strips only payout/spread/margin, and 292000's
--       audit_redact_internal only knew about admin_*/negotiation keys — so
--       moderation_*, escrow_status, payout_status, and every *_id / *_by
--       identifier were published verbatim.
--    3. SUMMARY TEXT. The trigger builds 'Job fields updated: ' ||
--       array_to_string(v_changed_keys, ', '), leaking internal COLUMN NAMES in
--       the event title even when the diff itself is redacted.
--
--  FIX (all inside the non-admin projection; the trigger, the raw table and
--  every RLS policy are untouched):
--    A. Admin actors are published as the platform: actor_label → 'NEXPEC',
--       actor_role → 'platform'. actor_id is masked to NULL for every actor
--       that is not the viewer themselves (closing the pseudonym bypass).
--    B. audit_redact_internal is extended from an admin_*/negotiation list to
--       category rules that survive schema growth: any *_id / *_by identifier,
--       any moderation_*/admin_*/internal_* key, the operational + financial
--       state columns, and — belt and braces — ANY value that is UUID-shaped,
--       whatever its column is called.
--    C. Non-buyers additionally lose buyer-price fields (audit_redact_buyer_
--       pricing): the existing price-blindness stops a buyer seeing inspector
--       pay; this stops the mirror leak (an inspector deriving margin from the
--       client price). The job's own client/agency still see their own numbers.
--    D. Summaries are neutralised for non-admins (column-name lists and raw
--       UUIDs removed; a price summary is generalised for non-buyers).
--    E. An event whose diff was non-empty but became EMPTY after redaction is
--       hidden entirely — so a purely-internal event (e.g. the moderation
--       approval above) no longer renders as a contentless card attributed to
--       the platform. Events with a legitimately empty delta are unaffected.
--
--  Everything from 20260801290000 (SECURITY DEFINER + own/job-party WHERE,
--  inspector anonymisation) and 20260801292000 (applications forward gate) is
--  preserved verbatim. Idempotent (CREATE OR REPLACE) + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Extended internal-field redactor ─────────────────────────────────────
--  Category rules, not a column list: the leak we are fixing was caused by a
--  hardcoded list that could not know about columns added later.
CREATE OR REPLACE FUNCTION public.audit_redact_internal(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- exact keys: internal operational / financial / moderation state
  deny text[] := ARRAY[
    -- admin↔inspector negotiation channel (from 20260801292000)
    'negotiation_status',
    'inspector_decision', 'inspector_decision_note', 'inspector_decision_at',
    'client_notes', 'client_note', 'client_feedback',
    -- moderation / back-office review
    'moderation_status', 'moderation_notes',
    -- financial + payout operational state (NOT amounts — those are handled by
    -- audit_redact_pricing / audit_redact_buyer_pricing)
    'payout_status', 'escrow_status', 'payout_reference', 'payout_notes',
    'payout_paid_at', 'payment_mode', 'client_invoiced_at', 'client_settled_at',
    -- internal ops / plumbing
    'deleted_at', 'geog', 'template_url', 'calendar_synced_at',
    'is_senior_review', 'claimed_address_geocoded', 'admin_confirmed_at'
  ];
  result jsonb;
  k text;
  v jsonb;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  CASE jsonb_typeof(input)
  WHEN 'object' THEN
    result := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(input) LOOP
      -- (a) exact deny list
      IF k = ANY(deny) THEN CONTINUE; END IF;
      -- (b) category prefixes: back-office namespaces
      IF k LIKE 'admin\_%' OR k LIKE 'internal\_%' OR k LIKE 'moderation\_%' THEN CONTINUE; END IF;
      -- (c) identifier suffixes: every FK / actor reference (client_id,
      --     agency_id, contractor_id, moderation_reviewed_by, cancelled_by, …)
      IF k LIKE '%\_id' OR k LIKE '%\_by' THEN CONTINUE; END IF;
      -- (d) value-shaped guard: a UUID is an internal identifier no matter what
      --     the column is called (catches 'id' and any future alias)
      IF jsonb_typeof(v) = 'string' AND (v #>> '{}') ~* c_uuid THEN CONTINUE; END IF;
      result := result || jsonb_build_object(k, public.audit_redact_internal(v));
    END LOOP;
    RETURN result;
  WHEN 'array' THEN
    -- also drop field-NAME strings (e.g. metadata.changed_keys) so the internal
    -- column names never leak as a list either
    SELECT COALESCE(jsonb_agg(public.audit_redact_internal(elem)), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(input) AS elem
     WHERE NOT (
       jsonb_typeof(elem) = 'string'
       AND (
         (elem #>> '{}') = ANY(deny)
         OR (elem #>> '{}') LIKE 'admin\_%'
         OR (elem #>> '{}') LIKE 'internal\_%'
         OR (elem #>> '{}') LIKE 'moderation\_%'
         OR (elem #>> '{}') LIKE '%\_id'
         OR (elem #>> '{}') LIKE '%\_by'
         OR (elem #>> '{}') ~* c_uuid
       )
     );
    RETURN result;
  ELSE
    RETURN input;  -- scalar — pass through
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.audit_redact_internal(jsonb) IS
  'Recursively strips internal fields from a JSONB audit payload: the admin/inspector negotiation channel, moderation_*, admin_*, internal_*, every *_id / *_by identifier, operational + financial state columns, and any UUID-shaped value regardless of key name. Category-based so new columns are protected by default. Used by audit_events_public.';

-- ── 2) Buyer-price redactor (mirror of price-blindness) ─────────────────────
--  audit_redact_pricing stops a BUYER seeing inspector pay / platform margin.
--  This stops the mirror: a non-buyer (e.g. an inspector) deriving the margin
--  from the client-side price. The job's own client/agency are exempt.
CREATE OR REPLACE FUNCTION public.audit_redact_buyer_pricing(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  deny text[] := ARRAY[
    'client_price_cents', 'price_cents',
    'budget_cents', 'budget_min_cents', 'budget_max_cents', 'budget_type',
    'bid_amount_cents', 'proposed_price_cents',
    'total_amount_cents', 'amount_cents'
  ];
  result jsonb;
  k text;
  v jsonb;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;

  CASE jsonb_typeof(input)
  WHEN 'object' THEN
    result := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(input) LOOP
      IF k = ANY(deny) THEN CONTINUE; END IF;
      result := result || jsonb_build_object(k, public.audit_redact_buyer_pricing(v));
    END LOOP;
    RETURN result;
  WHEN 'array' THEN
    SELECT COALESCE(jsonb_agg(public.audit_redact_buyer_pricing(elem)), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(input) AS elem
     WHERE NOT (jsonb_typeof(elem) = 'string' AND (elem #>> '{}') = ANY(deny));
    RETURN result;
  ELSE
    RETURN input;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.audit_redact_buyer_pricing(jsonb) IS
  'Strips buyer-side price fields (client price / budget / bid) from a JSONB audit payload. Applied to non-buyer readers so the platform margin cannot be derived from the client price — the mirror of audit_redact_pricing.';

-- ── 3) Visible-key counter (used to hide fully-redacted events) ─────────────
CREATE OR REPLACE FUNCTION public.audit_delta_keys(input jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN input IS NULL OR jsonb_typeof(input) <> 'object' THEN 0
    WHEN input ? 'before' OR input ? 'after' THEN
      COALESCE((SELECT count(*) FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(input->'before') = 'object' THEN input->'before' ELSE '{}'::jsonb END)), 0)
      + COALESCE((SELECT count(*) FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(input->'after') = 'object' THEN input->'after' ELSE '{}'::jsonb END)), 0)
    ELSE COALESCE((SELECT count(*) FROM jsonb_object_keys(input)), 0)
  END::integer;
$$;

COMMENT ON FUNCTION public.audit_delta_keys(jsonb) IS
  'Counts the visible field keys in an audit delta (before + after, or a flat payload). Used by audit_events_public to hide events whose entire diff was redacted away.';

-- ── 4) Summary sanitiser ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_public_summary(p_summary text, p_is_buyer boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_summary IS NULL THEN NULL
    -- the trigger appends the raw changed COLUMN NAMES — never publish those
    WHEN p_summary ~* '^Job fields updated:' THEN 'Job details updated'
    -- a client-price summary is the buyer's own number; generalise for others
    WHEN p_summary ~* '^Client price:' AND NOT COALESCE(p_is_buyer, false) THEN 'Pricing updated'
    ELSE regexp_replace(
           p_summary,
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
           '', 'gi')   -- strip any raw UUID embedded in free text
  END;
$$;

COMMENT ON FUNCTION public.audit_public_summary(text, boolean) IS
  'Neutralises an audit summary for non-admin readers: removes the raw changed-column list the trigger appends, generalises a client-price summary for non-buyers, and strips embedded UUIDs.';

-- ── 5) The non-admin view ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.audit_events_public WITH (security_invoker = false) AS
 SELECT
    ae.id,
    ae.created_at,
    ae.event_type,
    ae.severity,
    -- ★ actor_id is an internal identifier: publish it only to admins and to the
    --   actor themselves. (Previously raw for everyone, which handed out the
    --   real UUID next to the nx_handle pseudonym.)
    CASE
      WHEN public.nx_is_admin()     THEN ae.actor_id
      WHEN ae.actor_id = auth.uid() THEN ae.actor_id
      ELSE NULL
    END AS actor_id,
    -- ★ the platform Admin is never named or role-labelled to a non-admin
    CASE
      WHEN public.nx_is_admin()                      THEN ae.actor_role
      WHEN ae.actor_id = auth.uid()                  THEN ae.actor_role
      WHEN ae.actor_role IN ('admin', 'super_admin') THEN 'platform'
      ELSE ae.actor_role
    END AS actor_role,
    CASE
      WHEN public.nx_is_admin()                      THEN ae.actor_label
      WHEN ae.actor_id = auth.uid()                  THEN ae.actor_label
      WHEN ae.actor_role IN ('admin', 'super_admin') THEN 'NEXPEC'
      -- Anti-poaching (from 274000): inspectors stay pseudonymous.
      WHEN ae.actor_role = 'inspector'               THEN public.nx_handle(ae.actor_id)
      ELSE ae.actor_label
    END AS actor_label,
    ae.subject_table,
    ae.subject_id,
    ae.job_id,
    CASE
      WHEN public.nx_is_admin() THEN ae.summary
      ELSE public.audit_public_summary(ae.summary, b.is_buyer)
    END AS summary,
    CASE
      WHEN public.nx_is_admin() THEN public.audit_redact_pricing(ae.delta)
      WHEN b.is_buyer           THEN public.audit_redact_internal(public.audit_redact_pricing(ae.delta))
      ELSE public.audit_redact_buyer_pricing(
             public.audit_redact_internal(public.audit_redact_pricing(ae.delta)))
    END AS delta,
    CASE
      WHEN public.nx_is_admin() THEN public.audit_redact_pricing(
             ae.metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text])
      WHEN b.is_buyer           THEN public.audit_redact_internal(public.audit_redact_pricing(
             ae.metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text]))
      ELSE public.audit_redact_buyer_pricing(public.audit_redact_internal(public.audit_redact_pricing(
             ae.metadata - ARRAY['ip'::text, 'ua'::text, 'ai_label'::text, 'admin_notes'::text])))
    END AS metadata,
    ae.correlation_id
   FROM public.audit_events ae
   -- computed once per row and reused by summary/delta/metadata + the WHERE
   LEFT JOIN LATERAL (
     SELECT EXISTS (
       SELECT 1 FROM public.jobs j
        WHERE j.id = ae.job_id
          AND (j.client_id = auth.uid() OR j.agency_id = auth.uid())
     ) AS is_buyer
   ) b ON true
  WHERE
    (
      -- ── access disjuncts, preserved verbatim from 20260801290000 ──
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
      -- ── applications forward gate, preserved verbatim from 20260801292000 ──
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
    )
    AND (
      -- ★ hide events whose ENTIRE diff was internal. An event that legitimately
      --   carries no delta (RPC-emitted markers) is untouched — only a diff that
      --   HAD content and lost all of it is suppressed.
      public.nx_is_admin()
      OR public.audit_delta_keys(ae.delta) = 0
      OR public.audit_delta_keys(
           CASE
             WHEN b.is_buyer THEN public.audit_redact_internal(public.audit_redact_pricing(ae.delta))
             ELSE public.audit_redact_buyer_pricing(
                    public.audit_redact_internal(public.audit_redact_pricing(ae.delta)))
           END
         ) > 0
    );

ALTER VIEW public.audit_events_public OWNER TO postgres;

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin facing view of audit_events. SECURITY DEFINER with an explicit own/job-party WHERE — raw audit_events stays admin-only. Admin actors are published as NEXPEC/platform and actor_id is masked to all but the actor; inspectors stay pseudonymous (nx_handle). Deltas/metadata are redacted of payout+margin, buyer price (non-buyers), and all internal fields (moderation_*, admin_*, *_id, *_by, operational/financial state, UUID-shaped values). Summaries are neutralised. Application events obey the 20260801272000 forward gate, and fully-redacted events are hidden.';

-- ── 6) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_opts text[];
  v_def  text;
  v_in   jsonb;
BEGIN
  SELECT c.reloptions INTO v_opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'audit_events_public';
  IF v_opts IS NOT NULL AND 'security_invoker=true' = ANY (v_opts) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public must NOT be security_invoker=true';
  END IF;

  v_def := pg_get_viewdef('public.audit_events_public'::regclass);
  IF position('auth.uid()' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: lost own/job-party scoping';
  END IF;
  IF position('forwarded_to_client_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: lost the application forward gate (20260801292000)';
  END IF;
  IF position('audit_redact_pricing' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: lost price-blindness redaction';
  END IF;
  IF position('nx_handle' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: lost inspector anonymisation (20260801274000)';
  END IF;
  IF position('NEXPEC' IN v_def) = 0 OR position('platform' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin actor anonymisation not present';
  END IF;

  -- behavioural: the exact leak reported on job.updated / jobs.created
  v_in := jsonb_build_object(
    'before', jsonb_build_object('moderation_status','pending_review'),
    'after',  jsonb_build_object(
      'moderation_status','approved',
      'moderation_reviewed_at','2026-07-09T23:22:00Z',
      'moderation_reviewed_by','efa609bf-57c2-4b65-a284-62178599b305',
      'client_id','de4c2c67-7a74-430e-aa86-880c912e1d3c',
      'agency_id', NULL,
      'payout_status','unpaid',
      'escrow_status','pending',
      'status','pending_approval',
      'title','Pressure'
    ));
  IF public.audit_redact_internal(v_in) <> jsonb_build_object(
       'before', '{}'::jsonb,
       'after',  jsonb_build_object('status','pending_approval','title','Pressure')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: internal job fields survived redaction: %',
      public.audit_redact_internal(v_in);
  END IF;

  -- the moderation-only event must collapse to nothing (→ hidden by the view)
  IF public.audit_delta_keys(public.audit_redact_internal(jsonb_build_object(
       'before', jsonb_build_object('moderation_status','pending_review'),
       'after',  jsonb_build_object(
         'moderation_status','approved',
         'moderation_reviewed_at','2026-07-09T23:22:00Z',
         'moderation_reviewed_by','efa609bf-57c2-4b65-a284-62178599b305')))) <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a moderation-only event still has visible content';
  END IF;

  -- summary must not publish internal column names, and must drop raw UUIDs
  IF public.audit_public_summary(
       'Job fields updated: moderation_reviewed_at, moderation_reviewed_by, moderation_status', true)
     <> 'Job details updated' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: summary still lists internal column names';
  END IF;
  IF public.audit_public_summary('Assigned efa609bf-57c2-4b65-a284-62178599b305', true) ~*
     '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: summary still embeds a raw UUID';
  END IF;

  -- buyer keeps their own price; non-buyer does not
  IF public.audit_redact_buyer_pricing(jsonb_build_object('client_price_cents', 50000))
     <> '{}'::jsonb THEN
    RAISE EXCEPTION 'SELFTEST FAILED: buyer-price redaction did not strip client_price_cents';
  END IF;
  IF public.audit_redact_internal(jsonb_build_object('client_price_cents', 50000))
     <> jsonb_build_object('client_price_cents', 50000) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the buyer lost their own client_price_cents';
  END IF;

  RAISE NOTICE 'audit_events_public hardened: admin actors anonymised (NEXPEC/platform), actor_id masked, internal job fields + identifiers redacted, summaries neutralised, fully-internal events hidden.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
