-- ============================================================================
--  20260801224000_rls_owner_tables_complete.sql
--
--  FINAL LOCKDOWN (part 2) — complete RLS on the four owner-CRUD tables whose
--  anon exposure was closed in 20260801222000 but which still allowed
--  authenticated CROSS-TENANT access (any logged-in user could read/modify any
--  other user's rows). This adds ENABLE RLS + owner/admin policies so each row
--  is visible/writable only to its owner (and god-mode admin).
--
--  Owner columns verified against the live schema (remote_baseline.sql):
--    • inspector_documents.inspector_id   (inspector's own credential docs)
--    • certifications.user_id              (user's own certifications)
--    • signed_agreements.user_id          (user's own e-signatures)
--    • documents.organization_id          (org/asset-scoped; server-written,
--                                          read by the asset-intelligence view)
--
--  The three user-owned tables get a FOR ALL owner policy (the inspector/user
--  manages their own rows; admin manages all — matches the client write paths
--  in verification.tsx / certifications.tsx / cert-wallet.tsx / legal/index.tsx
--  and the admin verification screen). `documents` has NO client write path, so
--  authenticated writes are revoked and reads are scoped to org membership via
--  the canonical org_members predicate (same as 20260801204000 work_orders).
--
--  SAFE TO RE-RUN: ENABLE RLS is idempotent; every policy is DROP-then-CREATE;
--  self-test asserts the end state; wrapped in a transaction.
-- ============================================================================

BEGIN;

-- ── inspector_documents — owner = inspector_id (+ admin) ───────────────────
ALTER TABLE public.inspector_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspector_documents_owner_all ON public.inspector_documents;
CREATE POLICY inspector_documents_owner_all ON public.inspector_documents
  FOR ALL TO authenticated
  USING      (inspector_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (inspector_id = auth.uid() OR public.nx_is_admin());

-- ── certifications — owner = user_id (+ admin) ─────────────────────────────
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS certifications_owner_all ON public.certifications;
CREATE POLICY certifications_owner_all ON public.certifications
  FOR ALL TO authenticated
  USING      (user_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.nx_is_admin());

-- ── signed_agreements — owner = user_id (+ admin) ──────────────────────────
ALTER TABLE public.signed_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signed_agreements_owner_all ON public.signed_agreements;
CREATE POLICY signed_agreements_owner_all ON public.signed_agreements
  FOR ALL TO authenticated
  USING      (user_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.nx_is_admin());

-- ── documents — org/asset-scoped, server-written (no client writes) ────────
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.documents FROM authenticated;
DROP POLICY IF EXISTS documents_org_read ON public.documents;
CREATE POLICY documents_org_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id IN (
        SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── Self-test: RLS on + policies present ───────────────────────────────────
DO $test$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inspector_documents'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.certifications'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.signed_agreements'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.documents'::regclass)
  THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS not enabled on an owner table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inspector_documents' AND policyname='inspector_documents_owner_all')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='certifications'      AND policyname='certifications_owner_all')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='signed_agreements'   AND policyname='signed_agreements_owner_all')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents'           AND policyname='documents_org_read')
  THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an owner-table policy is missing';
  END IF;

  RAISE NOTICE 'owner-table RLS complete: inspector_documents, certifications, signed_agreements, documents.';
END
$test$;

COMMIT;
