-- ════════════════════════════════════════════════════════════════════════════
--  20260801670000_partner_agency_rls_and_rpcs.sql
--
--  Access control and the workflow for partner-agency engagements.
--
--  ── THE CONFIDENTIALITY RULE ───────────────────────────────────────────────
--  No party may learn another party's amount. This is enforced at the DATABASE,
--  not in the UI:
--
--    engagement_commercials (base table)  ADMIN ONLY. No party reads it.
--    engagement_customer_view             customer_amount_cents only
--    engagement_partner_view              partner_commission_cents only
--    engagement_inspector_view            inspector_payout_cents only
--
--  Each view names exactly the one money column that party is entitled to, so
--  a forgotten UI guard, a raw PostgREST call, an export, a PDF or a mobile
--  payload cannot leak the others — the column is not in the result set at all.
--
--  The views follow the pattern already established by rfq_client_offers_view:
--  they are NOT security_invoker, so they run as owner and apply their own
--  explicit auth.uid() predicate. A security_invoker view would inherit the
--  admin-only base policy and return nothing to the very parties it exists for.
--
--  ── CAPABILITY AND JOB-LEVEL PERMISSION ────────────────────────────────────
--  Partner visibility requires ALL of:
--    1. an approved public.partner_agencies row  (capability)
--    2. customer consent AND admin approval on that job (job_partner_policy)
--    3. an invitation to THAT job (partner_opportunities)
--  Opening a portal route is not sufficient and is not relied on anywhere here.
--  Nothing in this migration reads profiles.role.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_partner_agency(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_agencies pa
     WHERE pa.partner_id = p_user AND pa.status = 'approved');
$$;

-- A partner may see a job ONLY through a live invitation on a job whose
-- customer consented and which an admin approved. All three, every time.
CREATE OR REPLACE FUNCTION public.nx_partner_sees_job(p_job uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.partner_opportunities o
      JOIN public.job_partner_policy pol ON pol.job_id = o.job_id
      JOIN public.partner_agencies pa    ON pa.partner_id = o.partner_id
     WHERE o.job_id = p_job
       AND o.partner_id = p_user
       AND o.status <> 'closed'
       AND pa.status = 'approved'
       AND pol.customer_consented IS TRUE
       AND pol.admin_approved IS TRUE);
$$;

REVOKE EXECUTE ON FUNCTION public.nx_is_partner_agency(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_partner_sees_job(uuid, uuid) FROM anon;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.partner_agencies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_partner_policy      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_nominations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_commercials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_acceptances  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_obligations  ENABLE ROW LEVEL SECURITY;

-- partner_agencies: a partner sees only its own standing; admin manages.
DROP POLICY IF EXISTS partner_agencies_self ON public.partner_agencies;
CREATE POLICY partner_agencies_self ON public.partner_agencies
  FOR SELECT TO authenticated USING (partner_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS partner_agencies_admin ON public.partner_agencies;
CREATE POLICY partner_agencies_admin ON public.partner_agencies
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- job_partner_policy: the job's owner may read and set CONSENT; only an admin
-- may approve. Split so a customer cannot self-approve distribution.
DROP POLICY IF EXISTS job_partner_policy_owner ON public.job_partner_policy;
CREATE POLICY job_partner_policy_owner ON public.job_partner_policy
  FOR SELECT TO authenticated USING (
    public.nx_is_admin() OR EXISTS (
      SELECT 1 FROM public.jobs j WHERE j.id = job_partner_policy.job_id
        AND (j.client_id = auth.uid() OR j.agency_id = auth.uid())));
DROP POLICY IF EXISTS job_partner_policy_admin ON public.job_partner_policy;
CREATE POLICY job_partner_policy_admin ON public.job_partner_policy
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- partner_opportunities: a partner sees ONLY its own invitations.
DROP POLICY IF EXISTS partner_opportunities_own ON public.partner_opportunities;
CREATE POLICY partner_opportunities_own ON public.partner_opportunities
  FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR (partner_id = auth.uid() AND public.nx_is_partner_agency()));
DROP POLICY IF EXISTS partner_opportunities_admin ON public.partner_opportunities;
CREATE POLICY partner_opportunities_admin ON public.partner_opportunities
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- partner_nominations: the nominating partner, the named inspector, and admin.
-- The inspector can see that they were nominated; nobody else can.
DROP POLICY IF EXISTS partner_nominations_parties ON public.partner_nominations;
CREATE POLICY partner_nominations_parties ON public.partner_nominations
  FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR partner_id = auth.uid() OR inspector_id = auth.uid());
DROP POLICY IF EXISTS partner_nominations_admin ON public.partner_nominations;
CREATE POLICY partner_nominations_admin ON public.partner_nominations
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- engagement_commercials: ADMIN ONLY. Parties read their own view instead.
DROP POLICY IF EXISTS engagement_commercials_admin ON public.engagement_commercials;
CREATE POLICY engagement_commercials_admin ON public.engagement_commercials
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- engagement_acceptances: a party sees its own; admin sees all.
DROP POLICY IF EXISTS engagement_acceptances_own ON public.engagement_acceptances;
CREATE POLICY engagement_acceptances_own ON public.engagement_acceptances
  FOR SELECT TO authenticated USING (public.nx_is_admin() OR party_id = auth.uid());
DROP POLICY IF EXISTS engagement_acceptances_admin ON public.engagement_acceptances;
CREATE POLICY engagement_acceptances_admin ON public.engagement_acceptances
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- settlement_obligations: a beneficiary sees ONLY its own obligation.
DROP POLICY IF EXISTS settlement_obligations_own ON public.settlement_obligations;
CREATE POLICY settlement_obligations_own ON public.settlement_obligations
  FOR SELECT TO authenticated USING (public.nx_is_admin() OR beneficiary_id = auth.uid());
DROP POLICY IF EXISTS settlement_obligations_admin ON public.settlement_obligations;
CREATE POLICY settlement_obligations_admin ON public.settlement_obligations
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- No anonymous access to any of it.
REVOKE ALL ON public.partner_agencies, public.job_partner_policy,
  public.partner_opportunities, public.partner_nominations,
  public.engagement_commercials, public.engagement_acceptances,
  public.settlement_obligations FROM anon;

GRANT SELECT ON public.partner_agencies, public.job_partner_policy,
  public.partner_opportunities, public.partner_nominations,
  public.engagement_acceptances, public.settlement_obligations TO authenticated;
-- engagement_commercials is deliberately NOT granted to authenticated: the
-- only way to read money on an engagement is through a party view.
GRANT SELECT ON public.engagement_commercials TO service_role;

-- ── Per-party views: one money column each ────────────────────────────────
DROP VIEW IF EXISTS public.engagement_customer_view;
CREATE VIEW public.engagement_customer_view AS
  SELECT c.id, c.job_id, c.version, c.status, c.currency,
         c.customer_amount_cents,          -- the ONLY amount a customer sees
         c.pricing_basis, c.scope_units, c.scope_note,
         c.expenses_note, c.tax_note, c.terms_version,
         c.presented_at, c.accepted_at, c.created_at,
         (c.partner_id IS NOT NULL) AS has_partner
    FROM public.engagement_commercials c
   WHERE c.customer_id = auth.uid()
     AND c.status IN ('presented','accepted','superseded');

DROP VIEW IF EXISTS public.engagement_partner_view;
CREATE VIEW public.engagement_partner_view AS
  SELECT c.id, c.job_id, c.version, c.status, c.currency,
         c.partner_commission_cents,       -- the ONLY amount a partner sees
         c.pricing_basis, c.scope_units, c.scope_note,
         c.terms_version, c.presented_at, c.accepted_at, c.created_at
    FROM public.engagement_commercials c
   WHERE c.partner_id = auth.uid()
     AND public.nx_is_partner_agency()
     AND c.status IN ('presented','accepted','superseded');

DROP VIEW IF EXISTS public.engagement_inspector_view;
CREATE VIEW public.engagement_inspector_view AS
  SELECT c.id, c.job_id, c.version, c.status, c.currency,
         c.inspector_payout_cents,         -- the ONLY amount an inspector sees
         c.pricing_basis, c.scope_units, c.scope_note,
         c.terms_version, c.presented_at, c.accepted_at, c.created_at
    FROM public.engagement_commercials c
   WHERE c.inspector_id = auth.uid()
     AND c.status IN ('presented','accepted','superseded');

REVOKE ALL ON public.engagement_customer_view, public.engagement_partner_view,
  public.engagement_inspector_view FROM anon;
GRANT SELECT ON public.engagement_customer_view, public.engagement_partner_view,
  public.engagement_inspector_view TO authenticated;

COMMIT;
