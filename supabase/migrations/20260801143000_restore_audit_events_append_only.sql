-- ════════════════════════════════════════════════════════════════════════════
--  20260801143000_restore_audit_events_append_only.sql
--
--  INTEGRITY: the append-only protection on public.audit_events (originally set
--  by 20260711120000, archived in the squash) is NOT present in the prod
--  baseline — the table grants UPDATE/DELETE (audit tampering) AND TRUNCATE
--  (full audit-trail wipe) to anon + authenticated. The pgTAP suite
--  rls_audit_events_test.sql caught this (UPDATE/DELETE returned "no exception"
--  instead of being denied).
--
--  Restore append-only + anti-forgery posture (RLS already enabled; insert-self
--  + tenant-scoped-select policies already exist in the baseline):
--    • REVOKE UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN from anon +
--      authenticated → immutable by construction (belt + suspenders alongside
--      the absent UPDATE/DELETE policies).
--    • anon: no access at all.
--    • authenticated: SELECT (RLS-scoped) + INSERT (own-actor) only.
--    • service_role + SECURITY DEFINER fns bypass RLS for system writes.
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

DO $audit$
BEGIN
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.audit_events FROM PUBLIC, anon';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.audit_events FROM authenticated';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.audit_events TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.audit_events TO service_role';
  END IF;
END
$audit$;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.audit_events') IS NULL THEN
    RAISE NOTICE 'audit_events absent — skipped'; RETURN;
  END IF;
  IF has_table_privilege('authenticated','public.audit_events','UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can still UPDATE audit_events'; END IF;
  IF has_table_privilege('authenticated','public.audit_events','DELETE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can still DELETE audit_events'; END IF;
  IF has_table_privilege('authenticated','public.audit_events','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can still TRUNCATE audit_events'; END IF;
  IF has_table_privilege('anon','public.audit_events','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can still read audit_events'; END IF;
  RAISE NOTICE 'audit_events restored to append-only: UPDATE/DELETE/TRUNCATE revoked; anon locked out.';
END
$selftest$;
