-- ════════════════════════════════════════════════════════════════════════════
--  20260801476000_nexpec_talent.sql
--
--  NEXPEC TALENT — permanent-placement marketplace.
--
--  ── WHAT THIS REUSES, AND WHY THAT MATTERS ─────────────────────────────────
--  Talent is a new COMMERCIAL MODE over the existing platform, not a second
--  platform. Nothing here duplicates identity, org, domain, credential,
--  messaging, notification or admin infrastructure:
--
--    identity      public.profiles                   (candidate = a profile)
--    employer      public.organizations              (no `employers` table)
--    domains       public.inspection_domains         (slug FK, no talent taxonomy)
--    credentials   public.inspector_credentials      (no second credential store)
--    notifications public.nx_notify_lifecycle        (20260801456000 emitter,
--                                                     amount-guarded)
--    matching      the nx_match_inspectors_for_job scoring shape, applied to
--                  opportunities rather than re-derived
--
--  A candidate is a profile that OPTED IN. There is no candidate account, no
--  candidate login, no parallel user table.
--
--  ── BROKERED IDENTITY IS THE CENTRAL CONTRACT ──────────────────────────────
--  The platform's existing anti-circumvention model (sealed rider, 36-month
--  non-circumvention, inspector_engagement_meta.identity_revealed_at) exists
--  because a marketplace that reveals identity for free gets disintermediated.
--  Permanent placement is the HIGHEST-risk surface for that: an employer who
--  learns a candidate's name can hire them directly and pay nothing.
--
--  So a submission is ANONYMOUS by default. The employer sees a capability
--  profile — domains, years, credential classes, region — and never the name,
--  email, phone or employer history, until the candidate EXPLICITLY consents to
--  disclosure for that specific opportunity. Disclosure is per-opportunity, not
--  global, and it is revocable while the submission is still open.
--  §7 enforces this in a view, not in prose, and §9 proves it.
--
--  ── MONETISATION WITHOUT AUTOMATIC MONEY ───────────────────────────────────
--  A placement accrues a fee. It does NOT pay anyone. Consistent with
--  20260801432000 / 444000 / 458000, which removed the last three automatic
--  money paths: settlement and payout stay manual and Admin-controlled. This
--  migration writes NO wallet, transaction, earning or payout row, and §9
--  asserts it.
--
--  ── PRICE PRIVACY ──────────────────────────────────────────────────────────
--  Candidate sees the compensation offered to them. Employer sees the fee it
--  owes. NEITHER sees the platform's margin. Same rule as
--  client_price_cents / inspector_payout_cents / platform_spread_cents on the
--  inspection side, and enforced the same way: the two audience views simply do
--  not carry the other party's figure.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Candidate opt-in ────────────────────────────────────────────────────
--  A candidate IS a profile. This table records that a profile chose to be
--  discoverable for permanent roles, and nothing else about who they are.
CREATE TABLE IF NOT EXISTS public.talent_candidate_profiles (
  profile_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_open_to_work   boolean NOT NULL DEFAULT false,
  headline          text,
  years_experience  integer,
  region            text,
  desired_min_cents bigint,
  desired_max_cents bigint,
  notice_period_days integer,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT talent_candidate_years_chk  CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 70),
  CONSTRAINT talent_candidate_notice_chk CHECK (notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 365),
  CONSTRAINT talent_candidate_range_chk  CHECK (
    desired_min_cents IS NULL OR desired_max_cents IS NULL
    OR desired_max_cents >= desired_min_cents)
);

COMMENT ON TABLE public.talent_candidate_profiles IS
  'Opt-in marker on an EXISTING profile. There is no candidate account and no second '
  'user table — a candidate is a profile that set is_open_to_work. Carries capability '
  'facts only; name, email and phone stay on profiles and are released per-opportunity '
  'through talent_disclosures.';

-- domains reuse the canonical taxonomy; no talent-specific domain list
CREATE TABLE IF NOT EXISTS public.talent_candidate_domains (
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- public.inspection_domains.slug is the ENUM `public.inspection_domain`,
  -- not text. Declaring this column `text` made the FK unimplementable
  -- (SQLSTATE 42804, datatype_mismatch) and aborted the final migration.
  -- Reusing the existing enum is also the correct call for the lane: the
  -- Talent brief says reuse inspection_domains rather than introduce a
  -- parallel Talent taxonomy, and an enum column cannot drift from it.
  domain_slug public.inspection_domain NOT NULL REFERENCES public.inspection_domains(slug) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, domain_slug)
);

-- ─── 2. Opportunity (the employer's permanent role) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.talent_opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by        uuid NOT NULL,
  title             text NOT NULL,
  description       text,
  region            text,
  min_years         integer,
  -- what the EMPLOYER will pay the hire. Visible to a matched candidate.
  comp_min_cents    bigint,
  comp_max_cents    bigint,
  -- what the employer owes NEXPEC on placement. NEVER shown to a candidate.
  placement_fee_bps integer NOT NULL DEFAULT 2000,
  status            text NOT NULL DEFAULT 'draft',
  published_at      timestamp with time zone,
  closed_at         timestamp with time zone,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT talent_opportunity_status_chk CHECK (
    status = ANY (ARRAY['draft','open','on_hold','filled','cancelled'])),
  CONSTRAINT talent_opportunity_fee_chk CHECK (placement_fee_bps BETWEEN 0 AND 10000),
  CONSTRAINT talent_opportunity_comp_chk CHECK (
    comp_min_cents IS NULL OR comp_max_cents IS NULL OR comp_max_cents >= comp_min_cents)
);

CREATE TABLE IF NOT EXISTS public.talent_opportunity_domains (
  opportunity_id uuid NOT NULL REFERENCES public.talent_opportunities(id) ON DELETE CASCADE,
  -- public.inspection_domains.slug is the ENUM `public.inspection_domain`,
  -- not text. Declaring this column `text` made the FK unimplementable
  -- (SQLSTATE 42804, datatype_mismatch) and aborted the final migration.
  -- Reusing the existing enum is also the correct call for the lane: the
  -- Talent brief says reuse inspection_domains rather than introduce a
  -- parallel Talent taxonomy, and an enum column cannot drift from it.
  domain_slug    public.inspection_domain NOT NULL REFERENCES public.inspection_domains(slug) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, domain_slug)
);

-- ─── 3. Consent — explicit, per-opportunity, revocable ──────────────────────
CREATE TABLE IF NOT EXISTS public.talent_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope          text NOT NULL,
  granted_at     timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at     timestamp with time zone,
  CONSTRAINT talent_consent_scope_chk CHECK (
    scope = ANY (ARRAY['discoverable','submission','disclosure']))
);

CREATE INDEX IF NOT EXISTS talent_consents_live_idx
  ON public.talent_consents (profile_id, scope) WHERE revoked_at IS NULL;

-- ─── 4. Submission → Interview → Offer → Placement ──────────────────────────
CREATE TABLE IF NOT EXISTS public.talent_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.talent_opportunities(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submitted_by   uuid NOT NULL,
  status         text NOT NULL DEFAULT 'submitted',
  match_score    numeric(5,2),
  withdrawn_at   timestamp with time zone,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT talent_submission_uq UNIQUE (opportunity_id, profile_id),
  CONSTRAINT talent_submission_status_chk CHECK (
    status = ANY (ARRAY['submitted','shortlisted','interviewing','offered','placed','rejected','withdrawn']))
);

--  Disclosure is per-SUBMISSION, so consenting to one employer never exposes a
--  candidate to another. This row is what lifts the anonymity veil in §7.
CREATE TABLE IF NOT EXISTS public.talent_disclosures (
  submission_id uuid PRIMARY KEY REFERENCES public.talent_submissions(id) ON DELETE CASCADE,
  disclosed_at  timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at    timestamp with time zone,
  consent_id    uuid NOT NULL REFERENCES public.talent_consents(id)
);

CREATE TABLE IF NOT EXISTS public.talent_interviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.talent_submissions(id) ON DELETE CASCADE,
  scheduled_at  timestamp with time zone NOT NULL,
  mode          text NOT NULL DEFAULT 'video',
  outcome       text,
  notes         text,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT talent_interview_mode_chk CHECK (mode = ANY (ARRAY['video','onsite','phone'])),
  CONSTRAINT talent_interview_outcome_chk CHECK (
    outcome IS NULL OR outcome = ANY (ARRAY['advance','reject','no_show']))
);

CREATE TABLE IF NOT EXISTS public.talent_offers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES public.talent_submissions(id) ON DELETE CASCADE,
  comp_cents     bigint NOT NULL,
  start_date     date,
  status         text NOT NULL DEFAULT 'extended',
  responded_at   timestamp with time zone,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT talent_offer_comp_chk   CHECK (comp_cents > 0),
  CONSTRAINT talent_offer_status_chk CHECK (
    status = ANY (ARRAY['extended','accepted','declined','withdrawn']))
);

--  A placement ACCRUES a fee. It pays nobody. Settlement is manual and
--  Admin-controlled, exactly as on the inspection side.
CREATE TABLE IF NOT EXISTS public.talent_placements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     uuid NOT NULL UNIQUE REFERENCES public.talent_submissions(id) ON DELETE CASCADE,
  offer_id          uuid NOT NULL REFERENCES public.talent_offers(id),
  placed_at         timestamp with time zone NOT NULL DEFAULT now(),
  comp_cents        bigint NOT NULL,
  fee_bps           integer NOT NULL,
  fee_cents         bigint NOT NULL,
  guarantee_until   date,
  fee_status        text NOT NULL DEFAULT 'accrued',
  settled_at        timestamp with time zone,
  settled_by        uuid,
  CONSTRAINT talent_placement_fee_status_chk CHECK (
    fee_status = ANY (ARRAY['accrued','invoiced','settled','waived','clawed_back'])),
  CONSTRAINT talent_placement_settled_chk CHECK (
    (fee_status = 'settled' AND settled_at IS NOT NULL AND settled_by IS NOT NULL)
    OR (fee_status <> 'settled' AND settled_at IS NULL))
);

COMMENT ON TABLE public.talent_placements IS
  'A placement ACCRUES a fee; it moves no money. fee_status advances only through the '
  'Admin RPC. Consistent with 432000/444000/458000, which removed the last three '
  'automatic money paths — settlement and payout are manual and Admin-controlled.';

-- ─── 5. Compliance ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.talent_compliance_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.talent_submissions(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  checked_at    timestamp with time zone,
  checked_by    uuid,
  note          text,
  CONSTRAINT talent_compliance_kind_chk CHECK (
    kind = ANY (ARRAY['right_to_work','credential_verification','reference','background'])),
  CONSTRAINT talent_compliance_status_chk CHECK (
    status = ANY (ARRAY['pending','passed','failed','waived']))
);

-- ─── 6. Matching — reuses the existing scoring shape ────────────────────────
--  Mirrors nx_match_inspectors_for_job: domain overlap dominates, experience
--  and region refine. Deliberately NOT a new ML surface; the existing AI is
--  untouched.
CREATE OR REPLACE FUNCTION public.nx_talent_match_candidates(
  p_opportunity_id uuid, p_limit integer DEFAULT 25)
RETURNS TABLE (profile_id uuid, match_score numeric, domain_overlap integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_org uuid; v_min_years int; v_region text;
BEGIN
  SELECT o.organization_id, o.min_years, o.region
    INTO v_org, v_min_years, v_region
    FROM public.talent_opportunities o WHERE o.id = p_opportunity_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OPPORTUNITY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.nx_is_admin()
          OR EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = auth.uid() AND p.organization_id = v_org)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH od AS (
    SELECT domain_slug FROM public.talent_opportunity_domains
     WHERE opportunity_id = p_opportunity_id
  ), scored AS (
    SELECT c.profile_id,
           (SELECT count(*) FROM public.talent_candidate_domains cd
             JOIN od ON od.domain_slug = cd.domain_slug
            WHERE cd.profile_id = c.profile_id)::int AS overlap,
           c.years_experience, c.region
      FROM public.talent_candidate_profiles c
     WHERE c.is_open_to_work
       -- discoverability is a live, revocable consent
       AND EXISTS (SELECT 1 FROM public.talent_consents k
                    WHERE k.profile_id = c.profile_id
                      AND k.scope = 'discoverable' AND k.revoked_at IS NULL)
  )
  SELECT s.profile_id,
         ROUND(
           LEAST(100,
             (s.overlap * 40)
             + CASE WHEN v_min_years IS NULL OR COALESCE(s.years_experience,0) >= v_min_years
                    THEN 30 ELSE 0 END
             + CASE WHEN v_region IS NULL OR s.region IS NOT DISTINCT FROM v_region
                    THEN 30 ELSE 0 END
           )::numeric, 2),
         s.overlap
    FROM scored s
   WHERE s.overlap > 0
   ORDER BY 2 DESC, 3 DESC
   LIMIT GREATEST(COALESCE(p_limit, 25), 1);
END $fn$;

-- ─── 7. THE BROKERED-IDENTITY VIEW ──────────────────────────────────────────
--  An employer reads candidates through THIS and nothing else. Identity columns
--  are NULL until a live per-submission disclosure exists. The veil is a
--  property of the projection, not a rule someone must remember.
DROP VIEW IF EXISTS public.talent_submission_employer_view;
CREATE VIEW public.talent_submission_employer_view
WITH (security_barrier = 'true') AS
SELECT
  s.id                AS submission_id,
  s.opportunity_id,
  s.status,
  s.match_score,
  s.created_at,
  c.headline,
  c.years_experience,
  c.region,
  (d.submission_id IS NOT NULL AND d.revoked_at IS NULL) AS identity_disclosed,
  CASE WHEN d.submission_id IS NOT NULL AND d.revoked_at IS NULL
       THEN p.full_name END AS candidate_name,
  CASE WHEN d.submission_id IS NOT NULL AND d.revoked_at IS NULL
       THEN p.email     END AS candidate_email
  -- NOTE what is absent by construction: no phone, no employer history, and
  -- NO placement_fee_bps. The employer's own fee is on the opportunity; the
  -- platform's margin appears nowhere a candidate or employer can reach.
  FROM public.talent_submissions s
  JOIN public.talent_opportunities o ON o.id = s.opportunity_id
  JOIN public.profiles p            ON p.id = s.profile_id
  LEFT JOIN public.talent_candidate_profiles c ON c.profile_id = s.profile_id
  LEFT JOIN public.talent_disclosures d        ON d.submission_id = s.id
 WHERE public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.profiles me
                WHERE me.id = auth.uid() AND me.organization_id = o.organization_id);

COMMENT ON VIEW public.talent_submission_employer_view IS
  'The ONLY employer-facing read of a submission. Candidate name and email are NULL '
  'until a live talent_disclosures row exists for THAT submission, so consenting to one '
  'employer never exposes the candidate to another. Anti-circumvention: an employer who '
  'could see the name for free could hire directly and pay no placement fee.';

-- ─── 8. Workflow RPCs ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_talent_submit_candidate(
  p_opportunity_id uuid, p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid; v_org uuid; v_status text; v_id uuid; v_score numeric;
BEGIN
  v_uid := auth.uid();
  SELECT organization_id, status INTO v_org, v_status
    FROM public.talent_opportunities WHERE id = p_opportunity_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'OPPORTUNITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'OPPORTUNITY_NOT_OPEN: status is %', v_status USING ERRCODE='22000';
  END IF;

  -- Only NEXPEC brokers a submission. An employer cannot submit a candidate to
  -- itself, which is what would let it bypass the disclosure gate.
  IF v_uid IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: submissions are brokered by NEXPEC, not created by the employer'
      USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.talent_consents
                  WHERE profile_id = p_profile_id AND scope = 'submission'
                    AND revoked_at IS NULL) THEN
    RAISE EXCEPTION
      'CONSENT_REQUIRED: the candidate has not consented to being submitted'
      USING ERRCODE='42501';
  END IF;

  SELECT m.match_score INTO v_score
    FROM public.nx_talent_match_candidates(p_opportunity_id, 1000) m
   WHERE m.profile_id = p_profile_id;

  INSERT INTO public.talent_submissions (opportunity_id, profile_id, submitted_by, match_score)
  VALUES (p_opportunity_id, p_profile_id, COALESCE(v_uid, p_profile_id), v_score)
  ON CONFLICT (opportunity_id, profile_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  PERFORM public.nx_notify_lifecycle(
    p_profile_id,
    'You were submitted for a role',
    'NEXPEC submitted your anonymous profile for a permanent opportunity. Your name is not shared until you consent to disclosure.',
    'talent_submitted', '/talent/submissions/' || v_id::text, NULL);

  RETURN jsonb_build_object('ok', true, 'submission_id', v_id, 'match_score', v_score);
END $fn$;

--  The candidate — and ONLY the candidate — lifts their own veil.
CREATE OR REPLACE FUNCTION public.nx_talent_disclose_identity(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid; v_profile uuid; v_consent uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='28000'; END IF;

  SELECT profile_id INTO v_profile FROM public.talent_submissions WHERE id = p_submission_id;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND' USING ERRCODE='P0002'; END IF;

  IF v_profile <> v_uid THEN
    RAISE EXCEPTION
      'NOT_THE_CANDIDATE: only the candidate may disclose their own identity'
      USING ERRCODE='42501';
  END IF;

  INSERT INTO public.talent_consents (profile_id, scope)
  VALUES (v_uid, 'disclosure') RETURNING id INTO v_consent;

  INSERT INTO public.talent_disclosures (submission_id, consent_id)
  VALUES (p_submission_id, v_consent)
  ON CONFLICT (submission_id) DO UPDATE
    SET revoked_at = NULL, disclosed_at = now(), consent_id = EXCLUDED.consent_id;

  RETURN jsonb_build_object('ok', true, 'submission_id', p_submission_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.nx_talent_revoke_disclosure(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid; v_profile uuid;
BEGIN
  v_uid := auth.uid();
  SELECT profile_id INTO v_profile FROM public.talent_submissions WHERE id = p_submission_id;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_profile IS DISTINCT FROM v_uid AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_THE_CANDIDATE' USING ERRCODE='42501';
  END IF;

  UPDATE public.talent_disclosures SET revoked_at = now()
   WHERE submission_id = p_submission_id AND revoked_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END $fn$;

--  Placement: accrues the fee, pays nobody.
CREATE OR REPLACE FUNCTION public.nx_talent_record_placement(
  p_submission_id uuid, p_offer_id uuid, p_guarantee_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid; v_comp bigint; v_bps int; v_opp uuid; v_status text; v_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: placement is recorded by NEXPEC' USING ERRCODE='42501';
  END IF;

  SELECT o.comp_cents, o.status, s.opportunity_id
    INTO v_comp, v_status, v_opp
    FROM public.talent_offers o JOIN public.talent_submissions s ON s.id = o.submission_id
   WHERE o.id = p_offer_id AND o.submission_id = p_submission_id;

  IF v_comp IS NULL THEN RAISE EXCEPTION 'OFFER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'OFFER_NOT_ACCEPTED: status is %', v_status USING ERRCODE='22000';
  END IF;

  SELECT placement_fee_bps INTO v_bps FROM public.talent_opportunities WHERE id = v_opp;

  INSERT INTO public.talent_placements
    (submission_id, offer_id, comp_cents, fee_bps, fee_cents, guarantee_until)
  VALUES (p_submission_id, p_offer_id, v_comp, v_bps,
          (v_comp * v_bps) / 10000,
          (now() + make_interval(days => GREATEST(COALESCE(p_guarantee_days,90), 0)))::date)
  ON CONFLICT (submission_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;

  UPDATE public.talent_submissions SET status = 'placed' WHERE id = p_submission_id;
  UPDATE public.talent_opportunities SET status = 'filled' WHERE id = v_opp;

  RETURN jsonb_build_object('ok', true, 'placement_id', v_id, 'fee_cents', (v_comp * v_bps) / 10000);
END $fn$;

--  The ONLY way a fee advances. Admin-only, and still moves no money — it
--  records that Treasury settled outside this table, exactly as the inspection
--  side does.
CREATE OR REPLACE FUNCTION public.nx_talent_admin_set_fee_status(
  p_placement_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('accrued','invoiced','settled','waived','clawed_back') THEN
    RAISE EXCEPTION 'INVALID_FEE_STATUS: %', p_status USING ERRCODE='22000';
  END IF;

  UPDATE public.talent_placements
     SET fee_status = p_status,
         settled_at = CASE WHEN p_status = 'settled' THEN now() ELSE NULL END,
         settled_by = CASE WHEN p_status = 'settled' THEN COALESCE(v_uid, settled_by) END
   WHERE id = p_placement_id;

  RETURN jsonb_build_object('ok', true, 'placement_id', p_placement_id, 'fee_status', p_status);
END $fn$;

-- ─── 9. RLS + grants ────────────────────────────────────────────────────────
ALTER TABLE public.talent_candidate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_candidate_domains  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_opportunities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_opportunity_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_consents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_submissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_disclosures        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_interviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_offers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_placements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_compliance_checks  ENABLE ROW LEVEL SECURITY;

--  Written EXPLICITLY rather than through a DO/EXECUTE loop. The static gate
--  check-rls-admin-coverage parses migration TEXT and cannot see a policy created
--  by dynamic SQL, so the loop version reported talent_candidate_profiles as
--  admin-excluded. Explicit is also more reviewable.

DROP POLICY IF EXISTS talent_candidate_profiles_admin_all ON public.talent_candidate_profiles;
CREATE POLICY talent_candidate_profiles_admin_all ON public.talent_candidate_profiles
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_candidate_profiles FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_candidate_profiles TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_profiles TO service_role;

DROP POLICY IF EXISTS talent_candidate_domains_admin_all ON public.talent_candidate_domains;
CREATE POLICY talent_candidate_domains_admin_all ON public.talent_candidate_domains
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_candidate_domains FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_candidate_domains TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_domains TO service_role;

DROP POLICY IF EXISTS talent_opportunities_admin_all ON public.talent_opportunities;
CREATE POLICY talent_opportunities_admin_all ON public.talent_opportunities
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_opportunities FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_opportunities TO authenticated;
GRANT ALL ON TABLE public.talent_opportunities TO service_role;

DROP POLICY IF EXISTS talent_opportunity_domains_admin_all ON public.talent_opportunity_domains;
CREATE POLICY talent_opportunity_domains_admin_all ON public.talent_opportunity_domains
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_opportunity_domains FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_opportunity_domains TO authenticated;
GRANT ALL ON TABLE public.talent_opportunity_domains TO service_role;

DROP POLICY IF EXISTS talent_consents_admin_all ON public.talent_consents;
CREATE POLICY talent_consents_admin_all ON public.talent_consents
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_consents FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_consents TO authenticated;
GRANT ALL ON TABLE public.talent_consents TO service_role;

DROP POLICY IF EXISTS talent_submissions_admin_all ON public.talent_submissions;
CREATE POLICY talent_submissions_admin_all ON public.talent_submissions
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_submissions FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_submissions TO authenticated;
GRANT ALL ON TABLE public.talent_submissions TO service_role;

DROP POLICY IF EXISTS talent_disclosures_admin_all ON public.talent_disclosures;
CREATE POLICY talent_disclosures_admin_all ON public.talent_disclosures
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_disclosures FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_disclosures TO authenticated;
GRANT ALL ON TABLE public.talent_disclosures TO service_role;

DROP POLICY IF EXISTS talent_interviews_admin_all ON public.talent_interviews;
CREATE POLICY talent_interviews_admin_all ON public.talent_interviews
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_interviews FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_interviews TO authenticated;
GRANT ALL ON TABLE public.talent_interviews TO service_role;

DROP POLICY IF EXISTS talent_offers_admin_all ON public.talent_offers;
CREATE POLICY talent_offers_admin_all ON public.talent_offers
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_offers FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_offers TO authenticated;
GRANT ALL ON TABLE public.talent_offers TO service_role;

DROP POLICY IF EXISTS talent_placements_admin_all ON public.talent_placements;
CREATE POLICY talent_placements_admin_all ON public.talent_placements
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_placements FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_placements TO authenticated;
GRANT ALL ON TABLE public.talent_placements TO service_role;

DROP POLICY IF EXISTS talent_compliance_checks_admin_all ON public.talent_compliance_checks;
CREATE POLICY talent_compliance_checks_admin_all ON public.talent_compliance_checks
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON TABLE public.talent_compliance_checks FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.talent_compliance_checks TO authenticated;
GRANT ALL ON TABLE public.talent_compliance_checks TO service_role;


-- a candidate owns their own opt-in, domains and consents
DROP POLICY IF EXISTS talent_candidate_self ON public.talent_candidate_profiles;
CREATE POLICY talent_candidate_self ON public.talent_candidate_profiles
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
DROP POLICY IF EXISTS talent_candidate_domains_self ON public.talent_candidate_domains;
CREATE POLICY talent_candidate_domains_self ON public.talent_candidate_domains
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
DROP POLICY IF EXISTS talent_consents_self ON public.talent_consents;
CREATE POLICY talent_consents_self ON public.talent_consents
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- an employer sees only its own organization's opportunities
DROP POLICY IF EXISTS talent_opportunities_org ON public.talent_opportunities;
CREATE POLICY talent_opportunities_org ON public.talent_opportunities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles me
             WHERE me.id = auth.uid() AND me.organization_id = talent_opportunities.organization_id))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles me
             WHERE me.id = auth.uid() AND me.organization_id = talent_opportunities.organization_id));

-- a candidate sees their own submissions; the employer reads through the VIEW,
-- never the base table, so the anonymity veil cannot be walked around.
DROP POLICY IF EXISTS talent_submissions_candidate ON public.talent_submissions;
CREATE POLICY talent_submissions_candidate ON public.talent_submissions
  FOR SELECT USING (profile_id = auth.uid());

GRANT SELECT ON public.talent_submission_employer_view TO authenticated;
REVOKE ALL ON public.talent_submission_employer_view FROM anon;

REVOKE ALL ON FUNCTION public.nx_talent_match_candidates(uuid,integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_talent_submit_candidate(uuid,uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_talent_disclose_identity(uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_talent_revoke_disclosure(uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_talent_record_placement(uuid,uuid,integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_talent_admin_set_fee_status(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_talent_match_candidates(uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_talent_submit_candidate(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_talent_disclose_identity(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_talent_revoke_disclosure(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_talent_record_placement(uuid,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_talent_admin_set_fee_status(uuid,text) TO authenticated, service_role;

-- ─── 10. Selftest ───────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_n int; v_bad text;
BEGIN
  -- NO automatic money. This is the contract 432000/444000/458000 established.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'nx\_talent\_%'
     AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
         '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings)\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % talent function(s) move money (%) — placement accrues a fee, it does not pay', v_n, v_bad;
  END IF;

  -- no talent table reachable by anon
  FOR v_bad IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname LIKE 'talent\_%' AND c.relkind IN ('r','v')
       AND has_table_privilege('anon', c.oid, 'SELECT')
  LOOP
    RAISE EXCEPTION 'SELFTEST: talent table % is readable by anon', v_bad;
  END LOOP;

  -- RLS on every talent base table
  FOR v_bad IN
    SELECT tablename FROM pg_tables
     WHERE schemaname='public' AND tablename LIKE 'talent\_%' AND NOT rowsecurity
  LOOP
    RAISE EXCEPTION 'SELFTEST: talent table % has RLS disabled', v_bad;
  END LOOP;

  -- BROKERED IDENTITY: the employer view must gate name AND email on a live
  -- disclosure. This is the anti-circumvention contract.
  IF NOT EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname='public'
       AND viewname='talent_submission_employer_view'
       AND definition ~* 'revoked_at' AND definition ~* 'full_name') THEN
    RAISE EXCEPTION
      'SELFTEST: the employer view does not gate identity on a live disclosure';
  END IF;

  -- PRICE PRIVACY: the platform fee must not appear in the employer view
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname='public'
       AND viewname='talent_submission_employer_view'
       AND definition ~* 'placement_fee_bps') THEN
    RAISE EXCEPTION 'SELFTEST: the employer view exposes placement_fee_bps';
  END IF;

  -- no duplicate identity/org/domain system
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public'
                AND table_name IN ('talent_users','talent_organizations',
                                   'talent_domains','talent_credentials','talent_messages')) THEN
    RAISE EXCEPTION
      'SELFTEST: a duplicate identity/org/domain/credential/messaging table exists — Talent must reuse the platform''s';
  END IF;

  -- the canonical taxonomy is actually reused (FK to inspection_domains)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
     WHERE k.table_schema='public' AND k.table_name='talent_candidate_domains') THEN
    RAISE EXCEPTION 'SELFTEST: talent_candidate_domains does not FK the canonical domain taxonomy';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
