-- ════════════════════════════════════════════════════════════════════════════
--  20260512150000_jurisdiction_phase1.sql
--  NEXPEC — JURISDICTION-001 (Phase 1 / 5): Schema-only landing for the
--           legal Work-Authorization matcher.
--
--  Closes the operational friction where ineligible inspectors (no legal
--  right to work in the job's country and no sponsorship offered) spam
--  client inboxes. Phase 1 adds the columns and reference data. UI capture,
--  display, enforcement, and verification land in Phases 2-5.
--
--  Decision register (approved by product):
--    D1 HARD BLOCK ineligible applications (enforcement in Phase 4).
--    D2 Country granularity (ISO 3166-1 α-2) for v1.
--    D3 Store expanded atomic codes; never region pseudo-codes.
--    D4 Best-effort reverse-geocode backfill in Phase 2.
--    D5 Stripe coverage warning deferred (separate strike).
--    D6 Strict privacy on uploaded documents — separate self+admin-only
--       table, NEVER readable by clients.
--
--  What lands here
--  ───────────────
--    1. public.country_codes — seeded ISO 3166-1 α-2 reference table with
--       optional region_group tagging (EU / EEA / GCC / USMCA).
--    2. public.profiles new columns:
--         country_of_residence       text  (FK → country_codes.code)
--         work_authorized_countries  text[] DEFAULT '{}'
--         open_to_sponsored_work     boolean DEFAULT false
--         sponsored_countries        text[] DEFAULT '{}'
--         work_auth_verified_at      timestamptz NULL
--         work_auth_verified_by      uuid REFERENCES profiles(id)
--    3. public.jobs new columns:
--         job_country               text  (FK → country_codes.code)
--         sponsorship_offered       text CHECK (none|visa_assist|full_sponsorship)
--         accepts_remote_inspectors boolean DEFAULT false
--    4. public.profile_work_auth_documents — new table holding the
--       sensitive JSONB document refs. RLS: self + super_admin only.
--       Cleanly separated from profiles so the existing RLS-allowed
--       client reads on `profiles` never see the documents column.
--    5. Constraints + indexes:
--         • Country-code shape check (2 upper-case letters).
--         • Array-size caps to prevent runaway storage.
--         • Indexes on country_of_residence, job_country, and a partial
--           GIN on work_authorized_countries for the matcher.
--
--  Hard guarantees
--  ───────────────
--    • Nullable new columns + DEFAULTs → zero data loss on existing rows.
--    • FKs to country_codes use ON DELETE RESTRICT — we never silently
--      void a profile/job's country when an ISO entry is retired.
--    • The applications matcher is NOT touched in this strike. Enforcement
--      lands in Phase 4 once UI capture (Phase 2) has populated the data.
--    • Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. country_codes reference table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.country_codes (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  region_group  text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT country_codes_code_shape
    CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT country_codes_region_group_known
    CHECK (region_group IS NULL OR region_group IN ('EU','EEA','GCC','USMCA'))
);

COMMENT ON TABLE public.country_codes IS
  'JURISDICTION-001: ISO 3166-1 α-2 reference. Source of truth for every country code stored on profiles + jobs. region_group is the primary bundle a country belongs to (EU/EEA/GCC/USMCA) — UX pickers expand bundles into atomic codes per D3.';

CREATE INDEX IF NOT EXISTS country_codes_region_group_idx
  ON public.country_codes (region_group)
  WHERE region_group IS NOT NULL;

-- ─── 1a. Seed ISO 3166-1 α-2 (249 entries) ────────────────────────────────
-- region_group is intentionally NULL for the long tail; we tag only the
-- bundles the UX will expand in v1. Additional groups (ASEAN, MERCOSUR,
-- AU members, etc.) are a future data-only patch — no schema change.

INSERT INTO public.country_codes (code, name, region_group) VALUES
  ('AD','Andorra',NULL),                      ('AE','United Arab Emirates','GCC'),
  ('AF','Afghanistan',NULL),                  ('AG','Antigua and Barbuda',NULL),
  ('AI','Anguilla',NULL),                     ('AL','Albania',NULL),
  ('AM','Armenia',NULL),                      ('AO','Angola',NULL),
  ('AQ','Antarctica',NULL),                   ('AR','Argentina',NULL),
  ('AS','American Samoa',NULL),               ('AT','Austria','EU'),
  ('AU','Australia',NULL),                    ('AW','Aruba',NULL),
  ('AX','Åland Islands',NULL),                ('AZ','Azerbaijan',NULL),
  ('BA','Bosnia and Herzegovina',NULL),       ('BB','Barbados',NULL),
  ('BD','Bangladesh',NULL),                   ('BE','Belgium','EU'),
  ('BF','Burkina Faso',NULL),                 ('BG','Bulgaria','EU'),
  ('BH','Bahrain','GCC'),                     ('BI','Burundi',NULL),
  ('BJ','Benin',NULL),                        ('BL','Saint Barthélemy',NULL),
  ('BM','Bermuda',NULL),                      ('BN','Brunei Darussalam',NULL),
  ('BO','Bolivia',NULL),                      ('BQ','Bonaire, Sint Eustatius and Saba',NULL),
  ('BR','Brazil',NULL),                       ('BS','Bahamas',NULL),
  ('BT','Bhutan',NULL),                       ('BV','Bouvet Island',NULL),
  ('BW','Botswana',NULL),                     ('BY','Belarus',NULL),
  ('BZ','Belize',NULL),                       ('CA','Canada','USMCA'),
  ('CC','Cocos (Keeling) Islands',NULL),      ('CD','Congo, Democratic Republic',NULL),
  ('CF','Central African Republic',NULL),     ('CG','Congo',NULL),
  ('CH','Switzerland',NULL),                  ('CI','Côte d''Ivoire',NULL),
  ('CK','Cook Islands',NULL),                 ('CL','Chile',NULL),
  ('CM','Cameroon',NULL),                     ('CN','China',NULL),
  ('CO','Colombia',NULL),                     ('CR','Costa Rica',NULL),
  ('CU','Cuba',NULL),                         ('CV','Cabo Verde',NULL),
  ('CW','Curaçao',NULL),                      ('CX','Christmas Island',NULL),
  ('CY','Cyprus','EU'),                       ('CZ','Czechia','EU'),
  ('DE','Germany','EU'),                      ('DJ','Djibouti',NULL),
  ('DK','Denmark','EU'),                      ('DM','Dominica',NULL),
  ('DO','Dominican Republic',NULL),           ('DZ','Algeria',NULL),
  ('EC','Ecuador',NULL),                      ('EE','Estonia','EU'),
  ('EG','Egypt',NULL),                        ('EH','Western Sahara',NULL),
  ('ER','Eritrea',NULL),                      ('ES','Spain','EU'),
  ('ET','Ethiopia',NULL),                     ('FI','Finland','EU'),
  ('FJ','Fiji',NULL),                         ('FK','Falkland Islands',NULL),
  ('FM','Micronesia',NULL),                   ('FO','Faroe Islands',NULL),
  ('FR','France','EU'),                       ('GA','Gabon',NULL),
  ('GB','United Kingdom',NULL),               ('GD','Grenada',NULL),
  ('GE','Georgia',NULL),                      ('GF','French Guiana',NULL),
  ('GG','Guernsey',NULL),                     ('GH','Ghana',NULL),
  ('GI','Gibraltar',NULL),                    ('GL','Greenland',NULL),
  ('GM','Gambia',NULL),                       ('GN','Guinea',NULL),
  ('GP','Guadeloupe',NULL),                   ('GQ','Equatorial Guinea',NULL),
  ('GR','Greece','EU'),                       ('GS','South Georgia & South Sandwich Is.',NULL),
  ('GT','Guatemala',NULL),                    ('GU','Guam',NULL),
  ('GW','Guinea-Bissau',NULL),                ('GY','Guyana',NULL),
  ('HK','Hong Kong',NULL),                    ('HM','Heard Island and McDonald Islands',NULL),
  ('HN','Honduras',NULL),                     ('HR','Croatia','EU'),
  ('HT','Haiti',NULL),                        ('HU','Hungary','EU'),
  ('ID','Indonesia',NULL),                    ('IE','Ireland','EU'),
  ('IL','Israel',NULL),                       ('IM','Isle of Man',NULL),
  ('IN','India',NULL),                        ('IO','British Indian Ocean Territory',NULL),
  ('IQ','Iraq',NULL),                         ('IR','Iran',NULL),
  ('IS','Iceland','EEA'),                     ('IT','Italy','EU'),
  ('JE','Jersey',NULL),                       ('JM','Jamaica',NULL),
  ('JO','Jordan',NULL),                       ('JP','Japan',NULL),
  ('KE','Kenya',NULL),                        ('KG','Kyrgyzstan',NULL),
  ('KH','Cambodia',NULL),                     ('KI','Kiribati',NULL),
  ('KM','Comoros',NULL),                      ('KN','Saint Kitts and Nevis',NULL),
  ('KP','Korea, Democratic People''s Rep.',NULL), ('KR','Korea, Republic of',NULL),
  ('KW','Kuwait','GCC'),                      ('KY','Cayman Islands',NULL),
  ('KZ','Kazakhstan',NULL),                   ('LA','Lao PDR',NULL),
  ('LB','Lebanon',NULL),                      ('LC','Saint Lucia',NULL),
  ('LI','Liechtenstein','EEA'),               ('LK','Sri Lanka',NULL),
  ('LR','Liberia',NULL),                      ('LS','Lesotho',NULL),
  ('LT','Lithuania','EU'),                    ('LU','Luxembourg','EU'),
  ('LV','Latvia','EU'),                       ('LY','Libya',NULL),
  ('MA','Morocco',NULL),                      ('MC','Monaco',NULL),
  ('MD','Moldova',NULL),                      ('ME','Montenegro',NULL),
  ('MF','Saint Martin (French part)',NULL),   ('MG','Madagascar',NULL),
  ('MH','Marshall Islands',NULL),             ('MK','North Macedonia',NULL),
  ('ML','Mali',NULL),                         ('MM','Myanmar',NULL),
  ('MN','Mongolia',NULL),                     ('MO','Macao',NULL),
  ('MP','Northern Mariana Islands',NULL),     ('MQ','Martinique',NULL),
  ('MR','Mauritania',NULL),                   ('MS','Montserrat',NULL),
  ('MT','Malta','EU'),                        ('MU','Mauritius',NULL),
  ('MV','Maldives',NULL),                     ('MW','Malawi',NULL),
  ('MX','Mexico','USMCA'),                    ('MY','Malaysia',NULL),
  ('MZ','Mozambique',NULL),                   ('NA','Namibia',NULL),
  ('NC','New Caledonia',NULL),                ('NE','Niger',NULL),
  ('NF','Norfolk Island',NULL),               ('NG','Nigeria',NULL),
  ('NI','Nicaragua',NULL),                    ('NL','Netherlands','EU'),
  ('NO','Norway','EEA'),                      ('NP','Nepal',NULL),
  ('NR','Nauru',NULL),                        ('NU','Niue',NULL),
  ('NZ','New Zealand',NULL),                  ('OM','Oman','GCC'),
  ('PA','Panama',NULL),                       ('PE','Peru',NULL),
  ('PF','French Polynesia',NULL),             ('PG','Papua New Guinea',NULL),
  ('PH','Philippines',NULL),                  ('PK','Pakistan',NULL),
  ('PL','Poland','EU'),                       ('PM','Saint Pierre and Miquelon',NULL),
  ('PN','Pitcairn',NULL),                     ('PR','Puerto Rico',NULL),
  ('PS','Palestine, State of',NULL),          ('PT','Portugal','EU'),
  ('PW','Palau',NULL),                        ('PY','Paraguay',NULL),
  ('QA','Qatar','GCC'),                       ('RE','Réunion',NULL),
  ('RO','Romania','EU'),                      ('RS','Serbia',NULL),
  ('RU','Russian Federation',NULL),           ('RW','Rwanda',NULL),
  ('SA','Saudi Arabia','GCC'),                ('SB','Solomon Islands',NULL),
  ('SC','Seychelles',NULL),                   ('SD','Sudan',NULL),
  ('SE','Sweden','EU'),                       ('SG','Singapore',NULL),
  ('SH','Saint Helena, Ascension and Tristan da Cunha',NULL),
                                              ('SI','Slovenia','EU'),
  ('SJ','Svalbard and Jan Mayen',NULL),       ('SK','Slovakia','EU'),
  ('SL','Sierra Leone',NULL),                 ('SM','San Marino',NULL),
  ('SN','Senegal',NULL),                      ('SO','Somalia',NULL),
  ('SR','Suriname',NULL),                     ('SS','South Sudan',NULL),
  ('ST','Sao Tome and Principe',NULL),        ('SV','El Salvador',NULL),
  ('SX','Sint Maarten (Dutch part)',NULL),    ('SY','Syrian Arab Republic',NULL),
  ('SZ','Eswatini',NULL),                     ('TC','Turks and Caicos Islands',NULL),
  ('TD','Chad',NULL),                         ('TF','French Southern Territories',NULL),
  ('TG','Togo',NULL),                         ('TH','Thailand',NULL),
  ('TJ','Tajikistan',NULL),                   ('TK','Tokelau',NULL),
  ('TL','Timor-Leste',NULL),                  ('TM','Turkmenistan',NULL),
  ('TN','Tunisia',NULL),                      ('TO','Tonga',NULL),
  ('TR','Türkiye',NULL),                      ('TT','Trinidad and Tobago',NULL),
  ('TV','Tuvalu',NULL),                       ('TW','Taiwan',NULL),
  ('TZ','Tanzania',NULL),                     ('UA','Ukraine',NULL),
  ('UG','Uganda',NULL),                       ('UM','US Minor Outlying Islands',NULL),
  ('US','United States','USMCA'),             ('UY','Uruguay',NULL),
  ('UZ','Uzbekistan',NULL),                   ('VA','Holy See (Vatican City State)',NULL),
  ('VC','Saint Vincent and the Grenadines',NULL), ('VE','Venezuela',NULL),
  ('VG','Virgin Islands, British',NULL),      ('VI','Virgin Islands, U.S.',NULL),
  ('VN','Viet Nam',NULL),                     ('VU','Vanuatu',NULL),
  ('WF','Wallis and Futuna',NULL),            ('WS','Samoa',NULL),
  ('YE','Yemen',NULL),                        ('YT','Mayotte',NULL),
  ('ZA','South Africa',NULL),                 ('ZM','Zambia',NULL),
  ('ZW','Zimbabwe',NULL)
ON CONFLICT (code) DO NOTHING;


-- ─── 1b. RLS on country_codes ──────────────────────────────────────────────
-- Read-by-all (authenticated + anon for pre-login pickers). Only super_admin
-- (or service_role bypass) may write.

ALTER TABLE public.country_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS country_codes_select ON public.country_codes;
DROP POLICY IF EXISTS country_codes_write_admin ON public.country_codes;

CREATE POLICY country_codes_select
  ON public.country_codes
  FOR SELECT
  USING (true);

CREATE POLICY country_codes_write_admin
  ON public.country_codes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );


-- ─── 2. profiles — new columns ─────────────────────────────────────────────
-- All nullable / safe-defaulted so existing rows survive without backfill.
-- Backfill is Phase 2's job (reverse-geocode home_base + confirmation banner).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country_of_residence      text NULL,
  ADD COLUMN IF NOT EXISTS work_authorized_countries text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS open_to_sponsored_work    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_countries       text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS work_auth_verified_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS work_auth_verified_by     uuid NULL;

-- FK to country_codes — ON DELETE RESTRICT so retiring an ISO code can't
-- silently void a profile's residence. Wrapped in a DO block because
-- ALTER TABLE ADD CONSTRAINT doesn't support IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_country_of_residence_fk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_country_of_residence_fk
      FOREIGN KEY (country_of_residence)
      REFERENCES public.country_codes(code)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_work_auth_verified_by_fk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_work_auth_verified_by_fk
      FOREIGN KEY (work_auth_verified_by)
      REFERENCES public.profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Shape + cap constraints. Cardinality caps prevent runaway storage from
-- abusive clients or a buggy picker.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_work_authorized_countries_cap'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_work_authorized_countries_cap
      CHECK (cardinality(work_authorized_countries) <= 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_sponsored_countries_cap'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_sponsored_countries_cap
      CHECK (cardinality(sponsored_countries) <= 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_verified_pair_or_neither'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_verified_pair_or_neither
      CHECK (
        (work_auth_verified_at IS NULL AND work_auth_verified_by IS NULL)
        OR
        (work_auth_verified_at IS NOT NULL AND work_auth_verified_by IS NOT NULL)
      );
  END IF;
END $$;

-- Indexes for the Phase-4 matcher.
CREATE INDEX IF NOT EXISTS profiles_country_of_residence_idx
  ON public.profiles (country_of_residence)
  WHERE country_of_residence IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_work_authorized_countries_gin
  ON public.profiles USING GIN (work_authorized_countries);

CREATE INDEX IF NOT EXISTS profiles_sponsored_countries_gin
  ON public.profiles USING GIN (sponsored_countries)
  WHERE open_to_sponsored_work = true;

COMMENT ON COLUMN public.profiles.country_of_residence IS
  'JURISDICTION-001: Inspector tax home (ISO 3166-1 α-2). Drives 1099/W-8BEN selection in a future strike. NULL until declared.';
COMMENT ON COLUMN public.profiles.work_authorized_countries IS
  'JURISDICTION-001: Atomic ISO codes where the inspector can legally accept paid work WITHOUT sponsorship. Empty array is legal (none declared yet).';
COMMENT ON COLUMN public.profiles.open_to_sponsored_work IS
  'JURISDICTION-001: True iff inspector accepts jobs that require client-paid visa/relocation.';
COMMENT ON COLUMN public.profiles.sponsored_countries IS
  'JURISDICTION-001: Optional preferred sponsored destinations. Empty + open_to_sponsored_work=true means "anywhere with sponsorship".';
COMMENT ON COLUMN public.profiles.work_auth_verified_at IS
  'JURISDICTION-001: Set by super_admin after document review. Trust signal — never a gate (Phase 5).';


-- ─── 3. jobs — new columns ─────────────────────────────────────────────────
-- job_country is nullable in Phase 1 (existing rows have none); Phase 2
-- backfills via post-job UI and a one-time best-effort reverse-geocode
-- on jobs.location. Phase 4 makes it NOT NULL once the data is dense.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_country               text NULL,
  ADD COLUMN IF NOT EXISTS sponsorship_offered       text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS accepts_remote_inspectors boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_job_country_fk'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_job_country_fk
      FOREIGN KEY (job_country)
      REFERENCES public.country_codes(code)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_sponsorship_offered_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_sponsorship_offered_check
      CHECK (sponsorship_offered IN ('none','visa_assist','full_sponsorship'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jobs_job_country_idx
  ON public.jobs (job_country)
  WHERE job_country IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_sponsorship_offered_idx
  ON public.jobs (sponsorship_offered)
  WHERE sponsorship_offered <> 'none';

COMMENT ON COLUMN public.jobs.job_country IS
  'JURISDICTION-001: Country (ISO 3166-1 α-2) where the work physically takes place. Nullable in Phase 1; becomes mandatory after Phase 2 capture is rolled out.';
COMMENT ON COLUMN public.jobs.sponsorship_offered IS
  'JURISDICTION-001: Client''s sponsorship policy. none = inspector must already be authorized; visa_assist = client handles paperwork; full_sponsorship = client covers paperwork + relocation.';
COMMENT ON COLUMN public.jobs.accepts_remote_inspectors IS
  'JURISDICTION-001: Future-proof flag for desk-review / report-only work. Out of scope for v1 matching but reserved to avoid a future migration.';


-- ─── 4. profile_work_auth_documents — sensitive document store ─────────────
-- D6: documents are visible to self + super_admin only — NEVER clients,
-- agencies, or other inspectors. Separated from profiles so the existing
-- RLS-allowed reads on profiles (clients seeing applicant info, etc.)
-- can NEVER accidentally surface document metadata. Cleanest isolation:
-- a new row-level-secured table.

CREATE TABLE IF NOT EXISTS public.profile_work_auth_documents (
  profile_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  documents    jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_work_auth_documents_documents_is_array
    CHECK (jsonb_typeof(documents) = 'array')
);

COMMENT ON TABLE public.profile_work_auth_documents IS
  'JURISDICTION-001 (D6): sensitive work-authorization document references. RLS-gated to self + super_admin only. Storage refs (storage paths/URLs/exp dates) live in the JSONB; bytes themselves live in Supabase Storage.';

CREATE INDEX IF NOT EXISTS profile_work_auth_documents_updated_at_idx
  ON public.profile_work_auth_documents (updated_at DESC);

ALTER TABLE public.profile_work_auth_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pwad_select_self           ON public.profile_work_auth_documents;
DROP POLICY IF EXISTS pwad_select_admin          ON public.profile_work_auth_documents;
DROP POLICY IF EXISTS pwad_insert_self           ON public.profile_work_auth_documents;
DROP POLICY IF EXISTS pwad_update_self_or_admin  ON public.profile_work_auth_documents;
DROP POLICY IF EXISTS pwad_delete_self_or_admin  ON public.profile_work_auth_documents;

CREATE POLICY pwad_select_self
  ON public.profile_work_auth_documents
  FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY pwad_select_admin
  ON public.profile_work_auth_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

CREATE POLICY pwad_insert_self
  ON public.profile_work_auth_documents
  FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY pwad_update_self_or_admin
  ON public.profile_work_auth_documents
  FOR UPDATE
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

CREATE POLICY pwad_delete_self_or_admin
  ON public.profile_work_auth_documents
  FOR DELETE
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );


-- ─── 5. updated_at touch trigger on profile_work_auth_documents ───────────

CREATE OR REPLACE FUNCTION public._touch_updated_at_pwad()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pwad_touch_updated_at ON public.profile_work_auth_documents;
CREATE TRIGGER pwad_touch_updated_at
  BEFORE UPDATE ON public.profile_work_auth_documents
  FOR EACH ROW
  EXECUTE FUNCTION public._touch_updated_at_pwad();


COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. country_codes seeded
-- SELECT count(*) FROM public.country_codes;                       -- expect 249
-- SELECT count(*) FROM public.country_codes WHERE region_group = 'EU';   -- 27
-- SELECT count(*) FROM public.country_codes WHERE region_group = 'EEA';  -- 3 (IS, LI, NO)
-- SELECT count(*) FROM public.country_codes WHERE region_group = 'GCC';  -- 6
-- SELECT count(*) FROM public.country_codes WHERE region_group = 'USMCA'; -- 3

-- B. profiles new columns + defaults
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='profiles'
--   AND column_name IN ('country_of_residence','work_authorized_countries',
--                       'open_to_sponsored_work','sponsored_countries',
--                       'work_auth_verified_at','work_auth_verified_by');
-- Expected: country_of_residence nullable=YES, the two array cols default '{}',
--           open_to_sponsored_work default false, verified pair nullable.

-- C. jobs new columns
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='jobs'
--   AND column_name IN ('job_country','sponsorship_offered','accepts_remote_inspectors');
-- Expected: job_country nullable, sponsorship_offered NOT NULL default 'none',
--           accepts_remote_inspectors NOT NULL default false.

-- D. FKs in place
-- SELECT conname FROM pg_constraint WHERE conname IN (
--   'profiles_country_of_residence_fk',
--   'profiles_work_auth_verified_by_fk',
--   'jobs_job_country_fk'
-- );
-- Expected: 3 rows.

-- E. CHECK constraints in place
-- SELECT conname FROM pg_constraint WHERE conname IN (
--   'country_codes_code_shape', 'country_codes_region_group_known',
--   'jobs_sponsorship_offered_check',
--   'profiles_work_authorized_countries_cap',
--   'profiles_sponsored_countries_cap',
--   'profiles_verified_pair_or_neither',
--   'profile_work_auth_documents_documents_is_array'
-- );
-- Expected: 7 rows.

-- F. Bad-input rejection — sponsorship_offered enum
-- BEGIN;
--   UPDATE public.jobs SET sponsorship_offered = 'maybe' WHERE id = (SELECT id FROM jobs LIMIT 1);
--   -- expect: ERROR (jobs_sponsorship_offered_check)
-- ROLLBACK;

-- G. RLS smoke — country_codes readable by anon
-- SET ROLE anon;
-- SELECT count(*) FROM public.country_codes;     -- expect 249, NO ERROR
-- RESET ROLE;

-- H. RLS smoke — profile_work_auth_documents isolated
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<some-other-uuid>","role":"authenticated"}';
--   SELECT * FROM public.profile_work_auth_documents WHERE profile_id = '<your-uuid>';
--   -- expect: 0 rows (default-deny — you're not self, you're not admin)
-- ROLLBACK;


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback — Supabase CLI does not auto-execute down sections)
-- ────────────────────────────────────────────────────────────────────────────
--  Copy/paste the block below into the SQL editor if a rollback is needed.
--
--  BEGIN;
--    -- 4. document table + trigger
--    DROP TRIGGER IF EXISTS pwad_touch_updated_at ON public.profile_work_auth_documents;
--    DROP FUNCTION IF EXISTS public._touch_updated_at_pwad();
--    DROP TABLE   IF EXISTS public.profile_work_auth_documents;
--
--    -- 3. jobs columns
--    DROP INDEX IF EXISTS public.jobs_sponsorship_offered_idx;
--    DROP INDEX IF EXISTS public.jobs_job_country_idx;
--    ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_sponsorship_offered_check;
--    ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_job_country_fk;
--    ALTER TABLE public.jobs
--      DROP COLUMN IF EXISTS accepts_remote_inspectors,
--      DROP COLUMN IF EXISTS sponsorship_offered,
--      DROP COLUMN IF EXISTS job_country;
--
--    -- 2. profiles columns
--    DROP INDEX IF EXISTS public.profiles_sponsored_countries_gin;
--    DROP INDEX IF EXISTS public.profiles_work_authorized_countries_gin;
--    DROP INDEX IF EXISTS public.profiles_country_of_residence_idx;
--    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_verified_pair_or_neither;
--    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_sponsored_countries_cap;
--    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_work_authorized_countries_cap;
--    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_work_auth_verified_by_fk;
--    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_country_of_residence_fk;
--    ALTER TABLE public.profiles
--      DROP COLUMN IF EXISTS work_auth_verified_by,
--      DROP COLUMN IF EXISTS work_auth_verified_at,
--      DROP COLUMN IF EXISTS sponsored_countries,
--      DROP COLUMN IF EXISTS open_to_sponsored_work,
--      DROP COLUMN IF EXISTS work_authorized_countries,
--      DROP COLUMN IF EXISTS country_of_residence;
--
--    -- 1. country_codes
--    DROP POLICY IF EXISTS country_codes_write_admin ON public.country_codes;
--    DROP POLICY IF EXISTS country_codes_select     ON public.country_codes;
--    DROP INDEX  IF EXISTS public.country_codes_region_group_idx;
--    DROP TABLE  IF EXISTS public.country_codes;
--  COMMIT;
