-- ════════════════════════════════════════════════════════════════════════════
--  20260801146000_god_mode_rls_admin_overlays.sql
--
--  GOD-MODE RLS SWEEP — non-financial surface.
--
--  Rule: ONE admin role (ebi) = 100% access. The canonical helper is
--  public.nx_is_admin() (profiles.role IN ('admin','super_admin'), search-path
--  locked). A census of the 127 RLS-enabled tables found 60 whose policies had
--  NO admin branch at all — admin was silently excluded. This closes that gap
--  with ADDITIVE permissive overlay policies (PERMISSIVE policies OR together,
--  so non-admin access is UNCHANGED — we never rewrite an existing expression).
--
--  Two tiers:
--    • _admin_all  (FOR ALL)    — operational tables admin owns/moderates.
--    • _admin_read (FOR SELECT) — audit logs, provenance seals, personal
--      secrets, and consent records: god-mode VISIBILITY without the ability to
--      tamper. Even ebi must not rewrite an audit trail or a report seal
--      (consistent with audit_events append-only, migration 143000), and
--      writes to secrets/consents stay owner-only.
--
--  DELIBERATELY EXCLUDED (admin reaches these via SECURITY DEFINER RPCs /
--  service_role, or they must stay owner-only):
--    • Money / price-blind: transactions, invoices, job_expenses, withdrawals,
--      payout_requests, payments  (preserve the Phase 4 lockdown exactly).
--    • Auth secrets: auth_recovery_codes (MFA/recovery — owner only).
--    • Public reference: country_codes, fx_rates, fx_refresh_runs, courses,
--      knowledge_base, legal_documents (SELECT already open; writes via service).
--    • Legacy RBAC: user_roles (profiles.role is the source of truth).
--    • Service-only (no policy by design): _app_config, ai_analysis_queue,
--      escrow_logs, stripe_webhook_events.
--
--  Idempotent (DROP POLICY IF EXISTS + CREATE), guarded by to_regclass so a
--  missing table is skipped rather than erroring. Adding the overlay does NOT
--  enable RLS where it was off (all targets already have RLS ON) and does NOT
--  alter grants.
--
--  NOTE (out of scope, flagged): public.inspection_items has RLS ON but ZERO
--  policies, yet is read client-side (app/inspector/seal-report.tsx) — it
--  currently returns no rows for non-service callers. That is a separate domain
--  RLS bug; here it only receives the admin-read overlay.
-- ════════════════════════════════════════════════════════════════════════════

DO $god_mode$
DECLARE
  t text;
  -- Tier 1 — full god-mode (admin FOR ALL)
  full_tables text[] := ARRAY[
    'disputes','support_tickets','support_messages','helpdesk_messages',
    'admin_direct_messages','organizations','departments','department_members',
    'org_departments','org_department_members','org_members','org_invitations',
    'proposals','reports','findings','coordination_bridges','bridge_documents',
    'bridge_slots','contractor_certifications','contractors','inspector_skills',
    'preferred_inspectors','saved_jobs','safety_checks','work_sessions',
    'vendor_contacts','referrals','user_course_progress','platform_settings',
    'review_weights_config','client_documents','expenses'
  ];
  -- Tier 2 — god-mode visibility only (admin FOR SELECT)
  read_tables text[] := ARRAY[
    'verification_audit_log','notification_logs','client_error_events',
    'inspection_events','dispute_activities','pi_report_seals',
    'inspection_seal_anchors','flash_reports','flash_report_attachments',
    'payment_methods','profile_work_auth_documents','push_tokens',
    'legal_consents','legal_document_acceptances','inspection_items'
  ];
BEGIN
  FOREACH t IN ARRAY full_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
        'USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin())',
        t || '_admin_all', t);
    ELSE
      RAISE NOTICE 'god-mode: skipping missing table public.%', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY read_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
        'USING (public.nx_is_admin())',
        t || '_admin_read', t);
    ELSE
      RAISE NOTICE 'god-mode: skipping missing table public.%', t;
    END IF;
  END LOOP;
END
$god_mode$;

-- ─── Self-test: spot-check that overlays landed on representative tables ──────
DO $selftest$
DECLARE
  v_missing text := '';
BEGIN
  IF to_regclass('public.disputes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='disputes' AND policyname='disputes_admin_all') THEN
    v_missing := v_missing || ' disputes_admin_all';
  END IF;
  IF to_regclass('public.verification_audit_log') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='verification_audit_log' AND policyname='verification_audit_log_admin_read') THEN
    v_missing := v_missing || ' verification_audit_log_admin_read';
  END IF;
  -- audit table must NOT receive a write overlay (immutability)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='verification_audit_log' AND policyname='verification_audit_log_admin_all') THEN
    v_missing := v_missing || ' UNEXPECTED:verification_audit_log_admin_all';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'SELFTEST god-mode overlays incomplete:%', v_missing;
  END IF;
  RAISE NOTICE 'god-mode overlays applied (32 FOR ALL + 15 FOR SELECT); audit/seal/secret tables read-only.';
END
$selftest$;
