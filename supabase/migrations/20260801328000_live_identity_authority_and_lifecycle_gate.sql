-- ════════════════════════════════════════════════════════════════════════════
--  20260801328000_live_identity_authority_and_lifecycle_gate.sql
--
--  Forward-only. Does not edit 322000/324000 (applied to Production) and keeps
--  326000's résumé security semantics intact while narrowing them.
--
--  ── PRODUCT DECISION IMPLEMENTED ───────────────────────────────────────────
--  jobs.identity_mode is the LIVE authorization source at EVERY stage,
--  including a fully-executed contract. A client may ask NEXPEC for more
--  disclosure mid-engagement, and an admin may reduce it again.
--  job_contracts.effective_identity_mode becomes AUDIT EVIDENCE ONLY.
--
--  ── DEFECT 1: the voided-contract snapshot could RESURRECT disclosure ──────
--  client_job_contracts_view (20260801288000) resolved:
--
--      CASE WHEN jc.status = 'voided' THEN jc.effective_identity_mode
--           ELSE j.identity_mode END
--
--  So: execute under Professional → admin downgrades to Protected → contract
--  is voided → the STALE Professional snapshot became authoritative again and
--  re-revealed identity that had been explicitly revoked. The inverse also
--  held: a job upgraded after execution appeared to lose disclosure on void.
--  Voiding a contract is not a disclosure decision and must never move the
--  policy in either direction.
--
--  ── DEFECT 2: three diverging "effective mode" implementations ─────────────
--    • nx_job_effective_identity_mode()  — correct, and entirely unused
--    • job_applicant_identity_view       — inlined COALESCE
--    • client_job_contracts_view         — its own voided-aware CASE
--  All three now route through the single helper.
--
--  ── DEFECT 3: policy was mutable forever ──────────────────────────────────
--  admin_set_project_policy had no lifecycle gate, so an admin could change
--  disclosure on a long-closed job and retroactively oscillate the client's
--  historical view. Gated on the REAL terminal set below.
--
--  ── DEFECT 4: résumé access outlived the engagement ───────────────────────
--  326000's branch keyed only on applications + identity_mode, so a completed
--  job left in Professional kept minting résumé links forever.
--
--  ── ACTUAL STATE MACHINE (not invented) ───────────────────────────────────
--    jobs_status_check           : pending_approval | open | assigned |
--                                  in_progress | completed | paid |
--                                  cancelled | disputed
--    TERMINAL_JOB_STATUSES       : completed, cancelled
--      (packages/shared-core/src/domain/jobStatus.ts — the canonical union,
--       mirrored by guard_jobs_status_transition; 'disputed' is NOT terminal,
--       it can return to in_progress/completed/cancelled)
--    'paid' is in the DB CHECK but outside the transitionable union — it is a
--      legacy post-completion state, so it is treated as terminal here. Leaving
--      it mutable would be a hole, not a kindness.
--    job_contracts_status_check  : pending_client_signature |
--                                  pending_inspector_signature |
--                                  fully_executed | voided
--    applications_status_check   : pending | shortlisted | offered |
--                                  CLIENT_SELECTED | hired | rejected |
--                                  withdrawn | accepted
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Canonical terminal sets — named once, referenced everywhere below.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_terminal_job_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT ARRAY['completed','cancelled','paid']::text[] $$;

ALTER FUNCTION public.nx_terminal_job_statuses() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.nx_terminal_job_statuses() TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_terminal_job_statuses() IS
  'Jobs whose engagement is over: TERMINAL_JOB_STATUSES (completed, cancelled) from packages/shared-core/src/domain/jobStatus.ts, plus the legacy post-completion ''paid'' admitted by jobs_status_check. Deliberately excludes ''disputed'', which is recoverable.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) THE canonical live rule. Body unchanged from 322000 — this is now the
--    single implementation every consumer calls.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_effective_identity_mode(p_job_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
           (SELECT j.identity_mode FROM public.jobs j WHERE j.id = p_job_id),
           'protected');
$$;

ALTER FUNCTION public.nx_job_effective_identity_mode(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_effective_identity_mode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_effective_identity_mode(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_effective_identity_mode(uuid) IS
  'THE canonical live identity-disclosure rule. Always the CURRENT jobs.identity_mode, fail-closed to protected, at every lifecycle stage including a fully-executed contract. job_contracts.effective_identity_mode is an audit snapshot and is never consulted for authorization.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) client_job_contracts_view — snapshot demoted to audit evidence.
--    Column names/order/types preserved; `executed_identity_mode` appended.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.client_job_contracts_view
WITH (security_barrier = 'true') AS
SELECT
  jc.id,
  jc.job_id,
  jc.application_id,
  jc.client_id,
  jc.inspector_id,
  jc.client_price_cents,
  jc.status,
  jc.contract_text_md,
  jc.custom_contract_url,
  jc.client_signed_at,
  jc.client_signed_name,
  jc.inspector_signed_at,
  jc.voided_at,
  jc.voided_reason,
  jc.created_at,
  jc.updated_at,
  jc.client_approval_type,
  jc.admin_authorized_at,
  -- ★ LIVE for every status, voided included. Voiding is not a disclosure act.
  public.nx_job_effective_identity_mode(jc.job_id) AS identity_mode,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) = 'full' THEN p.email END AS inspector_email,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) = 'full' THEN p.phone END AS inspector_phone,
  -- ── appended: AUDIT ONLY. The mode at contract execution. Never authorizes.
  jc.effective_identity_mode AS executed_identity_mode
FROM public.job_contracts jc
JOIN public.jobs j ON j.id = jc.job_id
LEFT JOIN public.profiles p ON p.id = jc.inspector_id
WHERE jc.client_id = auth.uid() OR public.nx_is_admin();

ALTER VIEW public.client_job_contracts_view OWNER TO postgres;

COMMENT ON VIEW public.client_job_contracts_view IS
  'Buyer-facing contract view. Identity disclosure is resolved LIVE from jobs.identity_mode at every status, voided included (20260801328000) — the execution snapshot is exposed as executed_identity_mode for audit and never authorizes. GR2: never exposes inspector payout / platform spread.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) job_applicant_identity_view — same helper, no inlined second rule.
--    Column list identical to 324000 with the expression source swapped.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.job_applicant_identity_view
WITH (security_barrier = 'true') AS
SELECT
  a.id                       AS application_id,
  a.job_id,
  a.applicant_id,
  a.status                   AS application_status,
  a.created_at,
  m.eff_mode                 AS identity_mode,
  p.rating_average,
  p.reviews_count,
  p.completed_jobs_count,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  CASE WHEN m.eff_mode = 'full' THEN p.email END AS inspector_email,
  CASE WHEN m.eff_mode = 'full' THEN p.phone END AS inspector_phone,
  p.rating,
  p.total_jobs,
  p.professional_title,
  p.title,
  p.experience_years,
  p.specialty_slugs,
  p.ndt_methods,
  p.location_city,
  p.location_province,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.avatar_url END AS inspector_avatar_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.first_name END AS inspector_first_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.last_name  END AS inspector_last_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.cv_url     END AS inspector_cv_url
FROM public.applications a
JOIN public.jobs j        ON j.id = a.job_id
LEFT JOIN public.profiles p ON p.id = a.applicant_id
CROSS JOIN LATERAL (
  -- ★ the ONE canonical rule
  SELECT public.nx_job_effective_identity_mode(a.job_id) AS eff_mode
) m
WHERE j.client_id = auth.uid()
   OR j.agency_id = auth.uid()
   OR public.nx_is_admin();

ALTER VIEW public.job_applicant_identity_view OWNER TO postgres;
REVOKE ALL ON public.job_applicant_identity_view FROM PUBLIC, anon;
GRANT SELECT ON public.job_applicant_identity_view TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) admin_set_project_policy — lifecycle gate.
--    Body identical to 286000 apart from the terminal check. Disclosure stays
--    fully adjustable for the entire live engagement, including a
--    fully-executed contract, exactly as the product decision requires.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_project_policy(
  p_job_id          uuid,
  p_identity_mode   text,
  p_replacement_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_job  RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_identity_mode IS NULL OR p_identity_mode NOT IN ('protected','professional','full') THEN
    RAISE EXCEPTION 'invalid identity_mode (protected|professional|full)' USING errcode = '22023';
  END IF;
  IF p_replacement_mode IS NULL OR p_replacement_mode NOT IN ('client_reapproval','admin_authorized') THEN
    RAISE EXCEPTION 'invalid replacement_mode (client_reapproval|admin_authorized)' USING errcode = '22023';
  END IF;

  SELECT id, status, identity_mode, replacement_mode
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  -- ★ LIFECYCLE GATE. Once the engagement is over, the disclosure policy is
  --   frozen: otherwise a later admin edit retroactively oscillates what the
  --   client sees in their historical record. Idempotent re-assertion of the
  --   SAME policy is still permitted so a no-op replay never errors.
  IF v_job.status = ANY (public.nx_terminal_job_statuses())
     AND (v_job.identity_mode IS DISTINCT FROM p_identity_mode
          OR v_job.replacement_mode IS DISTINCT FROM p_replacement_mode)
  THEN
    RAISE EXCEPTION
      'job % is % — the engagement is closed and its disclosure policy is frozen',
      p_job_id, v_job.status
      USING errcode = '42501';
  END IF;

  UPDATE public.jobs
     SET identity_mode    = p_identity_mode,
         replacement_mode = p_replacement_mode,
         updated_at       = NOW()
   WHERE id = p_job_id;

  INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES ('job.policy.updated', 'info', auth.uid(), 'jobs', p_job_id, p_job_id,
    'Project policy updated',
    jsonb_build_object(
      'old_identity_mode',    v_job.identity_mode,
      'new_identity_mode',    p_identity_mode,
      'old_replacement_mode', v_job.replacement_mode,
      'new_replacement_mode', p_replacement_mode
    ));

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'identity_mode', p_identity_mode,
    'replacement_mode', p_replacement_mode
  );
END;
$$;

ALTER FUNCTION public.admin_set_project_policy(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_project_policy(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_project_policy(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) nx_can_access_doc — résumé branch gains the engagement cutoff.
--    Everything else is 326000 verbatim.
-- ─────────────────────────────────────────────────────────────────────────────
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

  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- ★ applicant résumé released by JOB-SCOPED identity disclosure,
  --   now cut off when the engagement itself is over.
  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1
      FROM public.applications a
      JOIN public.jobs      j  ON j.id = a.job_id
      JOIN public.profiles  pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)
       AND a.forwarded_to_client_at IS NOT NULL
       AND public.nx_job_effective_identity_mode(j.id) IN ('professional', 'full')
       -- ★ CUTOFF 1: the job's engagement must still be live.
       AND NOT (j.status = ANY (public.nx_terminal_job_statuses()))
       -- ★ CUTOFF 2: this applicant must still be a live candidate.
       AND a.status NOT IN ('rejected', 'withdrawn')
       -- ★ CUTOFF 3: if a contract exists for this pairing it must not be voided.
       AND NOT EXISTS (
             SELECT 1 FROM public.job_contracts jc
              WHERE jc.job_id = j.id
                AND jc.inspector_id = a.applicant_id
                AND jc.status = 'voided'
                AND NOT EXISTS (
                      SELECT 1 FROM public.job_contracts jc2
                       WHERE jc2.job_id = j.id
                         AND jc2.inspector_id = a.applicant_id
                         AND jc2.status <> 'voided'
                    )
           )
       AND (
             pr.resume_url LIKE '%' || p_path
          OR pr.cv_url     LIKE '%' || p_path
           )
       AND (
             p_path LIKE a.applicant_id::text || '/%'
          OR EXISTS (
               SELECT 1 FROM storage.objects o2
                WHERE o2.bucket_id = 'resumes'
                  AND o2.name = p_path
                  AND o2.owner = a.applicant_id
             )
           )
  ) THEN RETURN true; END IF;

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

  RETURN false;
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Self-tests
-- ─────────────────────────────────────────────────────────────────────────────
DO $test$
DECLARE v text;
BEGIN
  -- the snapshot must no longer authorize anything
  v := pg_get_viewdef('public.client_job_contracts_view'::regclass, true);
  IF v ~* 'status\s*=\s*''voided''::text\s+THEN\s+.*effective_identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the voided snapshot still drives disclosure';
  END IF;
  IF v !~* 'executed_identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the audit snapshot column was dropped instead of demoted';
  END IF;
  IF v !~* 'nx_job_effective_identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: contract view does not use the canonical helper';
  END IF;

  -- both views must route through the ONE helper
  v := pg_get_viewdef('public.job_applicant_identity_view'::regclass, true);
  IF v !~* 'nx_job_effective_identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applicant view still inlines its own rule';
  END IF;
  IF v !~* 'eff_mode\s*=\s*''full''::text\s+THEN\s+p\.email' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: contact is no longer full-mode-gated';
  END IF;

  -- terminal set must be the real one
  IF NOT ('completed' = ANY (public.nx_terminal_job_statuses()))
     OR NOT ('cancelled' = ANY (public.nx_terminal_job_statuses()))
     OR ('disputed' = ANY (public.nx_terminal_job_statuses()))
     OR ('in_progress' = ANY (public.nx_terminal_job_statuses()))
  THEN
    RAISE EXCEPTION 'SELFTEST FAILED: terminal job status set is wrong';
  END IF;

  -- résumé branch must carry all three cutoffs
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v !~* 'nx_terminal_job_statuses' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: résumé branch has no engagement cutoff';
  END IF;
  IF v !~* 'forwarded_to_client_at' OR v !~* 'nx_job_effective_identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: résumé branch lost its forward/mode gate';
  END IF;
  IF v ~* 'payout|client_price|platform_spread' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a money column entered the document path';
  END IF;

  -- policy RPC must carry the lifecycle gate
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_set_project_policy(uuid,text,text)'::regprocedure);
  IF v !~* 'nx_terminal_job_statuses' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_set_project_policy has no lifecycle gate';
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

  RAISE NOTICE 'live identity authority + lifecycle gate installed; snapshot demoted to audit.';
END $test$;

COMMIT;
