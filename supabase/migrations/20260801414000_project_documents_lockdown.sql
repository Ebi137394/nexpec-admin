-- ════════════════════════════════════════════════════════════════════════════
--  20260801414000_project_documents_lockdown.sql
--
--  A PRE-EXISTING CRITICAL HOLE, unrelated to QCP. Found by the Phase 4
--  documents lane and deliberately given its own migration rather than being
--  buried inside QCP logic.
--
--  public.project_documents, as shipped in the baseline:
--      baseline:40652   GRANT ALL ON TABLE project_documents TO anon;
--      baseline:40653   GRANT ALL ON TABLE project_documents TO authenticated;
--      (no ENABLE ROW LEVEL SECURITY, no policy anywhere in any migration)
--
--  ALL means SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER. To
--  `anon` — the unauthenticated PostgREST role. With RLS off there is nothing
--  behind the grant. Any person on the internet with the public anon key can
--      GET    /rest/v1/project_documents          -> every document row
--      POST   /rest/v1/project_documents          -> forge attachments
--      DELETE /rest/v1/project_documents?id=eq.*  -> erase the lot
--  across every job and every customer. No account required.
--
--  The rows carry file_name, file_url and document_url, so the read alone
--  exposes the storage pointer for every uploaded document on the platform.
--
--  ── SECOND DEFECT: job_id IS UNCONSTRAINED ─────────────────────────────────
--  job_id uuid, with no FK and no coherence check. Anything can be attached to
--  any job id, including one that does not exist. Same class as the ITP visit
--  and evidence gaps fixed in 388000/396000/404000: an identifier that is only
--  a value, never a relationship.
--
--  ── WHAT MUST KEEP WORKING ─────────────────────────────────────────────────
--  app/(tabs)/resources.tsx:463 writes this table directly from mobile as the
--  signed-in user. That is a legitimate shipped workflow and it is preserved:
--  an authenticated member of the job may still insert, and may still see what
--  they are entitled to see. Only anonymous access, cross-job forgery and
--  destructive verbs are removed.
--
--  NOTE ON nx_can_access_doc: it looked like the natural delegate, but its
--  signature is (p_uid, p_bucket, p_path) — it authorises a STORAGE OBJECT by
--  bucket and path, not a table row by id. Its project_documents branch answers
--  "does this storage path belong to a row this user may reach", which is the
--  inverse question. Delegating a row policy to it would have compiled and been
--  wrong. The read policy below therefore states the row audience directly, and
--  uses exactly the same predicate as the insert policy so the two cannot drift.
--
--  ── NO DESTRUCTIVE DATA OPERATION ──────────────────────────────────────────
--  Not one row is read, rewritten or deleted. Existing rows whose job_id points
--  nowhere are left exactly as they are — the FK is deliberately NOT added,
--  because adding it would fail the migration or, worse, invite a cleanup that
--  destroys customer records. The coherence trigger applies to NEW writes only.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Close the anonymous door ─────────────────────────────────────────────
REVOKE ALL ON TABLE public.project_documents FROM anon;
REVOKE ALL ON TABLE public.project_documents FROM PUBLIC;

--  authenticated keeps only what the shipped workflow actually uses. UPDATE
--  and DELETE are removed outright: nothing in the app performs either, and a
--  document attachment is evidence — it should not be silently rewritable.
REVOKE ALL ON TABLE public.project_documents FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.project_documents TO authenticated;

-- ── 2. Turn the lights on ───────────────────────────────────────────────────
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

--  READ: the job's own parties. Same predicate as insert, plus the uploader,
--  so a legacy row with a dangling job_id stays visible to whoever attached it
--  instead of becoming unreachable data.
DROP POLICY IF EXISTS project_documents_read ON public.project_documents;
CREATE POLICY project_documents_read ON public.project_documents
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR uploader_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = project_documents.job_id
                  AND COALESCE(j.agency_id, j.client_id) = auth.uid())
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = project_documents.job_id AND j.contractor_id = auth.uid())
    OR public.nx_is_active_job_team_member(project_documents.job_id, auth.uid())
  );

--  WRITE: you upload as yourself, onto a job you are actually on.
DROP POLICY IF EXISTS project_documents_insert ON public.project_documents;
CREATE POLICY project_documents_insert ON public.project_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND job_id IS NOT NULL
    AND (
      public.nx_is_admin()
      OR EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = project_documents.job_id
                    AND COALESCE(j.agency_id, j.client_id) = auth.uid())
      OR EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = project_documents.job_id AND j.contractor_id = auth.uid())
      OR public.nx_is_active_job_team_member(project_documents.job_id, auth.uid())
    )
  );

COMMENT ON POLICY project_documents_insert ON public.project_documents IS
  'You attach as yourself, to a job you are on. uploader_id is pinned to auth.uid() — the 20260801402000 lesson: a policy that authorises the row while pinning no column is a forgery surface.';

-- ── 3. job_id must be a relationship, not a value ───────────────────────────
CREATE OR REPLACE FUNCTION public.tg_project_documents_job_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.job_id IS NULL THEN
    -- Legacy rows carry NULL. Reject only on the write path, where the policy
    -- above already demands a job; this keeps historical rows readable.
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id) THEN
    RAISE EXCEPTION 'job % does not exist — a document cannot be attached to it', NEW.job_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.tg_project_documents_job_coherence() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_project_documents_job_coherence ON public.project_documents;
CREATE TRIGGER trg_project_documents_job_coherence
  BEFORE INSERT OR UPDATE OF job_id ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_project_documents_job_coherence();

COMMENT ON TRIGGER trg_project_documents_job_coherence ON public.project_documents IS
  'job_id had no FK and no check, so a document could be attached to any uuid including a nonexistent job. Enforced as a trigger rather than a FK on purpose: a FK would fail this migration or invite a cleanup that destroys existing customer rows whose job_id already dangles. NEW writes only; history is untouched.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.project_documents', 'SELECT')
     OR has_table_privilege('anon', 'public.project_documents', 'INSERT')
     OR has_table_privilege('anon', 'public.project_documents', 'DELETE') THEN
    RAISE EXCEPTION 'SELFTEST: anon still reaches project_documents — every document on the platform is still public';
  END IF;
  IF has_table_privilege('authenticated', 'public.project_documents', 'DELETE')
     OR has_table_privilege('authenticated', 'public.project_documents', 'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can still rewrite or destroy document rows';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.project_documents', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: the shipped mobile upload workflow (app/(tabs)/resources.tsx) has been broken';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname='public' AND tablename='project_documents' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is still disabled on project_documents';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public' AND tablename='project_documents') < 2 THEN
    RAISE EXCEPTION 'SELFTEST: project_documents has fewer than the two required policies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_project_documents_job_coherence' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: job_id is still unconstrained';
  END IF;
  IF to_regprocedure('public.nx_is_active_job_team_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'DEPENDENCY: nx_is_active_job_team_member is missing — both policies would deny everything';
  END IF;
  -- Read and write must share one audience. If they drift, someone can attach
  -- a document they cannot then see, or vice versa.
  IF (SELECT count(DISTINCT strpos(pg_get_expr(polqual, polrelid), 'nx_is_active_job_team_member') > 0)
        FROM pg_policy WHERE polname = 'project_documents_read') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the read policy does not use the shared job-membership predicate';
  END IF;
END
$verify$;

COMMIT;
