-- ════════════════════════════════════════════════════════════════════════════
--  20260801322000_job_scoped_applicant_identity_and_audit_actor.sql
--
--  Forward-only. Does not edit or re-run any applied migration.
--
--  Fixes three defects found in runtime QA:
--
--  ── A) Professional identity never reached the buyer at the APPLICATION stage
--     20260801288000 resolves disclosure correctly, but ONLY in
--     client_job_contracts_view — which is keyed on job_contracts. Between
--     "inspector applies" and "contract exists" there was NO job-scoped
--     resolver at all, so every buyer surface fell back to the pseudonymous
--     NX- handle regardless of jobs.identity_mode. This adds the missing
--     application-stage resolver with the SAME gating matrix as 288000.
--
--  ── B) Identity/replacement audit events showed "Actor: Unknown"
--     The five INSERTs in 20260801286000 populate actor_id but not
--     actor_role / actor_label. Those columns are filled by the TABLE audit
--     trigger, which does not run for direct RPC inserts, and
--     audit_events_public (20260801294000) maps admin→'NEXPEC'/'platform' by
--     reading actor_role — NULL matches nothing, so the label came out NULL.
--     Back-filled here with a BEFORE INSERT trigger so every present and
--     future direct insert is covered, not just the five known call sites.
--
--  ── C) "Job details updated" attributed to an inspector
--     increment_job_applications_count() is SECURITY DEFINER and bumps
--     jobs.applications_count on apply. That legitimately bypasses the
--     jobs_update RLS policy (which excludes inspectors), the jobs audit
--     trigger then fires with actor = the applying inspector, and the diff
--     ("applications_count") is classified as the catch-all job.updated.
--     The inspector modified NO client-owned field. Relabelled truthfully.
--
--  NOT CHANGED (deliberately): no RLS policy is dropped or loosened, no
--  column privilege is granted back, no payout/margin column is exposed
--  anywhere in this file.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Effective identity mode for a job at the APPLICATION stage.
--
--    Deliberately simpler than the contract-stage resolver: the immutable
--    effective_identity_mode snapshot only exists once a contract has been
--    executed, and a voided contract's snapshot governs that contract's
--    history — neither applies to a live application. Fail-closed to
--    'protected' for NULL / missing / legacy rows.
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
  'Job-scoped effective identity disclosure mode for the application stage. Fail-closed to protected. Disclosure is per-job: authorization on job A says nothing about job B.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) job_applicant_identity_view — buyer-facing, JOB-SCOPED, mode-gated.
--
--    Definer semantics (security_invoker defaults false, owner = postgres),
--    exactly like client_job_contracts_view, so the WHERE clause below is the
--    ONLY authorization. It is deliberately narrow: the job's own buyer, its
--    agency, or an admin. Nothing else can select a single row.
--
--    GR2: this view carries IDENTITY + REPUTATION ONLY. It intentionally
--    exposes no bid, no payout, no client price and no platform spread, so it
--    can never become a margin-derivation channel — identity disclosure and
--    financial privacy stay strictly independent concerns.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.job_applicant_identity_view;

CREATE VIEW public.job_applicant_identity_view
WITH (security_barrier = 'true') AS
SELECT
  a.id                       AS application_id,
  a.job_id,
  a.applicant_id,
  a.status                   AS application_status,
  a.created_at,

  -- the mode governing THIS job only
  m.eff_mode                 AS identity_mode,

  -- ── always available (no identity content; the buyer needs these to choose
  --    an inspector even under Protected) ──
  p.rating_average,
  p.reviews_count,
  p.completed_jobs_count,

  -- ── professional + full ──
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,

  -- ── full ONLY. Private contact belongs to Full mode and must never leak
  --    into Professional. ──
  CASE WHEN m.eff_mode = 'full' THEN p.email END AS inspector_email,
  CASE WHEN m.eff_mode = 'full' THEN p.phone END AS inspector_phone

FROM public.applications a
JOIN public.jobs j        ON j.id = a.job_id
LEFT JOIN public.profiles p ON p.id = a.applicant_id
CROSS JOIN LATERAL (
  SELECT COALESCE(j.identity_mode, 'protected') AS eff_mode
) m
WHERE j.client_id = auth.uid()
   OR j.agency_id = auth.uid()
   OR public.nx_is_admin();

ALTER VIEW public.job_applicant_identity_view OWNER TO postgres;
REVOKE ALL ON public.job_applicant_identity_view FROM PUBLIC, anon;
GRANT SELECT ON public.job_applicant_identity_view TO authenticated, service_role;

COMMENT ON VIEW public.job_applicant_identity_view IS
  'Buyer-facing application-stage inspector identity, gated by the per-job identity_mode (protected → pseudonymous only; professional → name/resume/certifications; full → adds private contact). Job-scoped: a row exists only for applications to a job the caller owns, so disclosure on one job never discloses the same inspector on another. Carries no bid, payout, price or spread (GR2).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Audit actor back-fill (fixes "Actor: Unknown").
--
--    Only ever FILLS NULLs — an explicit actor_role/actor_label passed by a
--    caller is preserved untouched. This does not change who may read an
--    event, nor the admin→NEXPEC anonymisation in audit_events_public; it
--    supplies the role that anonymisation keys off.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_audit_events_fill_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role  text;
  v_label text;
BEGIN
  IF NEW.actor_role IS NOT NULL AND NEW.actor_label IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.actor_id IS NULL THEN
    NEW.actor_role  := COALESCE(NEW.actor_role,  'system');
    NEW.actor_label := COALESCE(NEW.actor_label, 'System');
    RETURN NEW;
  END IF;

  SELECT pr.role,
         COALESCE(NULLIF(btrim(pr.full_name), ''), pr.email, 'User')
    INTO v_role, v_label
    FROM public.profiles pr
   WHERE pr.id = NEW.actor_id;

  NEW.actor_role  := COALESCE(NEW.actor_role,  v_role,  'unknown');
  NEW.actor_label := COALESCE(NEW.actor_label, v_label, 'User');
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_audit_events_fill_actor() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_audit_events_fill_actor ON public.audit_events;
CREATE TRIGGER trg_audit_events_fill_actor
  BEFORE INSERT ON public.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_audit_events_fill_actor();

COMMENT ON FUNCTION public.tg_audit_events_fill_actor() IS
  'Back-fills audit_events.actor_role / actor_label for DIRECT (RPC) inserts, which never pass through the table audit trigger that normally derives them. Fills NULLs only. audit_events_public still anonymises admin actors to NEXPEC/platform — this makes that mapping reachable instead of collapsing to Unknown.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Truthful label for a platform counter bump.
--
--    Same signature as 20260801294000 so the existing audit_events_public
--    body picks the new behaviour up with no view rebuild. The new branch is
--    evaluated BEFORE the generic 'Job fields updated:' branch and is
--    deliberately anchored to the exact single-key counter summary, so any
--    real field change still reports as 'Job details updated'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_public_summary(p_summary text, p_is_buyer boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_summary IS NULL THEN NULL
    -- ★ counter-only diff: increment_job_applications_count() bumped
    --   applications_count. No client-owned job field changed, so do not tell
    --   the buyer their job details were edited.
    WHEN p_summary ~* '^Job fields updated:\s*applications_count\s*$'
      THEN 'Application received'
    -- the trigger appends the raw changed COLUMN NAMES — never publish those
    WHEN p_summary ~* '^Job fields updated:' THEN 'Job details updated'
    -- a client-price summary is the buyer's own number; generalise for others
    WHEN p_summary ~* '^Client price:' AND NOT COALESCE(p_is_buyer, false) THEN 'Pricing updated'
    ELSE regexp_replace(
           p_summary,
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
           '', 'gi')   -- strip any raw UUID embedded in free text
  END;
$$;

COMMENT ON FUNCTION public.audit_public_summary(text, boolean) IS
  'Neutralises an audit summary for non-admin readers: relabels a platform applications_count bump as "Application received", removes the raw changed-column list the trigger appends, generalises a client-price summary for non-buyers, and strips embedded UUIDs.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Self-tests
-- ─────────────────────────────────────────────────────────────────────────────
DO $test$
DECLARE n int; v text;
BEGIN
  -- (1) resolver exists and fails closed
  IF public.nx_job_effective_identity_mode('00000000-0000-0000-0000-000000000000') <> 'protected' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: identity resolver does not fail closed for a missing job';
  END IF;

  -- (2) the disclosure view exists and is NOT security_invoker (the WHERE is
  --     the authorization; invoker semantics would re-impose profiles RLS and
  --     silently reproduce the original bug)
  SELECT count(*) INTO n FROM pg_views WHERE schemaname='public' AND viewname='job_applicant_identity_view';
  IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: job_applicant_identity_view missing'; END IF;

  SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relname='job_applicant_identity_view'
     AND COALESCE(array_to_string(c.reloptions,','),'') ILIKE '%security_barrier=true%';
  IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: view is not security_barrier'; END IF;

  -- (3) GR2 — no financial column may appear in the disclosure view
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='job_applicant_identity_view'
     AND (column_name ILIKE '%payout%' OR column_name ILIKE '%price%'
          OR column_name ILIKE '%spread%' OR column_name ILIKE '%bid%'
          OR column_name ILIKE '%budget%');
  IF n <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % financial column(s) leaked into the identity view', n;
  END IF;

  -- (4) contact fields must exist but be full-mode only (guards against a
  --     future edit widening Professional into private contact)
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='job_applicant_identity_view'
     AND column_name IN ('inspector_email','inspector_phone');
  IF n <> 2 THEN RAISE EXCEPTION 'SELFTEST FAILED: full-mode contact columns missing'; END IF;

  SELECT pg_get_viewdef('public.job_applicant_identity_view'::regclass, true) INTO v;
  IF v !~* 'eff_mode\s*=\s*''full''::text\s+THEN\s+p\.email' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector_email is not gated to full mode only';
  END IF;
  IF v !~* 'eff_mode\s*=\s*''full''::text\s+THEN\s+p\.phone' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector_phone is not gated to full mode only';
  END IF;

  -- (5) actor back-fill trigger installed
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.audit_events'::regclass
     AND tgname  = 'trg_audit_events_fill_actor'
     AND NOT tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: audit actor back-fill trigger missing'; END IF;

  -- (6) summary relabel behaves, and does NOT swallow real field changes
  IF public.audit_public_summary('Job fields updated: applications_count', false)
     <> 'Application received' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: counter-only summary not relabelled';
  END IF;
  IF public.audit_public_summary('Job fields updated: description, location', false)
     <> 'Job details updated' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a real field change stopped reporting as Job details updated';
  END IF;
  IF public.audit_public_summary('Job fields updated: applications_count, description', false)
     <> 'Job details updated' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: counter+field change must NOT be softened to Application received';
  END IF;

  RAISE NOTICE 'job-scoped applicant identity + audit actor back-fill installed; GR2 preserved.';
END $test$;

COMMIT;
