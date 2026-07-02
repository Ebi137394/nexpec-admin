-- ════════════════════════════════════════════════════════════════════════════
--  20260801204000_work_orders_org_read.sql        (Mobile Parity — P1-4)
--
--  After 196000, work_orders is scoped to owner_id/client_id/inspector_id/user_id
--  (work_orders_owner_all) + admin overlay. But the mobile operations dashboard
--  (src/hooks/useOperationsData.ts) reads by `organization_id` — so an org member
--  who isn't the row owner sees ZERO rows and the dashboard renders empty.
--
--  work_orders DOES carry `organization_id`; add a PERMISSIVE read path so any
--  member of the owning org can SELECT the org's work orders (operations view).
--  Read-only + additive → no write surface widened, owner/admin policies intact.
--  work_orders holds the org's OWN operational data (no inspector-payout / client-
--  price silo columns), so org-member read does not breach price-blindness.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP POLICY IF EXISTS work_orders_org_read ON public.work_orders;
CREATE POLICY work_orders_org_read ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='work_orders'
                    AND policyname='work_orders_org_read') THEN
    RAISE EXCEPTION 'SELFTEST: work_orders_org_read policy missing';
  END IF;
  RAISE NOTICE 'work_orders org-member read policy OK (operations dashboard aligned).';
END
$test$;

COMMIT;
