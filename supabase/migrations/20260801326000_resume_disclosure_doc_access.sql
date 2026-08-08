-- ════════════════════════════════════════════════════════════════════════════
--  20260801326000_resume_disclosure_doc_access.sql
--
--  Forward-only. Does not edit 322000 or 324000 (both applied to Production),
--  nor 242000 which last defined nx_can_access_doc.
--
--  ── PROVEN DEFECT ──────────────────────────────────────────────────────────
--  Professional mode is defined to release the applicant's résumé/CV to the
--  buyer. It could not work. mint-doc-url calls
--  nx_can_access_doc(p_uid, p_bucket, p_path) — three inputs, no job id — and
--  the 242000 body has exactly these branches:
--
--      admin/super_admin • storage owner • inspection_reports •
--      contracts • project_documents • jobs.template_url •
--      messages.attachment_url • disputes.report_url (via work_orders,
--      healed by 252000) • RETURN false
--
--  NOT ONE of them reads profiles.resume_url / profiles.cv_url, or
--  public.applications, or jobs.identity_mode. A buyer is not the uploader and
--  is not admin, so every Professional résumé request fell through to
--  `RETURN false`. The `resumes` bucket is additionally private with
--  storage policy resumes_select_owner_admin, so no direct path existed either.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  ONE new branch, added ahead of the final deny. It authorizes a résumé read
--  only when EVERY one of these holds:
--
--    1. the bucket is literally 'resumes'      (cannot reach any other bucket)
--    2. the caller is the client OR agency of a specific job
--    3. an application links that job to the owning applicant
--    4. that application has been FORWARDED to the buyer (272000 gate) —
--       merely having applied is NOT sufficient
--    5. that job's identity_mode IS 'professional' or 'full'
--    6. the requested path IS that applicant's own resume_url or cv_url
--    7. the path additionally resolves to that applicant's storage folder or a
--       storage object they own — a second, independent ownership proof
--
--  Because 2–5 are proven against ONE job row, the grant is job-scoped:
--  Professional on job A creates no access through job B, and flipping the job
--  back to Protected revokes on the next mint. No pricing, payout or spread
--  column participates in this path.
--
--  Every pre-existing branch below is carried over VERBATIM from 242000.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_can_access_doc(
  p_uid    uuid,
  p_bucket text,
  p_path   text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN false;
  END IF;

  -- admin / super_admin (god-mode)
  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  -- storage owner (the uploader) — this is how an inspector reads their own CV
  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- ★★ NEW: applicant résumé released by JOB-SCOPED identity disclosure ★★
  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1
      FROM public.applications a
      JOIN public.jobs      j  ON j.id = a.job_id
      JOIN public.profiles  pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)          -- buyer of THIS job
       AND a.forwarded_to_client_at IS NOT NULL                   -- forwarded, not merely applied
       AND COALESCE(j.identity_mode, 'protected') IN ('professional', 'full')
       AND (
             pr.resume_url LIKE '%' || p_path                     -- the applicant's OWN pointer
          OR pr.cv_url     LIKE '%' || p_path
           )
       AND (
             p_path LIKE a.applicant_id::text || '/%'             -- {userId}/resume-*.ext convention
          OR EXISTS (
               SELECT 1 FROM storage.objects o2
                WHERE o2.bucket_id = 'resumes'
                  AND o2.name = p_path
                  AND o2.owner = a.applicant_id
             )
           )
  ) THEN RETURN true; END IF;

  -- job-party linkage (verbatim from 242000). Suffix match ('%' || path)
  -- tolerates rows that stored a full public URL vs. a bare path.
  IF EXISTS (
    SELECT 1 FROM public.inspection_reports r
      JOIN public.jobs j ON j.id = r.job_id
     WHERE (r.photo_url LIKE '%' || p_path
            OR r.pdf_url LIKE '%' || p_path
            OR r.final_report_doc LIKE '%' || p_path)
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.contracts c
     WHERE c.document_url LIKE '%' || p_path
       AND (c.client_id = p_uid OR c.contractor_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_documents pd
      JOIN public.jobs j ON j.id = pd.job_id
     WHERE pd.file_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.template_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND (
         cv.user_id = p_uid
         OR (cv.job_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.jobs j
               WHERE j.id = cv.job_id
                 AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
            ))
       )
  ) THEN RETURN true; END IF;

  -- dispute-reports: the generated PDF is visible to the dispute's parties.
  -- ★ disputes.project_id is an FK to public.work_orders(id) — NOT the
  --   org/budget projects table, which has no client_id / inspector_id.
  --   Healed by 20260801252000. Never rewire this back: those columns do not
  --   exist and the branch throws the first time control reaches it.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.work_orders w ON w.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (w.client_id = p_uid OR w.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.nx_can_access_doc(uuid, text, text) IS
  'Single authorization gate for mint-doc-url. Adds (20260801326000) a job-scoped applicant-résumé branch: bucket=resumes AND caller is the job buyer AND the application is forwarded AND that job identity_mode IN (professional,full) AND the path is that applicant''s own resume_url/cv_url AND resolves to their storage folder/object. Protected never qualifies. No pricing/payout column participates.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Self-tests — structural + the invariants that must never silently invert.
-- ─────────────────────────────────────────────────────────────────────────────
DO $test$
DECLARE v text;
BEGIN
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);

  IF v !~* 'forwarded_to_client_at' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: résumé branch does not require the forward gate';
  END IF;
  IF v !~* 'identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: résumé branch does not consult identity_mode';
  END IF;
  IF v !~* 'p_bucket = ''resumes''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: résumé branch is not pinned to the resumes bucket';
  END IF;
  IF v ~* 'payout|client_price|platform_spread|budget_cents' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a money column entered the document authorization path';
  END IF;

  -- every pre-existing branch must still be present (no accidental narrowing)
  IF v !~* 'inspection_reports' OR v !~* 'project_documents'
     OR v !~* 'attachment_url'  OR v !~* 'disputes' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a pre-existing document branch was lost';
  END IF;

  -- the buckets this gate protects must still be private
  IF EXISTS (SELECT 1 FROM storage.buckets
              WHERE id IN ('receipts','inspector-docs','certifications','resumes','dispute-reports')
                AND public IS TRUE) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a PII bucket is public';
  END IF;

  -- execute privilege must remain service_role only
  IF has_function_privilege('authenticated', 'public.nx_can_access_doc(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: authenticated can execute the doc authorization gate directly';
  END IF;


  -- ★ EXECUTE the function so EVERY branch is PLANNED, not merely parsed.
  --   plpgsql defers planning of a statement until control first reaches it,
  --   so a column that does not exist in a late branch stays invisible to any
  --   static check. This is exactly how `public.projects.client_id` survived
  --   into 326000/328000 after 252000 had already healed it. The uid below
  --   matches nothing, so control falls through EVERY branch to RETURN false.
  IF public.nx_can_access_doc(
       '00000000-0000-4000-8000-000000000000'::uuid,
       'dispute-reports',
       'branch-planning-probe/none.pdf') IS NOT false THEN
    RAISE EXCEPTION 'SELFTEST FAILED: fall-through probe did not return false';
  END IF;

  -- ★ and lock the healed wiring so it cannot silently regress again
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  --   pg_proc.prosrc includes COMMENTS, so a bare-token match reports a
  --   regression whenever the source merely *mentions* the old table — which is
  --   exactly what happened here. Match SQL STRUCTURE (a FROM/JOIN clause), not
  --   prose.
  IF v ~* '(FROM|JOIN)[[:space:]]+public\.projects\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a real FROM/JOIN public.projects reference is back (252000 regression)';
  END IF;
  IF v !~* 'JOIN[[:space:]]+public\.work_orders\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: dispute branch is not JOINed to work_orders (252000 healed semantics lost)';
  END IF;

  RAISE NOTICE 'résumé disclosure branch installed: job-scoped, forwarded-only, professional/full only.';
END $test$;

COMMIT;
