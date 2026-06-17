-- ════════════════════════════════════════════════════════════════════════════
--  BASELINE — core platform tables
--
--  Purpose: make the production schema reproducible from migrations alone.
--  Before this file existed, public.profiles / public.jobs / public.audit_events
--  lived only in the live database — provisioning a fresh Supabase project
--  from this repo would fail because the rest of the migration set ALTERs
--  tables that don't exist yet.
--
--  Captured from production Supabase Studio on 2026-05-17. If schema drifts,
--  re-export with `supabase db dump --schema-only --table public.profiles
--  --table public.jobs --table public.audit_events` and replace this file.
--
--  IMPORTANT — what this file does NOT include:
--    • Triggers. The trigger functions live in subsequent migrations and
--      must be created before their triggers can attach. The triggers
--      themselves are re-created by those later migrations (or, if any
--      are orphaned, by a follow-up baseline patch).
--    • RLS policies on these tables. Same reason — they layer in via
--      the existing migration set.
--    • Foreign-key targets `organizations`, `country_codes`,
--      `report_templates`, `inspection_scope_templates`. Those must be
--      created by their own baseline / migration before this file runs,
--      OR this file's FK ALTERs will fail. Recommended: extend this
--      baseline to also include those four tables.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── REQUIRED EXTENSIONS ──────────────────────────────────────────────────
--  Hosted Supabase pre-provisions PostGIS / pgcrypto / pgvector in the
--  `extensions` schema and puts that schema on the search_path, so the
--  GEOGRAPHY columns + ST_* generated expressions (here), extensions.digest /
--  gen_random_bytes, and vector(...) columns (later migrations) "just work"
--  upstream. A fresh local `supabase start` does NOT, so a clean db reset
--  failed at the first GEOGRAPHY column ("type geography does not exist").
--
--  Enable them here, before the first table, and make the `extensions` schema
--  resolvable for unqualified types/functions — both in THIS session (for the
--  rest of this file) and for every future connection (later migration files +
--  runtime), mirroring hosted. Fully idempotent; a no-op on an env that already
--  has them.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector   WITH SCHEMA extensions;

SET search_path TO public, extensions;
DO $baseline_ext$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO public, extensions', current_database());
END
$baseline_ext$;

-- ─── public.profiles ────────────────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════
--  GHOST FK-TARGET TABLES — folded in 2026-08 (canonical record: migration
--  20260801120700). The baseline's own header flagged these four as FK targets
--  that "must be created before this file runs"; they previously existed only on
--  the live DB (out of band). They MUST precede `profiles` (which FK-references
--  organizations + country_codes) and `jobs` (which FK-references all four).
--
--  Created here with NO OUTGOING foreign keys on purpose — organizations.owner_id
--  → profiles would be a circular dependency with profiles.organization_id →
--  organizations. The owner_id / client_id / created_by FKs (and any indexes,
--  RLS, triggers) are layered idempotently by later migrations
--  (20260801120500 / 120700) and the existing migration set. Reconcile-safe
--  (CREATE IF NOT EXISTS) so an existing DB is untouched and `supabase db reset`
--  re-runs cleanly. Reference DATA (the ISO country list) is loaded by seeds.
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.country_codes (
  code         text PRIMARY KEY,
  name         text,
  calling_code text,
  region       text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text,
  kind          text NOT NULL DEFAULT 'enterprise',
  owner_id      uuid,            -- FK → profiles deferred (circular dep); layered later
  is_active     boolean NOT NULL DEFAULT true,
  base_currency text,
  slug          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inspection_scope_templates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     text,
  name                     text,
  version                  integer NOT NULL DEFAULT 1,
  category                 text,
  region                   text,
  validity_months          integer,
  base_price_cents         bigint,
  requires_credential_tier text,
  description_md           text,
  is_active                boolean NOT NULL DEFAULT true,
  domain                   text,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid,            -- FK → profiles layered by 20260801120500/120700
  org_id             uuid,
  source_document_id uuid,
  name               text,
  template_spec      jsonb NOT NULL DEFAULT '{}'::jsonb,
  spec_sha256        text,
  is_locked          boolean NOT NULL DEFAULT false,
  locked_at          timestamptz,
  locked_by          uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id                              UUID        NOT NULL,
  email                           TEXT        NOT NULL,
  role                            TEXT        NOT NULL DEFAULT 'client'::text,
  full_name                       TEXT,
  avatar_url                      TEXT,
  terms_accepted                  BOOLEAN     DEFAULT false,
  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_at                      TIMESTAMPTZ DEFAULT now(),
  company_name                    TEXT,
  professional_title              TEXT,
  first_name                      TEXT,
  last_name                       TEXT,
  phone                           TEXT,
  bio                             TEXT,
  specialties                     TEXT,
  years_of_experience             TEXT,
  is_verified                     BOOLEAN     DEFAULT false,
  headline                        TEXT,
  title                           TEXT,
  skills                          TEXT[]      DEFAULT '{}'::text[],
  resume_url                      TEXT,
  rating_average                  NUMERIC     DEFAULT 0,
  reviews_count                   INTEGER     DEFAULT 0,
  completed_jobs_count            INTEGER     DEFAULT 0,
  balance_cents                   BIGINT      DEFAULT 0,
  cv_url                          TEXT,
  verification_status             TEXT        DEFAULT 'unverified'::text,
  verified_at                     TIMESTAMPTZ,
  verified_by                     UUID,
  location                        TEXT,
  rejection_reason                TEXT,
  push_token                      TEXT,
  unread_notifications_count      INTEGER     DEFAULT 0,
  avg_rating                      NUMERIC(3,2) DEFAULT 0.0,
  total_reviews                   INTEGER     DEFAULT 0,
  organization_id                 UUID,
  status                          TEXT        DEFAULT 'active'::text,
  last_active                     TIMESTAMPTZ DEFAULT now(),
  current_project                 TEXT,
  rating                          NUMERIC(3,2) DEFAULT 0,
  experience_years                INTEGER     DEFAULT 0,
  referral_code                   TEXT,
  company_logo_url                TEXT,
  report_header_text              TEXT,
  report_footer_text              TEXT,
  use_custom_branding             BOOLEAN     DEFAULT false,
  stripe_connect_id               TEXT,
  hourly_rate_cents               BIGINT,
  ndt_methods                     TEXT[]      DEFAULT '{}'::text[],
  certifications                  TEXT[]      DEFAULT '{}'::text[],
  location_city                   TEXT,
  location_province               TEXT,
  response_time_hours             INTEGER     DEFAULT 24,
  rating_count                    INTEGER     DEFAULT 0,
  is_available                    BOOLEAN     DEFAULT true,
  availability_status             TEXT        DEFAULT 'offline'::text,
  recommend_percent               INTEGER     DEFAULT 0,
  total_jobs                      INTEGER     DEFAULT 0,
  latitude                        DOUBLE PRECISION,
  longitude                       DOUBLE PRECISION,
  geog                            GEOGRAPHY   GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      ELSE NULL::geography
    END
  ) STORED,
  daily_application_limit         INTEGER,
  stripe_connect_status           TEXT        DEFAULT 'not_connected'::text,
  stripe_connect_payouts_enabled  BOOLEAN     DEFAULT false,
  stripe_connect_onboarded_at     TIMESTAMPTZ,
  home_base_lat                   NUMERIC(9,6),
  home_base_lng                   NUMERIC(9,6),
  home_base_label                 TEXT,
  travel_radius_km                INTEGER,
  specialty_slugs                 TEXT[]      NOT NULL DEFAULT '{}'::text[],
  country_of_residence            TEXT,
  work_authorized_countries       TEXT[]      NOT NULL DEFAULT '{}'::text[],
  open_to_sponsored_work          BOOLEAN     NOT NULL DEFAULT false,
  sponsored_countries             TEXT[]      NOT NULL DEFAULT '{}'::text[],
  work_auth_verified_at           TIMESTAMPTZ,
  work_auth_verified_by           UUID,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_referral_code_key UNIQUE (referral_code),
  CONSTRAINT profiles_email_key UNIQUE (email),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT profiles_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users (id),
  CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT profiles_work_auth_verified_by_fk FOREIGN KEY (work_auth_verified_by) REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT profiles_country_of_residence_fk FOREIGN KEY (country_of_residence) REFERENCES public.country_codes (code) ON DELETE RESTRICT,
  CONSTRAINT profiles_verification_status_check CHECK (
    verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text])
  ),
  CONSTRAINT profiles_verified_pair_or_neither CHECK (
    (work_auth_verified_at IS NULL AND work_auth_verified_by IS NULL)
    OR
    (work_auth_verified_at IS NOT NULL AND work_auth_verified_by IS NOT NULL)
  ),
  CONSTRAINT profiles_work_authorized_countries_cap CHECK (cardinality(work_authorized_countries) <= 60),
  CONSTRAINT profiles_home_base_coords_check CHECK (
    (home_base_lat IS NULL AND home_base_lng IS NULL)
    OR
    (
      home_base_lat IS NOT NULL AND home_base_lng IS NOT NULL
      AND home_base_lat BETWEEN -90 AND 90
      AND home_base_lng BETWEEN -180 AND 180
    )
  ),
  CONSTRAINT profiles_role_allowlist CHECK (
    role = ANY (ARRAY['inspector'::text, 'client'::text, 'agency'::text, 'enterprise'::text, 'admin'::text, 'super_admin'::text])
  ),
  CONSTRAINT profiles_role_check CHECK (
    role = ANY (ARRAY['client'::text, 'inspector'::text, 'agency'::text, 'enterprise'::text, 'admin'::text, 'senior'::text, 'super_admin'::text])
  ),
  CONSTRAINT profiles_sponsored_countries_cap CHECK (cardinality(sponsored_countries) <= 60),
  CONSTRAINT profiles_status_check CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text])),
  CONSTRAINT profiles_stripe_connect_status_check CHECK (
    stripe_connect_status = ANY (ARRAY['not_connected'::text, 'pending'::text, 'verified'::text, 'restricted'::text, 'disabled'::text])
  ),
  CONSTRAINT profiles_travel_radius_km_check CHECK (travel_radius_km IS NULL OR travel_radius_km > 0)
);

CREATE INDEX IF NOT EXISTS idx_profiles_verification_status ON public.profiles (verification_status);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect ON public.profiles (stripe_connect_id) WHERE stripe_connect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_geog_inspector_idx ON public.profiles USING gist (geog) WHERE geog IS NOT NULL AND role = 'inspector';
CREATE INDEX IF NOT EXISTS idx_profiles_push_token ON public.profiles (push_token);
CREATE INDEX IF NOT EXISTS profiles_specialty_slugs_gin ON public.profiles USING gin (specialty_slugs);
CREATE INDEX IF NOT EXISTS profiles_country_of_residence_idx ON public.profiles (country_of_residence) WHERE country_of_residence IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_work_authorized_countries_gin ON public.profiles USING gin (work_authorized_countries);
CREATE INDEX IF NOT EXISTS profiles_sponsored_countries_gin ON public.profiles USING gin (sponsored_countries) WHERE open_to_sponsored_work = true;
CREATE INDEX IF NOT EXISTS profiles_stripe_connect_id_idx ON public.profiles (stripe_connect_id) WHERE stripe_connect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_status_idx ON public.profiles (status);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles (referral_code);


-- ─── public.jobs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jobs (
  id                              UUID        NOT NULL DEFAULT gen_random_uuid(),
  title                           TEXT        NOT NULL,
  description                     TEXT,
  location                        TEXT,
  price_cents                     BIGINT      NOT NULL DEFAULT 0,
  status                          TEXT        NOT NULL DEFAULT 'pending_approval'::text,
  client_id                       UUID,
  contractor_id                   UUID,
  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_at                      TIMESTAMPTZ DEFAULT now(),
  is_senior_review                BOOLEAN     NOT NULL DEFAULT false,
  is_featured                     BOOLEAN     DEFAULT false,
  budget_cents                    BIGINT,
  budget_min_cents                BIGINT,
  budget_max_cents                BIGINT,
  budget_type                     TEXT        DEFAULT 'fixed'::text,
  location_city                   TEXT,
  urgency                         TEXT        DEFAULT 'normal'::text,
  job_type                        TEXT        DEFAULT 'on_site'::text,
  required_certifications         TEXT[],
  scheduled_date                  TIMESTAMPTZ,
  applications_count              INTEGER     DEFAULT 0,
  template_url                    TEXT,
  contractor_payout_amount_cents  BIGINT      DEFAULT 0,
  contract_id                     UUID,
  contract_generated_at           TIMESTAMPTZ,
  inspector_id                    UUID,
  client_price_cents              BIGINT      DEFAULT 0,
  payout_amount_cents             BIGINT      DEFAULT 0,
  latitude                        DOUBLE PRECISION,
  longitude                       DOUBLE PRECISION,
  inspection_type                 TEXT,
  calendar_event_id               TEXT,
  calendar_synced_at              TIMESTAMPTZ,
  hired_inspector_id              UUID,
  agency_id                       UUID,
  inspector_payout_cents          BIGINT      DEFAULT 0,
  admin_confirmed_at              TIMESTAMPTZ,
  admin_confirmed_by              UUID,
  payout_status                   TEXT        DEFAULT 'unpaid'::text,
  currency                        TEXT,
  estimated_duration              TEXT,
  escrow_status                   TEXT        DEFAULT 'pending'::text,
  deleted_at                      TIMESTAMPTZ,
  platform_spread_cents           BIGINT      GENERATED ALWAYS AS (
    COALESCE(client_price_cents, 0) - COALESCE(inspector_payout_cents, 0)
  ) STORED,
  geog                            GEOGRAPHY   GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      ELSE NULL::geography
    END
  ) STORED,
  report_template_id              UUID,
  specialty_slugs                 TEXT[]      NOT NULL DEFAULT '{}'::text[],
  job_country                     TEXT,
  sponsorship_offered             TEXT        NOT NULL DEFAULT 'none'::text,
  accepts_remote_inspectors       BOOLEAN     NOT NULL DEFAULT false,
  scope_template_id               UUID,
  claimed_address_text            TEXT,
  claimed_address_geocoded        GEOGRAPHY,
  started_at                      TIMESTAMPTZ,
  cancelled_at                    TIMESTAMPTZ,
  cancelled_by                    UUID,
  cancel_reason                   TEXT,
  payout_paid_at                  TIMESTAMPTZ,
  payout_reference                TEXT,
  payout_notes                    TEXT,
  payout_marked_by                UUID,
  moderation_status               TEXT        NOT NULL DEFAULT 'pending_review'::text,
  moderation_reviewed_at          TIMESTAMPTZ,
  moderation_reviewed_by          UUID,
  moderation_notes                TEXT,
  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES auth.users (id),
  CONSTRAINT jobs_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.profiles (id),
  CONSTRAINT jobs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT jobs_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT jobs_hired_inspector_id_fkey FOREIGN KEY (hired_inspector_id) REFERENCES auth.users (id),
  CONSTRAINT jobs_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES auth.users (id),
  CONSTRAINT jobs_job_country_fk FOREIGN KEY (job_country) REFERENCES public.country_codes (code) ON DELETE RESTRICT,
  CONSTRAINT jobs_moderation_reviewed_by_fkey FOREIGN KEY (moderation_reviewed_by) REFERENCES public.profiles (id),
  CONSTRAINT jobs_admin_confirmed_by_fkey FOREIGN KEY (admin_confirmed_by) REFERENCES auth.users (id),
  CONSTRAINT jobs_payout_marked_by_fkey FOREIGN KEY (payout_marked_by) REFERENCES public.profiles (id),
  CONSTRAINT jobs_report_template_id_fkey FOREIGN KEY (report_template_id) REFERENCES public.report_templates (id) ON DELETE SET NULL,
  CONSTRAINT jobs_scope_template_id_fkey FOREIGN KEY (scope_template_id) REFERENCES public.inspection_scope_templates (id) ON DELETE RESTRICT,
  CONSTRAINT jobs_payout_status_check CHECK (
    payout_status = ANY (ARRAY['unpaid'::text, 'processing'::text, 'paid'::text, 'disputed'::text])
  ),
  CONSTRAINT jobs_compliance_requires_template CHECK (
    (inspection_type = 'compliance' AND scope_template_id IS NOT NULL)
    OR
    (inspection_type = 'quality' AND scope_template_id IS NULL)
  ),
  CONSTRAINT jobs_sponsorship_offered_check CHECK (
    sponsorship_offered = ANY (ARRAY['none'::text, 'visa_assist'::text, 'full_sponsorship'::text])
  ),
  CONSTRAINT jobs_moderation_status_check CHECK (
    moderation_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'edits_requested'::text, 'rejected'::text])
  ),
  CONSTRAINT jobs_owner_xor CHECK (
    (client_id IS NOT NULL AND agency_id IS NULL)
    OR
    (client_id IS NULL AND agency_id IS NOT NULL)
  ),
  CONSTRAINT jobs_status_check CHECK (
    status = ANY (ARRAY['assigned'::text, 'cancelled'::text, 'completed'::text, 'disputed'::text, 'in_progress'::text, 'open'::text])
  )
);

-- ⚠️ KNOWN SCHEMA BUG flagged here so it's visible to operators:
-- jobs.status DEFAULT is 'pending_approval' but jobs_status_check does NOT
-- include that value. A direct INSERT relying on the default would fail.
-- Existing flows always set status explicitly so this hasn't bitten
-- production, but the constraint should eventually be relaxed or the
-- default changed. Out of scope for this baseline.

CREATE INDEX IF NOT EXISTS jobs_geog_open_idx ON public.jobs USING gist (geog) WHERE geog IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_is_featured ON public.jobs (is_featured);
CREATE INDEX IF NOT EXISTS jobs_report_template_id_idx ON public.jobs (report_template_id) WHERE report_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_location_coords ON public.jobs (latitude, longitude);
CREATE INDEX IF NOT EXISTS jobs_specialty_slugs_gin ON public.jobs USING gin (specialty_slugs);
CREATE INDEX IF NOT EXISTS idx_jobs_coords ON public.jobs (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs (status);
CREATE INDEX IF NOT EXISTS jobs_alive_idx ON public.jobs (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS jobs_job_country_idx ON public.jobs (job_country) WHERE job_country IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_sponsorship_offered_idx ON public.jobs (sponsorship_offered) WHERE sponsorship_offered <> 'none';
CREATE INDEX IF NOT EXISTS idx_jobs_platform_spread ON public.jobs (platform_spread_cents);
CREATE INDEX IF NOT EXISTS jobs_pending_payout_idx ON public.jobs (updated_at DESC) WHERE status = 'completed' AND payout_status IS DISTINCT FROM 'paid';
CREATE INDEX IF NOT EXISTS jobs_latlng_open_idx ON public.jobs (latitude, longitude) WHERE status = 'open' AND contractor_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_payout_status ON public.jobs (payout_status);
CREATE INDEX IF NOT EXISTS idx_jobs_admin_confirmed_at ON public.jobs (admin_confirmed_at);
CREATE INDEX IF NOT EXISTS idx_jobs_agency_id_created_at ON public.jobs (agency_id, created_at DESC) WHERE agency_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_moderation_idx ON public.jobs (moderation_status, created_at DESC) WHERE moderation_status IN ('pending_review', 'edits_requested');
CREATE INDEX IF NOT EXISTS idx_jobs_inspection_type_compliance ON public.jobs (inspection_type, created_at DESC) WHERE inspection_type = 'compliance';
CREATE INDEX IF NOT EXISTS idx_jobs_scope_template ON public.jobs (scope_template_id) WHERE scope_template_id IS NOT NULL;


-- ─── public.audit_events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_events (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type      TEXT        NOT NULL,
  severity        TEXT        NOT NULL DEFAULT 'info'::text,
  actor_id        UUID,
  actor_role      TEXT,
  actor_label     TEXT,
  subject_table   TEXT        NOT NULL,
  subject_id      UUID        NOT NULL,
  job_id          UUID,
  summary         TEXT        NOT NULL,
  delta           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  correlation_id  UUID,
  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_severity_check CHECK (
    severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])
  )
);

CREATE INDEX IF NOT EXISTS audit_events_job_timeline_idx ON public.audit_events (job_id, created_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON public.audit_events (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_critical_idx ON public.audit_events (created_at DESC) WHERE severity = 'critical';
CREATE INDEX IF NOT EXISTS audit_events_event_type_idx ON public.audit_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON public.audit_events (subject_table, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_correlation_idx ON public.audit_events (correlation_id, created_at) WHERE correlation_id IS NOT NULL;


COMMENT ON TABLE public.profiles      IS 'Captured from production 2026-05-17. Source of truth for user identity + role + verification state. Baseline.';
COMMENT ON TABLE public.jobs          IS 'Captured from production 2026-05-17. Marketplace job + state machine. Baseline.';
COMMENT ON TABLE public.audit_events  IS 'Captured from production 2026-05-17. Append-only audit trail. Baseline.';
