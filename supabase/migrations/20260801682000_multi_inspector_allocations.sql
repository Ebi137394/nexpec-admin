-- ════════════════════════════════════════════════════════════════════════════
--  20260801682000_multi_inspector_allocations.sql
--
--  UNIQUE (commercial_id, beneficiary_role) admitted exactly ONE inspector
--  obligation per commercial version, so a two-inspector engagement silently
--  lost the second person's payable. The guard is not weakened — it is made
--  precise:
--
--    OLD  UNIQUE (commercial_id, beneficiary_role)
--    NEW  UNIQUE (commercial_id, beneficiary_role, beneficiary_id)
--         + partial UNIQUE (commercial_id)
--             WHERE obligation_kind IN ('partner_commission','agency_service_total')
--
--  The first stops the same beneficiary being paid twice for one version. The
--  second is the important one: the agency is paid ONCE per engagement no
--  matter how many inspectors are nominated or how many times confirm is
--  replayed — a commission must never multiply per nomination or per visit.
--
--  ── ALLOCATIONS ────────────────────────────────────────────────────────────
--  engagement_allocations splits the agreed inspector cost across named
--  people. Its meaning depends on the settlement model, and the two are never
--  mixed:
--
--    Model A 'split'         each allocation is a NEXPEC payable to that
--                            inspector, and the allocations must sum exactly to
--                            inspector_payout_cents (the accepted total).
--    Model B 'agency_total'  each allocation is what AGENCY B pays that
--                            inspector. It creates NO NEXPEC obligation and is
--                            never derived from the agency total.
--
--  Backward compatible: with no allocation rows the existing single-inspector
--  behaviour is unchanged, so every current consumer keeps working.
--
--  ── ACCEPTANCE ─────────────────────────────────────────────────────────────
--  engagement_acceptances was UNIQUE (commercial_id, party_role), which let
--  only ONE inspector accept. It becomes UNIQUE (commercial_id, party_role,
--  party_id) so each named inspector accepts for themselves.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.engagement_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_id uuid NOT NULL REFERENCES public.engagement_commercials(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  inspector_id  uuid NOT NULL REFERENCES public.profiles(id),
  amount_cents  bigint NOT NULL CHECK (amount_cents >= 0),
  currency      text NOT NULL DEFAULT 'USD',
  visits        integer CHECK (visits IS NULL OR visits > 0),
  note          text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One allocation per inspector per version. A second visit for the same
  -- person raises their allocation; it does not create a second row, so a
  -- replayed visit cannot become a second payable.
  CONSTRAINT engagement_allocations_once UNIQUE (commercial_id, inspector_id)
);

COMMENT ON TABLE public.engagement_allocations IS
  'Per-inspector split of an engagement. In Model A each row is a NEXPEC '
  'payable and the rows must sum to inspector_payout_cents. In Model B each '
  'row is what AGENCY B pays that inspector: it creates no NEXPEC obligation '
  'and is never derived from agency_total_cents.';

ALTER TABLE public.engagement_allocations ENABLE ROW LEVEL SECURITY;

-- An inspector sees ONLY their own allocation. The partner sees allocations it
-- manages, and only under Model B where it is the payer.
DROP POLICY IF EXISTS engagement_allocations_read ON public.engagement_allocations;
CREATE POLICY engagement_allocations_read ON public.engagement_allocations
  FOR SELECT TO authenticated USING (
    public.nx_is_admin()
    OR inspector_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.engagement_commercials c
       WHERE c.id = engagement_allocations.commercial_id
         AND c.partner_id = auth.uid()
         AND c.settlement_model = 'agency_total')
  );

DROP POLICY IF EXISTS engagement_allocations_admin ON public.engagement_allocations;
CREATE POLICY engagement_allocations_admin ON public.engagement_allocations
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

REVOKE ALL ON public.engagement_allocations FROM anon;
GRANT SELECT ON public.engagement_allocations TO authenticated;

CREATE INDEX IF NOT EXISTS engagement_allocations_inspector_idx
  ON public.engagement_allocations (inspector_id);

-- ── Precise duplicate-payment guards ──────────────────────────────────────
ALTER TABLE public.settlement_obligations
  DROP CONSTRAINT IF EXISTS settlement_obligations_once;

CREATE UNIQUE INDEX IF NOT EXISTS settlement_obligations_per_beneficiary
  ON public.settlement_obligations (commercial_id, beneficiary_role, beneficiary_id);

-- The agency is paid ONCE per version regardless of nominations, visits or
-- confirm replays. This is what stops a commission multiplying.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_obligations_one_agency_payment
  ON public.settlement_obligations (commercial_id)
  WHERE obligation_kind IN ('partner_commission','agency_service_total');

-- ── One acceptance per PERSON, not per role ───────────────────────────────
ALTER TABLE public.engagement_acceptances
  DROP CONSTRAINT IF EXISTS engagement_acceptances_once;

CREATE UNIQUE INDEX IF NOT EXISTS engagement_acceptances_per_party
  ON public.engagement_acceptances (commercial_id, party_role, party_id);

-- ── Inspector view: show the viewer's OWN allocation when there is one ────
DROP VIEW IF EXISTS public.engagement_inspector_view;
CREATE VIEW public.engagement_inspector_view AS
  SELECT c.id, c.job_id, c.version, c.status, c.currency, c.settlement_model,
         -- Their own allocation if the engagement is split across people,
         -- otherwise the single-inspector amount. Never the engagement total
         -- and never the agency gross.
         COALESCE(
           (SELECT a.amount_cents FROM public.engagement_allocations a
             WHERE a.commercial_id = c.id AND a.inspector_id = auth.uid()),
           CASE c.settlement_model
             WHEN 'agency_total' THEN c.inspector_agency_comp_cents
             ELSE c.inspector_payout_cents
           END
         ) AS inspector_amount_cents,
         CASE c.settlement_model
           WHEN 'agency_total' THEN 'AGENCY'
           ELSE 'NEXPEC'
         END AS paid_by,
         EXISTS (SELECT 1 FROM public.engagement_allocations a
                  WHERE a.commercial_id = c.id AND a.inspector_id = auth.uid())
           AS is_allocated,
         c.pricing_basis, c.scope_units, c.scope_note,
         c.terms_version, c.presented_at, c.accepted_at, c.created_at
    FROM public.engagement_commercials c
   WHERE c.status IN ('presented','accepted','superseded')
     AND (
       c.inspector_id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.engagement_allocations a
                   WHERE a.commercial_id = c.id AND a.inspector_id = auth.uid())
     );

REVOKE ALL ON public.engagement_inspector_view FROM anon;
GRANT SELECT ON public.engagement_inspector_view TO authenticated;

COMMIT;
