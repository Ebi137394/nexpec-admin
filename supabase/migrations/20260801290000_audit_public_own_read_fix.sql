-- ════════════════════════════════════════════════════════════════════════════
--  20260801290000_audit_public_own_read_fix.sql
--
--  BUG (pre-existing, regression from 20260801274000): non-admin users cannot
--  read ANY of their own audit rows.
--
--  ROOT CAUSE — two migrations contradict each other:
--    • 20260801230000 DROPPED the only non-admin SELECT policies on the raw
--      audit_events table (audit_events_select_parties / _select_scoped, which
--      carried `actor_id = auth.uid()`), deliberately forcing non-admins to read
--      through the redacted view. It made audit_events_public SECURITY DEFINER
--      (security_invoker=false) with an explicit own/job-party WHERE, so own-read
--      worked THROUGH the view.
--    • 20260801274000 then rewrote audit_events_public with
--      `security_invoker = true` and NO WHERE — on the (now false) assumption
--      that audit_events still had a non-admin `actor_id = auth.uid()` RLS
--      policy. Under invoker RLS the view inherits audit_events' ADMIN-ONLY
--      policy set, so a non-admin sees NOTHING — including their own rows. The
--      frontend (src/lib/audit.ts → non-admins query audit_events_public) shows
--      empty audit timelines as a result.
--
--  FIX: keep 274000's anti-poaching anonymization (inspector → nx_handle) and
--  price/PII redaction VERBATIM, but restore 230000's SECURITY DEFINER +
--  explicit own/job-party WHERE so the intended contract holds again:
--    • raw audit_events stays ADMIN-ONLY (unchanged; no policy added).
--    • non-admins read ONLY their own rows + rows for jobs they are a party to,
--      always redacted + anonymized (tenant isolation + price-blindness intact).
--    • no broad SELECT is opened anywhere.
--
--  Idempotent (CREATE OR REPLACE VIEW). Column set/order/types unchanged.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.audit_events_public WITH (security_invoker = false) AS
 SELECT
    id,
    created_at,
    event_type,
    severity,
    actor_id,
    actor_role,
    -- ★ Anti-poaching (from 274000): inspectors are pseudonymous to everyone but
    --   themselves; you always see your own real label.
    CASE
      WHEN actor_id = auth.uid()    THEN actor_label
      WHEN actor_role = 'inspector' THEN public.nx_handle(actor_id)
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
    -- 4th disjunct copied VERBATIM from 20260801230000 so the visible row-set is
    -- IDENTICAL to the intended 230000 view (org members see org-tagged rows).
    -- Omitting it would NARROW access below 230000 and break org-member audit reads.
    OR (
      (ae.metadata ->> 'org_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND public.is_member_of_org(((ae.metadata ->> 'org_id'))::uuid)
    );

ALTER VIEW public.audit_events_public OWNER TO postgres;

COMMENT ON VIEW public.audit_events_public IS
  'Non-admin facing view of audit_events. SECURITY DEFINER (security_invoker=false) with an explicit own/job-party WHERE — raw audit_events stays admin-only; non-admins read ONLY their own + job-party rows, redacted (payout/spread/margin stripped) and anonymized (inspector actors → nx_handle). Restores own-read broken by 20260801274000 while keeping its anonymization.';

-- Structural self-test: lock the fix so a future edit cannot silently re-break
-- non-admin own-read by flipping the view back to invoker RLS.
DO $test$
DECLARE v_opts text[];
BEGIN
  SELECT c.reloptions INTO v_opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'audit_events_public';
  IF v_opts IS NOT NULL AND 'security_invoker=true' = ANY (v_opts) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public must NOT be security_invoker=true (would inherit admin-only RLS and hide non-admin own rows)';
  END IF;
  IF position('auth.uid()' IN pg_get_viewdef('public.audit_events_public'::regclass)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: audit_events_public lost its own/job-party (auth.uid()) scoping';
  END IF;
  RAISE NOTICE 'audit_events_public own-read restored (SECDEF + own/job-party WHERE; anonymization + redaction preserved).';
END
$test$;

NOTIFY pgrst, 'reload schema';
