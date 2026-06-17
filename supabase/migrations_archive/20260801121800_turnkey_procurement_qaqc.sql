-- ════════════════════════════════════════════════════════════════════════════
--  20260801121800_turnkey_procurement_qaqc.sql
--
--  TURNKEY (A→Z) PROCUREMENT + QA/QC
--
--  NEXPEC isn't a directory — it sources the item AND dispatches the inspector.
--  An RFQ now carries an inspection dimension (which discipline/scope to inspect
--  at the supplier's facility). The moment a quote is ACCEPTED, a source/FAT
--  inspection job is AUTO-SPAWNED into the existing `jobs` table, discipline-
--  matched via the scope catalogue, located at the supplier facility, and dropped
--  into the existing admin-brokered dispatch (admin assigns the matched inspector
--  + sets the price-blind payout). Golden rules preserved.
--
--    1. RFQ inspection dimension  scope_template_id · requires_source_inspection · spawned_job_id
--    2. jobs back-ref             source_rfq_id (bidirectional link)
--    3. auto-spawn trigger        accept quote → create source/FAT job (idempotent)
--    4. award_quote RPC           authorize + accept (fires the trigger) → returns the job
--    5. self-test                 columns + trigger + RPC installed
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) RFQ gains the inspection dimension (the cross-discipline bridge) ──
ALTER TABLE public.supplier_rfqs
  ADD COLUMN IF NOT EXISTS scope_template_id uuid REFERENCES public.inspection_scope_templates(id) ON DELETE SET NULL;
ALTER TABLE public.supplier_rfqs
  ADD COLUMN IF NOT EXISTS requires_source_inspection boolean NOT NULL DEFAULT true;
ALTER TABLE public.supplier_rfqs
  ADD COLUMN IF NOT EXISTS spawned_job_id uuid;

-- ── 2) jobs back-ref to the originating RFQ ──
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_rfq_id uuid REFERENCES public.supplier_rfqs(id) ON DELETE SET NULL;

-- spawned_job_id FK (added once both tables exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_rfqs_spawned_job_fk') THEN
    ALTER TABLE public.supplier_rfqs
      ADD CONSTRAINT supplier_rfqs_spawned_job_fk FOREIGN KEY (spawned_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jobs_source_rfq_idx ON public.jobs (source_rfq_id) WHERE source_rfq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rfq_scope_idx       ON public.supplier_rfqs (scope_template_id) WHERE scope_template_id IS NOT NULL;

-- ── 3) The automation: accepted quote → source/FAT inspection job ──
CREATE OR REPLACE FUNCTION public._spawn_inspection_for_award()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rfq   public.supplier_rfqs;
  v_sup   public.supplier_profiles;
  v_job_id uuid;
  v_itype text;
  v_title text;
BEGIN
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = NEW.rfq_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- idempotent: never spawn twice for the same RFQ
  IF v_rfq.spawned_job_id IS NOT NULL THEN RETURN NEW; END IF;

  -- always settle the RFQ + losing quotes on acceptance
  UPDATE public.supplier_quotes
     SET status = 'declined'
   WHERE rfq_id = v_rfq.id AND id <> NEW.id AND status NOT IN ('declined','withdrawn');

  -- some RFQs are pure procurement (no inspection requested)
  IF coalesce(v_rfq.requires_source_inspection, true) = false THEN
    UPDATE public.supplier_rfqs SET status = 'awarded' WHERE id = v_rfq.id AND status <> 'awarded';
    RETURN NEW;
  END IF;

  SELECT * INTO v_sup FROM public.supplier_profiles WHERE id = NEW.supplier_id;

  -- compliance ⇒ scope set; quality ⇒ scope null  (satisfies jobs_compliance_requires_template)
  v_itype := CASE WHEN v_rfq.scope_template_id IS NOT NULL THEN 'compliance' ELSE 'quality' END;
  v_title := left('Source / FAT inspection — ' || coalesce(v_rfq.title, 'RFQ'), 200);

  INSERT INTO public.jobs (
    title, description, status, moderation_status, inspection_type, scope_template_id,
    client_id, contractor_id, price_cents, payout_status, escrow_status, job_type, urgency,
    latitude, longitude, location, job_country, source_rfq_id
  ) VALUES (
    v_title,
    'Auto-generated from an awarded RFQ. Inspect the fabrication/service at the supplier facility (FAT / QA-QC) before shipment. Discipline is set by the RFQ scope; admin assigns the matched inspector and payout.',
    'open', 'pending_review', v_itype, v_rfq.scope_template_id,
    v_rfq.client_id, NULL, 0, 'unpaid', 'pending', 'on_site', 'normal',
    v_sup.geo_lat, v_sup.geo_lng, coalesce(v_sup.legal_name, 'Supplier facility'), v_sup.country_code,
    v_rfq.id
  )
  RETURNING id INTO v_job_id;

  UPDATE public.supplier_rfqs
     SET status = 'awarded', spawned_job_id = v_job_id
   WHERE id = v_rfq.id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_spawn_inspection_on_award ON public.supplier_quotes;
CREATE TRIGGER trg_spawn_inspection_on_award
  AFTER UPDATE OF status ON public.supplier_quotes
  FOR EACH ROW
  WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION public._spawn_inspection_for_award();

-- ── 4) award_quote — the client (or admin) accepts a bid; trigger does the rest ──
CREATE OR REPLACE FUNCTION public.award_quote(p_quote_id uuid)
RETURNS public.jobs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_q public.supplier_quotes; v_rfq public.supplier_rfqs; v_job public.jobs;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_quote'; END IF;
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id;
  IF NOT (v_rfq.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_rfq.status NOT IN ('open','quoted') THEN RAISE EXCEPTION 'rfq_not_awardable'; END IF;

  UPDATE public.supplier_quotes SET status = 'accepted' WHERE id = p_quote_id;   -- fires the spawn trigger

  SELECT * INTO v_job FROM public.jobs WHERE source_rfq_id = v_rfq.id ORDER BY created_at DESC LIMIT 1;
  RETURN v_job;   -- NULL when requires_source_inspection = false (pure procurement)
END $$;

REVOKE ALL ON FUNCTION public.award_quote(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.award_quote(uuid) TO authenticated;

-- ── 5) SELF-TEST (structural — the live functional proof is awarding a quote) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_rfqs' AND column_name='scope_template_id') THEN
    RAISE EXCEPTION 'SELFTEST supplier_rfqs.scope_template_id missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='source_rfq_id') THEN
    RAISE EXCEPTION 'SELFTEST jobs.source_rfq_id missing'; END IF;
  IF to_regprocedure('public.award_quote(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST award_quote missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_spawn_inspection_on_award') THEN
    RAISE EXCEPTION 'SELFTEST spawn trigger missing'; END IF;
  RAISE NOTICE 'Turnkey procurement→QA/QC installed: RFQ inspection dimension + job back-ref + auto-spawn trigger + award_quote.';
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- DATA FLOW (A→Z):
--   client → create_rfq(title, spec, scope_template_id, requires_source_inspection)
--          → suppliers submit_quote(...)
--          → client award_quote(quote_id)
--              ├─ trigger spawns jobs row (source/FAT, discipline=scope, @supplier facility,
--              │   status open + pending_review, contractor NULL)  ← admin-brokered dispatch
--              ├─ losing quotes auto-declined
--              └─ rfq.spawned_job_id ↔ jobs.source_rfq_id linked
--   admin → (existing flow) match discipline-perfect inspector + set price-blind payout.
--
-- Note: if a future job-INSERT invariant is added, adjust _spawn_inspection_for_award only.
-- ─────────────────────────────────────────────────────────────────────────
