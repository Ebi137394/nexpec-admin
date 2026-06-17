-- ============================================================================
-- ATOMIC MIGRATION — escrow-pause guard + Sprint 12C (clauses) + 12D (contracts)
--
-- Three concerns, one transaction. Same bulletproof pattern: every block
-- wrapped in DO $$ ... EXCEPTION WHEN OTHERS so the script never aborts on
-- pre-existing state.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Escrow-pause guard (trigger-level defence in depth)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY a trigger and not an RPC patch:
--   Any path that updates jobs to a "released" or "completed" state must be
--   blocked while escrow_paused=true. A BEFORE UPDATE trigger on jobs is the
--   single chokepoint — works for release_milestone_payment, the Stripe
--   webhook, admin manual UPDATE, future Edge functions, anything.

CREATE OR REPLACE FUNCTION public._enforce_escrow_pause()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  -- Only fire when the row is currently paused. (Trigger WHEN clause
  -- already filters; defence-in-depth here too.)
  IF NOT COALESCE(OLD.escrow_paused, false) THEN
    RETURN NEW;
  END IF;

  -- Block status flipping to terminal "completed" / "paid" while paused.
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('completed', 'paid') THEN
    RAISE EXCEPTION 'escrow_paused: cannot mark job % while a dispute is open. Admin must resolve via /admin/disputes first.', NEW.status;
  END IF;

  -- Block payout_status flipping to released/paid while paused.
  -- Only check if the column actually exists on this row (it's nullable
  -- in some pre-existing schemas).
  IF OLD.payout_status IS DISTINCT FROM NEW.payout_status
     AND NEW.payout_status IN ('released', 'paid', 'transferred') THEN
    RAISE EXCEPTION 'escrow_paused: cannot release payout while a dispute is open. Admin must resolve via /admin/disputes first.';
  END IF;

  -- Admin clearing the pause (escrow_paused → false) is ALLOWED. Don't
  -- block it. resolve_dispute() handles the unfreeze.
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS jobs_escrow_pause_guard ON public.jobs;
CREATE TRIGGER jobs_escrow_pause_guard
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (OLD.escrow_paused IS TRUE)
  EXECUTE FUNCTION public._enforce_escrow_pause();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Sprint 12C: job_clauses + clause_acceptances
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.job_clauses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'other',
  title        text NOT NULL DEFAULT 'Clause',
  body         text NOT NULL DEFAULT '',
  is_required  boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_clauses_job_fkey') THEN
      ALTER TABLE public.job_clauses DROP CONSTRAINT job_clauses_job_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
      ALTER TABLE public.job_clauses ADD CONSTRAINT job_clauses_job_fkey
        FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'job_clauses_job_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_clauses_kind_check') THEN
      ALTER TABLE public.job_clauses DROP CONSTRAINT job_clauses_kind_check;
    END IF;
    ALTER TABLE public.job_clauses ADD CONSTRAINT job_clauses_kind_check
      CHECK (kind IN ('nda','exclusivity','safety','indemnification','data_handling','compliance','other')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'job_clauses_kind_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_clauses_title_len') THEN
      ALTER TABLE public.job_clauses DROP CONSTRAINT job_clauses_title_len;
    END IF;
    ALTER TABLE public.job_clauses ADD CONSTRAINT job_clauses_title_len
      CHECK (char_length(title) BETWEEN 1 AND 160) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'job_clauses_title_len: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_clauses_body_len') THEN
      ALTER TABLE public.job_clauses DROP CONSTRAINT job_clauses_body_len;
    END IF;
    ALTER TABLE public.job_clauses ADD CONSTRAINT job_clauses_body_len
      CHECK (char_length(body) BETWEEN 1 AND 20000) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'job_clauses_body_len: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_clauses_job ON public.job_clauses(job_id, sort_order);

DROP TRIGGER IF EXISTS job_clauses_touch ON public.job_clauses;
CREATE TRIGGER job_clauses_touch
  BEFORE UPDATE ON public.job_clauses
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.job_clauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clauses_client_all" ON public.job_clauses;
CREATE POLICY "clauses_client_all" ON public.job_clauses FOR ALL
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.client_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.client_id = auth.uid()));

DROP POLICY IF EXISTS "clauses_admin_all" ON public.job_clauses;
CREATE POLICY "clauses_admin_all" ON public.job_clauses FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- Inspectors who can see the job can read its clauses (so the apply page
-- can render the acceptance checkboxes).
DROP POLICY IF EXISTS "clauses_inspector_read" ON public.job_clauses;
CREATE POLICY "clauses_inspector_read" ON public.job_clauses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_clauses.job_id
         AND j.moderation_status = 'approved'
    )
  );

-- ─── clause_acceptances ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clause_acceptances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_id   uuid NOT NULL,
  acceptor_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT NOW(),
  ip_address  inet,
  user_agent  text
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clause_acceptances_clause_fkey') THEN
      ALTER TABLE public.clause_acceptances DROP CONSTRAINT clause_acceptances_clause_fkey;
    END IF;
    ALTER TABLE public.clause_acceptances ADD CONSTRAINT clause_acceptances_clause_fkey
      FOREIGN KEY (clause_id) REFERENCES public.job_clauses(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'clause_acceptances_clause_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clause_acceptances_acceptor_fkey') THEN
      ALTER TABLE public.clause_acceptances DROP CONSTRAINT clause_acceptances_acceptor_fkey;
    END IF;
    ALTER TABLE public.clause_acceptances ADD CONSTRAINT clause_acceptances_acceptor_fkey
      FOREIGN KEY (acceptor_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'clause_acceptances_acceptor_fkey: %', SQLERRM; END;

  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clause_acceptances_unique') THEN
      ALTER TABLE public.clause_acceptances ADD CONSTRAINT clause_acceptances_unique
        UNIQUE (clause_id, acceptor_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'clause_acceptances_unique: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_clause_acceptances_acceptor ON public.clause_acceptances(acceptor_id);

ALTER TABLE public.clause_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acceptances_self_all" ON public.clause_acceptances;
CREATE POLICY "acceptances_self_all" ON public.clause_acceptances FOR ALL
  USING (acceptor_id = auth.uid()) WITH CHECK (acceptor_id = auth.uid());

DROP POLICY IF EXISTS "acceptances_admin_read" ON public.clause_acceptances;
CREATE POLICY "acceptances_admin_read" ON public.clause_acceptances FOR SELECT
  USING (public.nx_is_admin());

-- Gate trigger on applications: cannot apply unless all required clauses accepted.
CREATE OR REPLACE FUNCTION public._enforce_clause_acceptance()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE
  v_missing int := 0;
BEGIN
  SELECT COUNT(*) INTO v_missing
    FROM public.job_clauses jc
   WHERE jc.job_id = NEW.job_id
     AND jc.is_required = true
     AND NOT EXISTS (
       SELECT 1 FROM public.clause_acceptances ca
        WHERE ca.clause_id = jc.id
          AND ca.acceptor_id = NEW.inspector_id
     );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'You must accept all % required clause(s) for this job before applying.', v_missing
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;

-- Attach to whichever table holds applications. Both `applications` and
-- `job_applications` exist; checking which has inspector_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='applications' AND column_name='inspector_id'
  ) THEN
    DROP TRIGGER IF EXISTS applications_enforce_clauses ON public.applications;
    CREATE TRIGGER applications_enforce_clauses
      BEFORE INSERT ON public.applications
      FOR EACH ROW EXECUTE FUNCTION public._enforce_clause_acceptance();
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='job_applications' AND column_name='inspector_id'
  ) THEN
    DROP TRIGGER IF EXISTS job_applications_enforce_clauses ON public.job_applications;
    CREATE TRIGGER job_applications_enforce_clauses
      BEFORE INSERT ON public.job_applications
      FOR EACH ROW EXECUTE FUNCTION public._enforce_clause_acceptance();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Sprint 12D: contracts + contract_assignments + bucket
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL DEFAULT 'msa',
  title           text NOT NULL DEFAULT 'Untitled',
  body_md         text NOT NULL DEFAULT '',
  pdf_path        text,
  external_url    text,
  version         integer NOT NULL DEFAULT 1,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_kind_check') THEN
      ALTER TABLE public.contracts DROP CONSTRAINT contracts_kind_check;
    END IF;
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_kind_check
      CHECK (kind IN ('msa','dpa','amendment','order_form','nda','other')) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contracts_kind_check: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_title_len') THEN
      ALTER TABLE public.contracts DROP CONSTRAINT contracts_title_len;
    END IF;
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_title_len
      CHECK (char_length(title) BETWEEN 1 AND 200) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contracts_title_len: %', SQLERRM; END;

  -- pdf_path OR external_url — at most one (both nullable; body_md is the
  -- canonical fallback when neither is set).
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_attach_xor') THEN
      ALTER TABLE public.contracts DROP CONSTRAINT contracts_attach_xor;
    END IF;
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_attach_xor
      CHECK (NOT (pdf_path IS NOT NULL AND external_url IS NOT NULL)) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contracts_attach_xor: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_external_url_format') THEN
      ALTER TABLE public.contracts DROP CONSTRAINT contracts_external_url_format;
    END IF;
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_external_url_format
      CHECK (external_url IS NULL OR external_url ~* '^https?://') NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contracts_external_url_format: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_created_by_fkey') THEN
      ALTER TABLE public.contracts DROP CONSTRAINT contracts_created_by_fkey;
    END IF;
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contracts_created_by_fkey: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_active ON public.contracts(is_active, kind);

DROP TRIGGER IF EXISTS contracts_touch ON public.contracts;
CREATE TRIGGER contracts_touch
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_read_active" ON public.contracts;
CREATE POLICY "contracts_read_active" ON public.contracts FOR SELECT
  USING (is_active = true OR public.nx_is_admin());

DROP POLICY IF EXISTS "contracts_admin_write" ON public.contracts;
CREATE POLICY "contracts_admin_write" ON public.contracts FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- ─── contract_assignments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contract_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NOT NULL,
  party_id            uuid NOT NULL,
  required            boolean NOT NULL DEFAULT true,
  signed_at           timestamptz,
  signer_typed_name   text,
  ip_address          inet,
  user_agent          text,
  signed_pdf_path     text,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contract_assignments_contract_fkey') THEN
      ALTER TABLE public.contract_assignments DROP CONSTRAINT contract_assignments_contract_fkey;
    END IF;
    ALTER TABLE public.contract_assignments ADD CONSTRAINT contract_assignments_contract_fkey
      FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contract_assignments_contract_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contract_assignments_party_fkey') THEN
      ALTER TABLE public.contract_assignments DROP CONSTRAINT contract_assignments_party_fkey;
    END IF;
    ALTER TABLE public.contract_assignments ADD CONSTRAINT contract_assignments_party_fkey
      FOREIGN KEY (party_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contract_assignments_party_fkey: %', SQLERRM; END;

  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contract_assignments_unique') THEN
      ALTER TABLE public.contract_assignments ADD CONSTRAINT contract_assignments_unique
        UNIQUE (contract_id, party_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'contract_assignments_unique: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_assignments_party
  ON public.contract_assignments(party_id, signed_at);

DROP TRIGGER IF EXISTS contract_assignments_touch ON public.contract_assignments;
CREATE TRIGGER contract_assignments_touch
  BEFORE UPDATE ON public.contract_assignments
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.contract_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ca_self_read" ON public.contract_assignments;
CREATE POLICY "ca_self_read" ON public.contract_assignments FOR SELECT
  USING (party_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "ca_self_sign" ON public.contract_assignments;
CREATE POLICY "ca_self_sign" ON public.contract_assignments FOR UPDATE
  USING (party_id = auth.uid())
  WITH CHECK (party_id = auth.uid());

DROP POLICY IF EXISTS "ca_admin_all" ON public.contract_assignments;
CREATE POLICY "ca_admin_all" ON public.contract_assignments FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- Storage bucket for signed PDFs (admin uploads canonical, signed copies counter-stored)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contracts','contracts', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "contracts_storage_admin_all" ON storage.objects;
CREATE POLICY "contracts_storage_admin_all" ON storage.objects FOR ALL
  USING (bucket_id = 'contracts' AND public.nx_is_admin())
  WITH CHECK (bucket_id = 'contracts' AND public.nx_is_admin());

DROP POLICY IF EXISTS "contracts_storage_party_read" ON storage.objects;
CREATE POLICY "contracts_storage_party_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
       JOIN public.contract_assignments ca ON ca.contract_id = c.id
       WHERE ca.party_id = auth.uid()
         AND (c.pdf_path = name OR ca.signed_pdf_path = name)
    )
  );

-- ─── Sign-contract RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sign_contract(
  p_assignment_id uuid,
  p_typed_name    text,
  p_ip            inet  DEFAULT NULL,
  p_user_agent    text  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_party uuid;
  v_already timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_typed_name IS NULL OR char_length(trim(p_typed_name)) < 2 THEN
    RAISE EXCEPTION 'typed name required (min 2 chars)';
  END IF;

  SELECT party_id, signed_at INTO v_party, v_already
    FROM public.contract_assignments WHERE id = p_assignment_id;

  IF v_party IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;
  IF v_party <> v_uid THEN RAISE EXCEPTION 'not your assignment'; END IF;
  IF v_already IS NOT NULL THEN RAISE EXCEPTION 'already signed'; END IF;

  UPDATE public.contract_assignments
     SET signed_at = NOW(),
         signer_typed_name = p_typed_name,
         ip_address = p_ip,
         user_agent = p_user_agent
   WHERE id = p_assignment_id;

  -- Notify admins so they see when each MSA/NDA closes.
  DECLARE v_admin uuid;
  BEGIN
    FOR v_admin IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
    LOOP
      PERFORM public.notify(
        v_admin,
        'contract_assigned',
        'Contract signed',
        format('Assignment %s signed by %s', p_assignment_id::text, p_typed_name),
        '/admin/contracts',
        NULL
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'sign_contract notify failed: %', SQLERRM;
  END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.sign_contract(uuid, text, inet, text) TO authenticated;

COMMIT;
