-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801328000_live_identity_authority_and_lifecycle_gate
--
--  ⚠  REINTRODUCES A KNOWN DISCLOSURE DEFECT. Restoring the 288000 contract
--  view brings back the voided-snapshot CASE, which can RESURRECT identity
--  that an admin explicitly revoked (execute under Professional → downgrade to
--  Protected → void → the stale Professional snapshot governs again).
--  Roll back only if 328000 breaks a production flow you cannot fix forward,
--  and treat the window as a live disclosure incident.
--
--  Restores, verbatim:
--    • client_job_contracts_view       → 20260801288000 (voided-aware CASE)
--    • job_applicant_identity_view     → 20260801324000 (inlined COALESCE)
--    • admin_set_project_policy        → 20260801286000 (no lifecycle gate)
--    • nx_can_access_doc               → 20260801326000 (no engagement cutoff)
--  Leaves in place (additive, harmless):
--    • nx_terminal_job_statuses()
--    • nx_job_effective_identity_mode()
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. contract view: back to the voided-aware snapshot CASE ────────────────
CREATE OR REPLACE VIEW public.client_job_contracts_view
WITH (security_barrier = 'true') AS
SELECT
  jc.id, jc.job_id, jc.application_id, jc.client_id, jc.inspector_id,
  jc.client_price_cents, jc.status, jc.contract_text_md, jc.custom_contract_url,
  jc.client_signed_at, jc.client_signed_name, jc.inspector_signed_at,
  jc.voided_at, jc.voided_reason, jc.created_at, jc.updated_at,
  jc.client_approval_type, jc.admin_authorized_at,
  m.eff_mode AS identity_mode,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  CASE WHEN m.eff_mode = 'full' THEN p.email END AS inspector_email,
  CASE WHEN m.eff_mode = 'full' THEN p.phone END AS inspector_phone,
  jc.effective_identity_mode AS executed_identity_mode
FROM public.job_contracts jc
JOIN public.jobs j ON j.id = jc.job_id
LEFT JOIN public.profiles p ON p.id = jc.inspector_id
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN jc.status = 'voided' THEN COALESCE(jc.effective_identity_mode, 'protected')
           ELSE COALESCE(j.identity_mode, 'protected')
         END AS eff_mode
) m
WHERE jc.client_id = auth.uid() OR public.nx_is_admin();

ALTER VIEW public.client_job_contracts_view OWNER TO postgres;

-- ── 2. applicant view: back to the inlined rule ─────────────────────────────
CREATE OR REPLACE VIEW public.job_applicant_identity_view
WITH (security_barrier = 'true') AS
SELECT
  a.id AS application_id, a.job_id, a.applicant_id,
  a.status AS application_status, a.created_at,
  m.eff_mode AS identity_mode,
  p.rating_average, p.reviews_count, p.completed_jobs_count,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  CASE WHEN m.eff_mode = 'full' THEN p.email END AS inspector_email,
  CASE WHEN m.eff_mode = 'full' THEN p.phone END AS inspector_phone,
  p.rating, p.total_jobs, p.professional_title, p.title, p.experience_years,
  p.specialty_slugs, p.ndt_methods, p.location_city, p.location_province,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.avatar_url END AS inspector_avatar_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.first_name END AS inspector_first_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.last_name  END AS inspector_last_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.cv_url     END AS inspector_cv_url
FROM public.applications a
JOIN public.jobs j ON j.id = a.job_id
LEFT JOIN public.profiles p ON p.id = a.applicant_id
CROSS JOIN LATERAL (SELECT COALESCE(j.identity_mode, 'protected') AS eff_mode) m
WHERE j.client_id = auth.uid() OR j.agency_id = auth.uid() OR public.nx_is_admin();

ALTER VIEW public.job_applicant_identity_view OWNER TO postgres;
REVOKE ALL ON public.job_applicant_identity_view FROM PUBLIC, anon;
GRANT SELECT ON public.job_applicant_identity_view TO authenticated, service_role;

-- ── 3. policy RPC: drop the lifecycle gate ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_project_policy(
  p_job_id uuid, p_identity_mode text, p_replacement_mode text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_job RECORD;
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

  SELECT id, identity_mode, replacement_mode INTO v_job
    FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  UPDATE public.jobs
     SET identity_mode = p_identity_mode,
         replacement_mode = p_replacement_mode,
         updated_at = NOW()
   WHERE id = p_job_id;

  INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES ('job.policy.updated', 'info', auth.uid(), 'jobs', p_job_id, p_job_id,
    'Project policy updated',
    jsonb_build_object(
      'old_identity_mode', v_job.identity_mode, 'new_identity_mode', p_identity_mode,
      'old_replacement_mode', v_job.replacement_mode, 'new_replacement_mode', p_replacement_mode));

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id,
    'identity_mode', p_identity_mode, 'replacement_mode', p_replacement_mode);
END;
$$;
ALTER FUNCTION public.admin_set_project_policy(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_project_policy(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_project_policy(uuid, text, text) TO authenticated, service_role;

-- ── 4. nx_can_access_doc: 326000 body (résumé branch WITHOUT the cutoff) ────
CREATE OR REPLACE FUNCTION public.nx_can_access_doc(
  p_uid uuid, p_bucket text, p_path text
) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_role text;
BEGIN
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM storage.objects o
              WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid)
  THEN RETURN true; END IF;

  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1 FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
      JOIN public.profiles pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)
       AND a.forwarded_to_client_at IS NOT NULL
       AND COALESCE(j.identity_mode, 'protected') IN ('professional', 'full')
       AND (pr.resume_url LIKE '%' || p_path OR pr.cv_url LIKE '%' || p_path)
       AND (p_path LIKE a.applicant_id::text || '/%'
            OR EXISTS (SELECT 1 FROM storage.objects o2
                        WHERE o2.bucket_id = 'resumes' AND o2.name = p_path
                          AND o2.owner = a.applicant_id))
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.inspection_reports r JOIN public.jobs j ON j.id = r.job_id
     WHERE (r.photo_url LIKE '%' || p_path OR r.pdf_url LIKE '%' || p_path
            OR r.final_report_doc LIKE '%' || p_path)
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM public.contracts c
              WHERE c.document_url LIKE '%' || p_path
                AND (c.client_id = p_uid OR c.contractor_id = p_uid))
  THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM public.project_documents pd JOIN public.jobs j ON j.id = pd.job_id
              WHERE pd.file_url LIKE '%' || p_path
                AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid))
  THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM public.jobs j
              WHERE j.template_url LIKE '%' || p_path
                AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid))
  THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages m JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND (cv.user_id = p_uid
            OR (cv.job_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.jobs j WHERE j.id = cv.job_id
                   AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid))))
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

DO $verify$
DECLARE v text;
BEGIN
  IF pg_get_viewdef('public.client_job_contracts_view'::regclass, true) !~* 'voided' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: contract view was not restored';
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_set_project_policy(uuid,text,text)'::regprocedure);
  IF v ~* 'nx_terminal_job_statuses' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: lifecycle gate still present';
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v ~* 'nx_terminal_job_statuses' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: résumé engagement cutoff still present';
  END IF;
  RAISE WARNING '328000 rolled back — the voided-snapshot resurrection defect is BACK.';
END
$verify$;

COMMIT;
