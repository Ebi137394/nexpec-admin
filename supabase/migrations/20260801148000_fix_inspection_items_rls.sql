-- ════════════════════════════════════════════════════════════════════════════
--  20260801148000_fix_inspection_items_rls.sql
--
--  BUG: public.inspection_items has RLS ENABLED but ZERO base policies. Result:
--  no non-service caller can read OR write it. The inspector seal flow
--  (app/inspector/seal-report.tsx counts inspection_items by report_id) silently
--  returns 0 rows for the very inspector who owns the report.
--
--  Ownership chain: inspection_items.report_id -> reports.id, and a report is
--  owned by reports.inspector_id, with the client reachable via
--  reports.project_id -> work_orders.client_id (the legacy report/project model).
--
--  Fix — properly scoped (NOT a blanket USING(true)):
--    • the inspector who owns the parent report fully MANAGES its items (FOR ALL)
--    • the client who owns the project READS items on their reports (FOR SELECT)
--    • admin already has full access via inspection_items_admin_all (147000)
--  Grants are already in place (147000 granted authenticated CRUD on this table).
--  Idempotent + guarded.
-- ════════════════════════════════════════════════════════════════════════════

DO $fix$
BEGIN
  IF to_regclass('public.inspection_items') IS NULL OR to_regclass('public.reports') IS NULL THEN
    RAISE NOTICE 'inspection_items/reports missing — skipping';
    RETURN;
  END IF;

  -- Inspector manages the items on reports they own.
  DROP POLICY IF EXISTS inspection_items_owner_manage ON public.inspection_items;
  CREATE POLICY inspection_items_owner_manage ON public.inspection_items
    FOR ALL TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id = inspection_items.report_id
         AND r.inspector_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id = inspection_items.report_id
         AND r.inspector_id = auth.uid()
    ));

  -- Client reads items on reports tied to their projects (legacy work_orders link).
  IF to_regclass('public.work_orders') IS NOT NULL THEN
    DROP POLICY IF EXISTS inspection_items_client_read ON public.inspection_items;
    CREATE POLICY inspection_items_client_read ON public.inspection_items
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.reports r
          JOIN public.work_orders w ON w.id = r.project_id
         WHERE r.id = inspection_items.report_id
           AND w.client_id = auth.uid()
      ));
  END IF;
END
$fix$;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.inspection_items') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inspection_items' AND policyname='inspection_items_owner_manage') THEN
      RAISE EXCEPTION 'SELFTEST: inspection_items_owner_manage missing';
    END IF;
    RAISE NOTICE 'inspection_items RLS fixed: inspector manages own report items; client reads project items; admin via overlay.';
  END IF;
END
$selftest$;
