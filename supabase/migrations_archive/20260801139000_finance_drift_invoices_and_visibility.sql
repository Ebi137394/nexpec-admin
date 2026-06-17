-- ════════════════════════════════════════════════════════════════════════════
--  20260801139000_finance_drift_invoices_and_visibility.sql
--
--  Closes the remaining finance-suite drift: public.invoices (the table the
--  client Invoices screen + budget RPCs read) and public.fin_visible_client_ids
--  (the visibility gate) both lived only in production. Captured verbatim from
--  the live catalog so a clean `db reset` reproduces them identically.
--
--  Fully idempotent: CREATE TABLE IF NOT EXISTS (skipped on prod where the table
--  already exists), CREATE INDEX IF NOT EXISTS, DROP/CREATE POLICY, guarded
--  triggers, CREATE OR REPLACE function.
--
--  ┌─ SECURITY FIX (real exposure) ──────────────────────────────────────────┐
--  │ Live table grants gave anon + authenticated TRUNCATE/REFERENCES/TRIGGER  │
--  │ plus anon full DML on this FINANCIAL table. TRUNCATE *bypasses RLS*, so  │
--  │ any authenticated user could wipe public.invoices. RLS itself is enabled │
--  │ and correct, but the grant surface is not. This migration:               │
--  │   • REVOKEs ALL from anon and PUBLIC                                     │
--  │   • REVOKEs TRUNCATE/REFERENCES/TRIGGER from authenticated               │
--  │   • keeps SELECT/INSERT/UPDATE/DELETE for authenticated (RLS-gated; the  │
--  │     write policy still restricts writes to admin/super_admin)            │
--  │   • leaves service_role full (backend, bypasses RLS by design)           │
--  │ Same anon/PUBLIC hardening applied to fin_visible_client_ids().          │
--  └─────────────────────────────────────────────────────────────────────────┘
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Visibility gate: fin_visible_client_ids (verbatim) ───────────────────
CREATE OR REPLACE FUNCTION public.fin_visible_client_ids(p_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_org_id uuid;
BEGIN
  SELECT role, organization_id INTO v_role, v_org_id
  FROM public.profiles WHERE id = p_user_id;

  IF v_role IS NULL THEN RETURN; END IF;

  -- Admin / super_admin → every client on the platform
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN QUERY SELECT id FROM public.profiles WHERE role IN ('client', 'enterprise', 'agency');
    RETURN;
  END IF;

  -- Org-rolled buyer (agency or enterprise) → every profile in same org
  IF v_role IN ('agency', 'enterprise') AND v_org_id IS NOT NULL THEN
    RETURN QUERY
      SELECT id FROM public.profiles
       WHERE organization_id = v_org_id;
    RETURN;
  END IF;

  -- Plain client → just themselves
  IF v_role = 'client' THEN
    RETURN QUERY SELECT p_user_id;
    RETURN;
  END IF;

  -- Inspector / unknown → empty set (no budget visibility)
  RETURN;
END
$function$;

REVOKE ALL ON FUNCTION public.fin_visible_client_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_visible_client_ids(uuid) TO authenticated, service_role;

-- ─── 2. Table: public.invoices (verbatim columns + constraints) ──────────────
--  Inline constraints apply only on a fresh create; on prod the table already
--  exists so CREATE TABLE IF NOT EXISTS is a no-op and existing constraints
--  (identical) are preserved.
CREATE TABLE IF NOT EXISTS public.invoices (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  invoice_number         text        NOT NULL,
  job_id                 uuid        NOT NULL,
  contract_id            uuid,
  client_id              uuid        NOT NULL,
  inspector_id           uuid,
  client_amount_cents    bigint      NOT NULL,
  inspector_amount_cents bigint      NOT NULL DEFAULT 0,
  platform_fee_cents     bigint      NOT NULL DEFAULT 0,
  total_cents            bigint      NOT NULL,
  currency               text        NOT NULL DEFAULT 'USD'::text,
  status                 text        NOT NULL DEFAULT 'pending_review'::text,
  issued_at              timestamptz NOT NULL DEFAULT now(),
  due_date               date,
  approved_at            timestamptz,
  approved_by            uuid,
  disputed_at            timestamptz,
  disputed_by            uuid,
  dispute_reason         text,
  paid_at                timestamptz,
  paid_reference         text,
  voided_at              timestamptz,
  voided_by              uuid,
  voided_reason          text,
  line_items_json        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  department_id          uuid,
  cost_center_snapshot   text,
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number),
  CONSTRAINT invoices_client_amount_cents_check    CHECK (client_amount_cents >= 0),
  CONSTRAINT invoices_inspector_amount_cents_check CHECK (inspector_amount_cents >= 0),
  CONSTRAINT invoices_platform_fee_cents_check     CHECK (platform_fee_cents >= 0),
  CONSTRAINT invoices_total_cents_check            CHECK (total_cents >= 0),
  CONSTRAINT invoices_total_matches CHECK (
    (total_cents = (client_amount_cents + platform_fee_cents))
    OR (total_cents = client_amount_cents)
  ),
  CONSTRAINT invoices_status_check CHECK (
    status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'disputed'::text, 'paid'::text, 'voided'::text])
  ),
  CONSTRAINT invoices_job_id_fkey      FOREIGN KEY (job_id)      REFERENCES public.jobs(id)          ON DELETE CASCADE,
  CONSTRAINT invoices_client_id_fkey   FOREIGN KEY (client_id)   REFERENCES public.profiles(id)      ON DELETE RESTRICT,
  CONSTRAINT invoices_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES public.profiles(id)    ON DELETE SET NULL,
  CONSTRAINT invoices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.job_contracts(id) ON DELETE SET NULL,
  CONSTRAINT invoices_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL,
  CONSTRAINT invoices_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id),
  CONSTRAINT invoices_disputed_by_fkey FOREIGN KEY (disputed_by) REFERENCES public.profiles(id),
  CONSTRAINT invoices_voided_by_fkey   FOREIGN KEY (voided_by)   REFERENCES public.profiles(id)
);

-- ─── 3. Indexes (verbatim, made idempotent) ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_client_id
  ON public.invoices USING btree (client_id, status, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_inspector_id
  ON public.invoices USING btree (inspector_id, status, issued_at DESC) WHERE (inspector_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_invoices_job_id
  ON public.invoices USING btree (job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON public.invoices USING btree (status, issued_at DESC);
CREATE INDEX IF NOT EXISTS invoices_department_idx
  ON public.invoices USING btree (department_id, issued_at DESC) WHERE (department_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS invoices_cost_center_snapshot_idx
  ON public.invoices USING btree (cost_center_snapshot) WHERE (cost_center_snapshot IS NOT NULL);

-- ─── 4. Row-Level Security (enabled live; re-assert + verbatim policies) ──────
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_read_own_client ON public.invoices;
CREATE POLICY invoices_read_own_client ON public.invoices
  FOR SELECT TO authenticated
  USING (
    (client_id = auth.uid())
    OR (client_id IN (SELECT public.fin_visible_client_ids(auth.uid())))
    OR (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid()
                   AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))
  );

DROP POLICY IF EXISTS invoices_read_own_inspector ON public.invoices;
CREATE POLICY invoices_read_own_inspector ON public.invoices
  FOR SELECT TO authenticated
  USING (inspector_id = auth.uid());

DROP POLICY IF EXISTS invoices_write_admin_only ON public.invoices;
CREATE POLICY invoices_write_admin_only ON public.invoices
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                       WHERE p.id = auth.uid()
                         AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])));

-- ─── 5. Triggers (verbatim; guarded so a fresh deploy can't fail on a
--        not-yet-created helper function) ─────────────────────────────────────
DO $trg$
BEGIN
  IF to_regprocedure('public._touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS invoices_touch ON public.invoices;
    CREATE TRIGGER invoices_touch BEFORE UPDATE ON public.invoices
      FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
  END IF;

  IF to_regprocedure('public.tg_invoice_inherit_department()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tg_invoice_inherit_department ON public.invoices;
    CREATE TRIGGER tg_invoice_inherit_department
      BEFORE INSERT OR UPDATE OF department_id ON public.invoices
      FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_inherit_department();
  END IF;
END
$trg$;

-- ─── 6. Grant hardening (the security fix) ───────────────────────────────────
REVOKE ALL ON TABLE public.invoices FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.invoices FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;

-- ─── 7. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_anon_truncate boolean;
  v_policy_count  int;
BEGIN
  IF to_regclass('public.invoices') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public.invoices missing after migration';
  END IF;
  IF to_regprocedure('public.fin_visible_client_ids(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: fin_visible_client_ids missing after migration';
  END IF;

  -- RLS must be on
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS not enabled on public.invoices';
  END IF;

  -- anon must no longer hold TRUNCATE (the exposure we closed)
  v_anon_truncate := has_table_privilege('anon', 'public.invoices', 'TRUNCATE');
  IF v_anon_truncate THEN
    RAISE EXCEPTION 'SELFTEST: anon still holds TRUNCATE on public.invoices';
  END IF;

  -- authenticated must no longer hold TRUNCATE
  IF has_table_privilege('authenticated', 'public.invoices', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated still holds TRUNCATE on public.invoices';
  END IF;

  SELECT count(*) INTO v_policy_count FROM pg_policy WHERE polrelid = 'public.invoices'::regclass;
  IF v_policy_count < 3 THEN
    RAISE EXCEPTION 'SELFTEST: expected >=3 RLS policies on invoices, found %', v_policy_count;
  END IF;

  RAISE NOTICE 'Finance drift closed: invoices + fin_visible_client_ids versioned; TRUNCATE/anon revoked; RLS intact (% policies).', v_policy_count;
END
$selftest$;
