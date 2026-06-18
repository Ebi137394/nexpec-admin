-- ════════════════════════════════════════════════════════════════════════════
--  20260801147000_god_mode_full_control_15_tables.sql
--
--  OWNER OVERRIDE (ebi): upgrade the 15 audit/seal/secret/consent/log tables
--  from admin READ-only (_admin_read, migration 146000) to FULL god-mode
--  (_admin_all: read+insert+update+delete). The single admin (ebi) requires
--  absolute control to override/modify/delete any record.
--
--  Trade-off accepted by the owner: these tables (incl. verification_audit_log,
--  pi_report_seals, inspection_seal_anchors) are no longer tamper-EVIDENT at the
--  DB layer. External anchoring (OTS/bitcoin) of seals is unaffected.
--
--  Per table: drop the read overlay, (re)create a FOR ALL admin overlay, and
--  GRANT the write privileges to authenticated so the RLS write policy can take
--  effect (non-admins still match no permissive write policy -> 0 rows; only
--  nx_is_admin() passes). Idempotent + guarded. auth_recovery_codes and the
--  money tables are NOT in this set and remain as-is.
-- ════════════════════════════════════════════════════════════════════════════

DO $god_mode_full$
DECLARE
  t text;
  full_tables text[] := ARRAY[
    'verification_audit_log','notification_logs','client_error_events',
    'inspection_events','dispute_activities','pi_report_seals',
    'inspection_seal_anchors','flash_reports','flash_report_attachments',
    'payment_methods','profile_work_auth_documents','push_tokens',
    'legal_consents','legal_document_acceptances','inspection_items'
  ];
BEGIN
  FOREACH t IN ARRAY full_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all',  t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
        'USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin())',
        t || '_admin_all', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    ELSE
      RAISE NOTICE 'god-mode-full: skipping missing table public.%', t;
    END IF;
  END LOOP;
END
$god_mode_full$;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_bad text := '';
BEGIN
  IF to_regclass('public.verification_audit_log') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='verification_audit_log' AND policyname='verification_audit_log_admin_read') THEN
      v_bad := v_bad || ' read-overlay-still-present';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='verification_audit_log' AND policyname='verification_audit_log_admin_all' AND cmd='ALL') THEN
      v_bad := v_bad || ' full-overlay-missing';
    END IF;
  END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'SELFTEST god-mode-full failed:%', v_bad; END IF;
  RAISE NOTICE 'god-mode FULL control granted on all 15 former read-only tables.';
END
$selftest$;
