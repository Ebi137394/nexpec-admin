-- ════════════════════════════════════════════════════════════════════════════
--  00000000020000_ghost_fk_targets.sql — adopt 4 more production-only tables
--
--  projects / applications / inspection_reports / reports are FK-referenced by
--  later migrations (findings, job_contracts, provable_inspection_seals,
--  branding) but were never in version control — they lived only in prod, so a
--  clean `supabase db reset` failed at the first inbound FK ("relation projects
--  does not exist"). Captured verbatim (columns/checks/indexes) from prod.
--
--  Sorts right after the baseline + financial-suite foundation, before the
--  earliest reference (projects @ 20250206190700). Idempotent (CREATE … IF NOT
--  EXISTS); a no-op on prod, where these already exist.
--
--  SCOPE — structure only, mirroring the baseline's ghost-table pattern
--  ("created with NO outgoing foreign keys; RLS policies + triggers layer in via
--  later migrations"):
--    • Columns + PK + CHECK + UNIQUE + indexes: included (faithful to prod).
--    • Outgoing FKs: OMITTED on purpose (targets incl. organizations/jobs/
--      profiles/auth.users/work_orders are created at varying points; the FK
--      layer is reconciled separately to avoid ordering failures).
--    • RLS state: matches prod (projects = off; the other three = on). Their
--      prod RLS *policies* + *triggers* were created out-of-band and reference
--      a deeper layer of still-unversioned prod objects (work_orders table,
--      audit_capture / increment_job_applications_count / enforce_application_
--      rate_limit / log_application_event / handle_job_acceptance /
--      validate_application_status_transition / is_super_admin). Those are a
--      tracked reconciliation backlog (see docs/qa/PHASE4_TESTING.md); they do
--      NOT block startup because no VC migration creates them.
--    • inspection_reports.domain is prod-typed as the `inspection_domain` enum,
--      which is only created at 20260616120000 (after this table is first
--      referenced). Created here as TEXT (same default) to avoid a forward type
--      dep; the enum retype is part of the same backlog.
--
--  GRANT HARDENING (same fix as invoices): live grants expose these tables to
--  anon + PUBLIC incl. TRUNCATE (which bypasses RLS). Revoke anon/PUBLIC +
--  TRUNCATE/REFERENCES/TRIGGER from authenticated; keep RLS-gated DML for
--  authenticated; service_role stays full.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. projects (prod RLS = OFF) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  -- Compatibility column: the Feb-2025 findings migration (20250206190700)
  -- creates an RLS policy referencing projects.client_id. Prod later replaced
  -- client_id with organization_id (and that change was out-of-band), so the
  -- column is absent from the current prod dump. Re-added here (nullable) purely
  -- so that historical migration replays cleanly on a fresh db reset.
  client_id       uuid,
  name            text        NOT NULL,
  status          text        DEFAULT 'active'::text,
  budget          numeric     DEFAULT 0,
  spent           numeric     DEFAULT 0,
  start_date      date,
  end_date        date,
  created_at      timestamptz DEFAULT now(),
  latitude        double precision,
  longitude       double precision,
  CONSTRAINT projects_pkey1 PRIMARY KEY (id),
  CONSTRAINT projects_status_check CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'completed'::text, 'archived'::text]))
);

-- ─── 2. applications (prod RLS = ON) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.applications (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
  job_id                  uuid        NOT NULL,
  applicant_id            uuid        NOT NULL,
  status                  text        NOT NULL,
  cover_note              text,
  bid_amount_cents        bigint,
  bid_type                text,
  currency                text        DEFAULT 'USD'::text,
  attachments             text[],
  client_notes            text,
  rejection_reason        text,
  offered_at              timestamptz,
  hired_at                timestamptz,
  withdrawn_at            timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  cover_letter            text,
  proposed_price_cents    bigint,
  availability_date       date,
  estimated_duration      text,
  user_id                 uuid,
  client_note             text,
  client_feedback         text,
  admin_feedback          text,
  admin_attachment        text,
  deleted_at              timestamptz,
  client_op_id            uuid,
  last_viewed_by_client   timestamptz,
  admin_counter_cents     bigint,
  admin_comment           text,
  admin_countered_at      timestamptz,
  admin_countered_by      uuid,
  negotiation_status      text,
  inspector_decision      text,
  inspector_decision_note text,
  inspector_decision_at   timestamptz,
  CONSTRAINT applications_pkey PRIMARY KEY (id),
  CONSTRAINT unique_job_application UNIQUE (job_id, applicant_id),
  CONSTRAINT applications_status_check CHECK (status = ANY (ARRAY['pending'::text, 'shortlisted'::text, 'offered'::text, 'CLIENT_SELECTED'::text, 'hired'::text, 'rejected'::text, 'withdrawn'::text, 'accepted'::text])),
  CONSTRAINT applications_bid_type_check CHECK (bid_type = ANY (ARRAY['fixed'::text, 'hourly'::text, 'daily'::text, 'Fixed'::text, 'Hourly'::text, 'Fixed Price'::text])),
  CONSTRAINT applications_negotiation_status_check CHECK (negotiation_status IS NULL OR negotiation_status = ANY (ARRAY['none'::text, 'admin_countered'::text, 'counter_accepted'::text, 'counter_rejected'::text]))
);
CREATE INDEX IF NOT EXISTS idx_applications_job_applicant ON public.applications USING btree (job_id, applicant_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id        ON public.applications USING btree (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_applicant_id  ON public.applications USING btree (applicant_id);
CREATE INDEX IF NOT EXISTS idx_applications_bid_admin     ON public.applications USING btree (job_id, bid_amount_cents) WHERE (bid_amount_cents IS NOT NULL);
CREATE INDEX IF NOT EXISTS applications_alive_idx         ON public.applications USING btree (id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS applications_client_op_id_unique ON public.applications USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS applications_applicant_job_idx ON public.applications USING btree (applicant_id, job_id);

-- ─── 3. inspection_reports (prod RLS = ON; domain enum → TEXT, see header) ────
CREATE TABLE IF NOT EXISTS public.inspection_reports (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  job_id                uuid        NOT NULL,
  inspector_id          uuid        NOT NULL,
  photo_url             text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  pdf_url               text,
  final_report_doc      text,
  status                text        DEFAULT 'pending'::text,
  technical_approved    boolean     DEFAULT false,
  technical_approved_by uuid,
  technical_approved_at timestamptz,
  financial_approved    boolean     DEFAULT false,
  financial_approved_by uuid,
  financial_approved_at timestamptz,
  is_published          boolean     DEFAULT false,
  is_client_approved    boolean     DEFAULT false,
  deleted_at            timestamptz,
  client_op_id          uuid,
  signed_docs_url       text,
  signed_docs_notes     text,
  domain                text        NOT NULL DEFAULT 'industrial_ndt'::text,
  CONSTRAINT inspection_reports_pkey PRIMARY KEY (id),
  CONSTRAINT unique_report_per_job_inspector UNIQUE (job_id, inspector_id)
);
CREATE INDEX IF NOT EXISTS inspection_reports_alive_idx ON public.inspection_reports USING btree (id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_reports_client_op_id_unique ON public.inspection_reports USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);

-- ─── 4. reports (prod RLS = ON) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reports (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id      uuid,
  inspector_id    uuid        NOT NULL,
  title           text        NOT NULL,
  comments        text,
  result          text        NOT NULL,
  status          text        DEFAULT 'Submitted'::text,
  created_at      timestamptz DEFAULT now(),
  image_url       text,
  updated_at      timestamptz DEFAULT now(),
  inspection_type text,
  serial_number   text,
  description     text,
  report_url      text,
  signature       text,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_result_check CHECK (result = ANY (ARRAY['Pending'::text, 'Pass'::text, 'Fail'::text])),
  CONSTRAINT reports_status_check CHECK (status = ANY (ARRAY['In_Progress'::text, 'Submitted'::text, 'Approved'::text, 'Rejected'::text, 'Revision_Requested'::text]))
);

-- ─── RLS state to match prod (projects OFF; others ON, deny-default until the
--     policy layer is reconciled) ───────────────────────────────────────────
ALTER TABLE public.applications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports            ENABLE ROW LEVEL SECURITY;
-- public.projects: RLS left DISABLED to match prod.

-- ─── Grant hardening (revoke anon/PUBLIC + TRUNCATE; keep authenticated DML) ──
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['public.projects','public.applications','public.inspection_reports','public.reports']
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon', r);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM authenticated', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO authenticated', r);
    EXECUTE format('GRANT ALL ON TABLE %s TO service_role', r);
  END LOOP;
END
$grants$;

-- ─── Self-test ────────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.projects')           IS NULL THEN RAISE EXCEPTION 'SELFTEST: projects missing'; END IF;
  IF to_regclass('public.applications')       IS NULL THEN RAISE EXCEPTION 'SELFTEST: applications missing'; END IF;
  IF to_regclass('public.inspection_reports') IS NULL THEN RAISE EXCEPTION 'SELFTEST: inspection_reports missing'; END IF;
  IF to_regclass('public.reports')            IS NULL THEN RAISE EXCEPTION 'SELFTEST: reports missing'; END IF;
  IF has_table_privilege('anon', 'public.applications', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: anon still holds TRUNCATE on applications';
  END IF;
  RAISE NOTICE 'Ghost FK targets adopted: projects, applications, inspection_reports, reports (structure + hardened grants).';
END
$selftest$;
