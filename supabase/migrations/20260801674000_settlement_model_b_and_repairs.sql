-- ════════════════════════════════════════════════════════════════════════════
--  20260801674000_settlement_model_b_and_repairs.sql
--
--  PART 1 — a SECOND settlement model, selected per engagement.
--
--    Model A  'split'         NEXPEC pays the inspector their payout AND pays
--                             Agency B its own commission.
--    Model B  'agency_total'  NEXPEC pays Agency B ONE total for the service.
--                             Agency B pays its inspector under its own
--                             agreement. NEXPEC owes the inspector NOTHING.
--
--  THE INVARIANT THAT MATTERS MOST: in Model B there must be no NEXPEC
--  inspector payable and no separate commission — one obligation only.
--  Paying Agency B does NOT mean the inspector has been paid, and nothing in
--  this schema may imply that it does.
--
--  The inspector's compensation under Model B is recorded — when NEXPEC knows
--  it — in its OWN column, inspector_agency_comp_cents, which is explicitly
--  AGENCY-PAYABLE. It is never used to create a NEXPEC obligation and is never
--  derived from the agency total. If NEXPEC does not know it, it stays NULL and
--  the inspector is told the agency is responsible, rather than being shown an
--  invented number.
--
--  PART 2 — outstanding repairs from the cross-role audit that are fixable in
--  the database: work-history and client-feedback interop, and a writer for
--  supplier verification.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════ PART 1: SETTLEMENT MODEL ══════════════════════════════

ALTER TABLE public.engagement_commercials
  ADD COLUMN IF NOT EXISTS settlement_model text NOT NULL DEFAULT 'split',
  ADD COLUMN IF NOT EXISTS agency_total_cents bigint NOT NULL DEFAULT 0,
  -- What Agency B has told NEXPEC it will pay its inspector, in Model B.
  -- AGENCY-PAYABLE. Never a NEXPEC obligation. NULL = not disclosed to NEXPEC.
  ADD COLUMN IF NOT EXISTS inspector_agency_comp_cents bigint;

COMMENT ON COLUMN public.engagement_commercials.settlement_model IS
  'split = NEXPEC pays inspector + pays partner a commission. '
  'agency_total = NEXPEC pays Agency B one service total; Agency B pays its '
  'inspector under its own agreement and NEXPEC owes the inspector nothing.';

COMMENT ON COLUMN public.engagement_commercials.inspector_agency_comp_cents IS
  'Model B only. What Agency B says it will pay its inspector. AGENCY-PAYABLE, '
  'never a NEXPEC payable, never derived from agency_total_cents, and never '
  'shown as a NEXPEC payout. NULL when NEXPEC has not been told.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_settlement_model_enum') THEN
    ALTER TABLE public.engagement_commercials
      ADD CONSTRAINT engagement_settlement_model_enum
      CHECK (settlement_model IN ('split','agency_total'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_amounts_nonneg') THEN
    ALTER TABLE public.engagement_commercials
      ADD CONSTRAINT engagement_amounts_nonneg
      CHECK (agency_total_cents >= 0
         AND (inspector_agency_comp_cents IS NULL OR inspector_agency_comp_cents >= 0));
  END IF;

  -- THE MODEL SEPARATION. A row can only ever describe ONE model, so a mixed
  -- payload is rejected by the database rather than by a UI branch.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_model_shape') THEN
    ALTER TABLE public.engagement_commercials
      ADD CONSTRAINT engagement_model_shape CHECK (
        (settlement_model = 'split'
          AND agency_total_cents = 0
          AND inspector_agency_comp_cents IS NULL)
        OR
        (settlement_model = 'agency_total'
          AND inspector_payout_cents = 0        -- no NEXPEC inspector payable
          AND partner_commission_cents = 0      -- no separate commission
          AND partner_id IS NOT NULL)           -- there must be an agency to pay
      );
  END IF;

  -- A presented or accepted Model B row must actually carry a total. A draft
  -- may still be incomplete while an admin is filling it in.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_model_b_total_required') THEN
    ALTER TABLE public.engagement_commercials
      ADD CONSTRAINT engagement_model_b_total_required CHECK (
        settlement_model <> 'agency_total'
        OR status = 'draft'
        OR agency_total_cents > 0
      );
  END IF;
END $$;

-- Obligation kind, so a report never has to infer what a payable represents.
ALTER TABLE public.settlement_obligations
  ADD COLUMN IF NOT EXISTS obligation_kind text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='settlement_obligation_kind_enum') THEN
    ALTER TABLE public.settlement_obligations
      ADD CONSTRAINT settlement_obligation_kind_enum
      CHECK (obligation_kind IS NULL OR obligation_kind IN
        ('inspector_payout','partner_commission','agency_service_total'));
  END IF;
END $$;

UPDATE public.settlement_obligations
   SET obligation_kind = CASE beneficiary_role
                           WHEN 'inspector' THEN 'inspector_payout'
                           ELSE 'partner_commission' END
 WHERE obligation_kind IS NULL;

-- ── Party views rebuilt for both models ───────────────────────────────────
-- The partner sees ONE amount whose meaning is named by settlement_model. The
-- inspector sees their OWN compensation and WHO OWES IT — never the agency
-- gross, in either model.
DROP VIEW IF EXISTS public.engagement_partner_view;
CREATE VIEW public.engagement_partner_view AS
  SELECT c.id, c.job_id, c.version, c.status, c.currency, c.settlement_model,
         CASE c.settlement_model
           WHEN 'agency_total' THEN c.agency_total_cents
           ELSE c.partner_commission_cents
         END AS partner_amount_cents,
         -- Kept for compatibility with the Model A surface already shipped.
         c.partner_commission_cents,
         -- In Model B the agency manages this compensation, so it may see it.
         -- In Model A it is NULL by construction, so nominating an inspector
         -- never reveals what NEXPEC pays them.
         CASE WHEN c.settlement_model = 'agency_total'
              THEN c.inspector_agency_comp_cents END AS inspector_agency_comp_cents,
         c.pricing_basis, c.scope_units, c.scope_note,
         c.terms_version, c.presented_at, c.accepted_at, c.created_at
    FROM public.engagement_commercials c
   WHERE c.partner_id = auth.uid()
     AND public.nx_is_partner_agency()
     AND c.status IN ('presented','accepted','superseded');

DROP VIEW IF EXISTS public.engagement_inspector_view;
CREATE VIEW public.engagement_inspector_view AS
  SELECT c.id, c.job_id, c.version, c.status, c.currency, c.settlement_model,
         -- The inspector's OWN compensation. In Model B this is the
         -- agency-payable figure, NOT the agency's gross total.
         CASE c.settlement_model
           WHEN 'agency_total' THEN c.inspector_agency_comp_cents
           ELSE c.inspector_payout_cents
         END AS inspector_amount_cents,
         -- Who actually owes it. This is why the agency total can never be
         -- mistaken for a NEXPEC payout.
         CASE c.settlement_model
           WHEN 'agency_total' THEN 'AGENCY'
           ELSE 'NEXPEC'
         END AS paid_by,
         c.pricing_basis, c.scope_units, c.scope_note,
         c.terms_version, c.presented_at, c.accepted_at, c.created_at
    FROM public.engagement_commercials c
   WHERE c.inspector_id = auth.uid()
     AND c.status IN ('presented','accepted','superseded');

REVOKE ALL ON public.engagement_partner_view, public.engagement_inspector_view FROM anon;
GRANT SELECT ON public.engagement_partner_view, public.engagement_inspector_view TO authenticated;

-- ═══════════════════ PART 2: OUTSTANDING AUDIT REPAIRS ═════════════════════

-- ── work_experience <-> inspector_work_experience ─────────────────────────
-- Mobile writes public.work_experience; the web inspector page writes
-- public.inspector_work_experience; the CLIENT's applicant-review screen reads
-- public.work_experience. So a web-entered work history was invisible to the
-- client evaluating that applicant. Same adapter shape as 20260801666000.
CREATE OR REPLACE FUNCTION public.nx_mirror_work_experience()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.inspector_work_experience
    (inspector_id, company_name, job_title, start_date, end_date, description)
  SELECT NEW.user_id, NEW.company_name, NEW.job_title, NEW.start_date, NEW.end_date, NEW.description
   WHERE NOT EXISTS (
     SELECT 1 FROM public.inspector_work_experience w
      WHERE w.inspector_id = NEW.user_id
        AND w.company_name = NEW.company_name
        AND w.job_title IS NOT DISTINCT FROM NEW.job_title
        AND w.start_date IS NOT DISTINCT FROM NEW.start_date);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nx_mirror_inspector_work_experience()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.inspector_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.work_experience
    (user_id, company_name, job_title, start_date, end_date, description)
  SELECT NEW.inspector_id, NEW.company_name, NEW.job_title, NEW.start_date, NEW.end_date, NEW.description
   WHERE NOT EXISTS (
     SELECT 1 FROM public.work_experience w
      WHERE w.user_id = NEW.inspector_id
        AND w.company_name = NEW.company_name
        AND w.job_title IS NOT DISTINCT FROM NEW.job_title
        AND w.start_date IS NOT DISTINCT FROM NEW.start_date);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_work_experience ON public.work_experience;
CREATE TRIGGER trg_mirror_work_experience
  AFTER INSERT ON public.work_experience
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_work_experience();

DROP TRIGGER IF EXISTS trg_mirror_inspector_work_experience ON public.inspector_work_experience;
CREATE TRIGGER trg_mirror_inspector_work_experience
  AFTER INSERT ON public.inspector_work_experience
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_inspector_work_experience();

-- ── applications.client_feedback -> client_notes ──────────────────────────
-- The mobile client's nomination comment is written to client_feedback, while
-- EVERY admin surface reads client_notes. The comment the client wrote to the
-- admin was never seen by the admin. One-way: client_notes is what admins read
-- and may themselves edit, so mirroring back would let a mobile write clobber
-- an admin's own note.
CREATE OR REPLACE FUNCTION public.nx_mirror_client_feedback()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.client_feedback IS NOT NULL
     AND btrim(NEW.client_feedback) <> ''
     AND (NEW.client_notes IS NULL OR btrim(NEW.client_notes) = '') THEN
    NEW.client_notes := NEW.client_feedback;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_client_feedback ON public.applications;
CREATE TRIGGER trg_mirror_client_feedback
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.nx_mirror_client_feedback();

UPDATE public.applications
   SET client_notes = client_feedback
 WHERE client_feedback IS NOT NULL AND btrim(client_feedback) <> ''
   AND (client_notes IS NULL OR btrim(client_notes) = '');

-- ── A writer for supplier verification ────────────────────────────────────
-- supplier_profiles.verification is read by four surfaces but written by
-- nothing, so every vendor was permanently "Pending review" with no way out.
CREATE OR REPLACE FUNCTION public.nx_admin_set_supplier_verification(
  p_supplier_id uuid, p_verified boolean, p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'nx_admin_set_supplier_verification: admin only' USING ERRCODE='42501';
  END IF;
  UPDATE public.supplier_profiles
     SET verification = CASE WHEN p_verified
           THEN jsonb_build_object('verified_at', to_jsonb(now()),
                                   'verified_by', to_jsonb(auth.uid()),
                                   'note', to_jsonb(coalesce(p_note,'')))
           ELSE jsonb_build_object('verified_at', 'null'::jsonb,
                                   'revoked_at', to_jsonb(now()),
                                   'revoked_by', to_jsonb(auth.uid()),
                                   'note', to_jsonb(coalesce(p_note,''))) END,
         updated_at = now()
   WHERE id = p_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no supplier profile for that account' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('supplier.verification_changed', 'warning', auth.uid(), p_supplier_id,
          'supplier_profiles',
          CASE WHEN p_verified THEN 'Vendor marked verified' ELSE 'Vendor verification revoked' END,
          jsonb_build_object('verified', p_verified, 'note', p_note));
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.nx_admin_set_supplier_verification(uuid,boolean,text) FROM anon;

COMMIT;
