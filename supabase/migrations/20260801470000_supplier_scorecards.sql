-- ════════════════════════════════════════════════════════════════════════════
--  20260801470000_supplier_scorecards.sql
--
--  Phase 5 — Supplier Scorecards. Derived supplier performance, from rows that
--  already exist. PHASE-INVENTORY.md:289 records this phase as not started and
--  re-verifies that `grep -ril "scorecard"` returns zero matches across
--  supabase/migrations, src/ and apps/web/src. Confirmed again at this HEAD.
--
--  ── EVERYTHING HERE IS DERIVED FROM EXISTING TABLES ────────────────────────
--  No new operational table is introduced. The three tables added below are
--  CONFIGURATION ONLY — a metric registry, a confidence ladder, and a singleton
--  policy row. Not one of them stores a score. Scores are computed on read, the
--  same discipline 20260801468000 applied to nx_program_rollup ("ROLLUP IS
--  DERIVED, NOT STORED") and 20260801406000 applied to QCP progress ("PROGRESS
--  IS DERIVED, NEVER STORED"). A stored score would be a second source of truth
--  that drifts the first time an NCR is closed. A self-test refuses one.
--
--  ── REUSE, AND THE PROOF THERE IS NO V2 ────────────────────────────────────
--  Every fact this lane needs already had an owner, and each is CALLED, never
--  re-implemented:
--
--    supplier ↔ job          public.nx_is_job_supplier(uuid,uuid)
--                            20260801340000:79 — "The single definition of
--                            'this supplier belongs to this job'". Called by
--                            nx_supplier_scorecard_jobs; NOT inlined, so the
--                            contract/accepted-quote rule keeps one definition.
--    buyer ↔ supplier        public.nx_buyer_supplier_related(uuid,uuid)
--                            20260801340000:159 — presented/accepted quote or
--                            live contract. Reused verbatim for read authority.
--    buyer org expansion     public.nx_is_buyer_principal_side(uuid,uuid)
--                            20260801340000:196 — principal or non-viewer
--                            teammate. Reused so scorecard visibility and chat
--                            visibility cannot drift apart.
--    admin                   public.nx_is_admin(uuid)  baseline:14551
--    NCR                     public.flash_reports. There is NO NCR table in
--                            this schema and this lane does not add one.
--                            20260801406000:49-53 states the rule — "A QCP
--                            nonconformance is an ordinary flash report … No
--                            table, no bridge, no second NCR path" — and
--                            20260801410000:1298 already fails the build if
--                            public.ncr_reports appears. Reproduced here.
--    supplier documents      public.vendor_documents (baseline) — vendor_id,
--                            doc_type, status, expires_at.
--    inspection outcome      public.itp_point_results (20260801398000).
--    directory               public.supplier_directory (baseline:24513) is
--                            left exactly as it is. No second directory, no
--                            second supplier profile table.
--
--  ── RECONCILIATION WITH supplier_profiles.rating_avg ───────────────────────
--  supplier_profiles already carries rating_avg / rating_count (baseline:18426).
--  That is NOT superseded, NOT written by this lane, and NOT duplicated. It
--  answers a DIFFERENT question, and the split is the same one 20260801434000
--  drew between certifications.status and inspector_credentials:
--
--    rating_avg  — SUBJECTIVE buyer sentiment, a review average.
--    scorecard   — OBJECTIVE operational evidence, derived from RFQ, ITP, NCR,
--                  document and schedule rows, each traceable to its row ids.
--
--  Both are authoritative for their own question; neither supersedes the other.
--  This migration writes nothing to supplier_profiles.
--
--  OPEN, REPORTED, NOT FIXED — and the reason this lane's precision rule exists:
--  rating_avg has ZERO writers anywhere in supabase/migrations, yet three web
--  surfaces render it as `Number(rating_avg ?? 0).toFixed(1)` —
--  apps/web/src/app/suppliers/dashboard/page.tsx:105,
--  apps/web/src/app/(marketplace)/directory/page.tsx:77 and
--  apps/web/src/app/(marketplace)/directory/[id]/page.tsx:73. A supplier with no
--  reviews at all is therefore displayed as a confident "0.0". That is exactly
--  the fake precision this lane is built to avoid, and it is why the rule below
--  lives in the DATA MODEL and not in a component. Those files belong to other
--  lanes and are not touched here.
--
--  ── THE QUALITY RULE, ENFORCED IN THE SCHEMA ───────────────────────────────
--  "Keep scorecards explainable and avoid fake precision. Every score must be
--  traceable to the rows that produced it, and must state its sample size. Do
--  not emit a 2-decimal score from 3 data points."
--
--  Four mechanisms, all structural rather than advisory:
--
--   1. SAMPLE SIZE IS NOT OPTIONAL. Every metric returns `sample_size` and
--      `numerator` alongside its score. There is no code path that emits a
--      score without them — they are built in the same jsonb_build_object.
--
--   2. PRECISION IS A FUNCTION OF SAMPLE SIZE, AND IT IS DATA.
--      supplier_scorecard_confidence_bands maps n to an INTEGER rounding_step.
--      Because the step is an integer and rounding is to a multiple of it, a
--      fractional score is UNREPRESENTABLE — the 2-decimal score from 3 data
--      points cannot be produced, whatever a caller asks for. At n = 3 the band
--      is `insufficient`, whose step is 0, which means "emit no score at all".
--
--      The ladder is not arbitrary. The standard error of a proportion is
--      bounded by 0.5/sqrt(n); on a 0-100 scale that is 50/sqrt(n) points —
--      about 22 points at n = 5, 14 at n = 12, 9 at n = 30. Reporting finer
--      than the error is the definition of fake precision, so the step is kept
--      coarser than it: 10 / 5 / 1. Even at n = 30 a decimal would be a lie,
--      which is why NO band has a fractional step.
--
--   3. THIN EVIDENCE IS STATED, NOT HIDDEN. Below its minimum the metric
--      returns score = NULL with a band of `insufficient` or `none` and a
--      `reason`. NULL, never 0 — a zero score asserts bad performance, while
--      absent evidence asserts nothing. Every metric also returns a Wilson
--      score interval, so thinness is visible as a WIDTH rather than inferred.
--
--   4. TRACEABILITY IS A FUNCTION, NOT A PROMISE.
--      nx_supplier_scorecard_evidence(supplier, metric) returns the individual
--      rows — kind, id, timestamp, and whether that row counted toward the
--      numerator. Every metric row in the registry must also declare, NOT NULL,
--      the table it reads (evidence_source) and what it actually measures
--      (measures). A metric cannot exist without saying where it came from.
--
--  ── NO MONEY. AT ALL. ──────────────────────────────────────────────────────
--  A scorecard is a performance instrument and touches no financial surface.
--  It reads no wallet, ledger, payout, settlement or price column. In
--  particular supplier_contracts.amount_cents, supplier_quotes.client_price_cents,
--  supplier_releases.amount_halalas and supplier_earnings are ALL out of scope
--  and none is referenced. Deliberately, delivery timeliness is derived from
--  jobs.scheduled_date / jobs.started_at rather than from a release or
--  settlement row, so no money table is joined even indirectly. Asserted in §6.
--
--  ── CROSS-ORG LEAKAGE IS THE P0 ────────────────────────────────────────────
--  A supplier must never see another supplier's scorecard. Read authority is
--  RELATIONSHIP-based, not role-based, and lives in exactly one predicate,
--  nx_can_view_supplier_scorecard: admin, the supplier themselves, or a buyer
--  who is principal-side of an RFQ that this supplier actually has a presented/
--  accepted quote or live contract on. Being a supplier grants nothing. Every
--  RPC re-checks the same predicate rather than restating a rule, and the
--  config tables carry no supplier data at all.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  1. The confidence ladder — where "the evidence is thin" lives in the schema
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.supplier_scorecard_confidence_bands (
  band           text    PRIMARY KEY,
  min_sample     integer NOT NULL,
  rounding_step  integer NOT NULL,
  label          text    NOT NULL,
  sort           integer NOT NULL DEFAULT 100,
  CONSTRAINT ssc_bands_band_check CHECK (
    band = ANY (ARRAY['none','insufficient','low','moderate','high'])),
  CONSTRAINT ssc_bands_min_sample_nonneg CHECK (min_sample >= 0),
  -- 0 means "do not emit a score at this sample size". Every other step is a
  -- WHOLE number of points, which is what makes a fractional score
  -- unrepresentable rather than merely discouraged.
  CONSTRAINT ssc_bands_step_whole CHECK (rounding_step IN (0, 1, 5, 10))
);

INSERT INTO public.supplier_scorecard_confidence_bands
  (band, min_sample, rounding_step, label, sort)
VALUES
  ('none',         0,  0,  'No evidence',                     10),
  ('insufficient', 1,  0,  'Too few observations to score',    20),
  ('low',          5,  10, 'Indicative only (nearest 10)',     30),
  ('moderate',     12, 5,  'Moderate confidence (nearest 5)',  40),
  ('high',         30, 1,  'High confidence (nearest point)',  50)
ON CONFLICT (band) DO NOTHING;   -- never overwrite an Admin-tuned ladder

COMMENT ON TABLE public.supplier_scorecard_confidence_bands IS
  'The anti-fake-precision ladder, as DATA rather than as a rule in a component. Maps a '
  'sample size to the coarsest honest reporting precision. rounding_step is an INTEGER '
  'number of points and a score is rounded to a multiple of it, so a fractional score is '
  'unrepresentable by construction — the "2-decimal score from 3 data points" cannot be '
  'produced whatever a caller requests. step 0 means emit NO score. Calibrated against the '
  '0.5/sqrt(n) bound on the standard error of a proportion (about 22 points at n=5, 14 at '
  'n=12, 9 at n=30), deliberately kept coarser than the error it is hiding.';

COMMENT ON COLUMN public.supplier_scorecard_confidence_bands.rounding_step IS
  'Whole points to round the score to. 0 = emit no score at this sample size (score NULL, '
  'never 0 — absent evidence asserts nothing, a zero asserts bad performance). No band may '
  'carry a fractional step; ssc_bands_step_whole enforces it.';

-- ════════════════════════════════════════════════════════════════════════════
--  2. The metric registry — a metric must declare its source and its meaning
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.supplier_scorecard_metrics (
  metric_key       text    PRIMARY KEY,
  label            text    NOT NULL,
  dimension        text    NOT NULL,
  weight_bps       integer NOT NULL,
  min_sample_size  integer NOT NULL DEFAULT 5,
  -- NOT NULL on purpose: an unexplainable metric must be impossible to add.
  evidence_source  text    NOT NULL,
  measures         text    NOT NULL,
  params           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  is_active        boolean NOT NULL DEFAULT true,
  sort             integer NOT NULL DEFAULT 100,
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  updated_at       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ssc_metrics_dimension_check CHECK (
    dimension = ANY (ARRAY['responsiveness','quality','compliance','delivery'])),
  CONSTRAINT ssc_metrics_weight_rng   CHECK (weight_bps BETWEEN 0 AND 10000),
  -- A metric may not declare itself scoreable on fewer than 3 observations.
  -- The band ladder would refuse anyway; this states the floor declaratively.
  CONSTRAINT ssc_metrics_min_sample_floor CHECK (min_sample_size >= 3),
  CONSTRAINT ssc_metrics_source_not_blank   CHECK (length(btrim(evidence_source)) > 0),
  CONSTRAINT ssc_metrics_measures_not_blank CHECK (length(btrim(measures))        > 0)
);

COMMENT ON TABLE public.supplier_scorecard_metrics IS
  'Registry of the derived supplier performance metrics. Configuration only — it stores no '
  'score and no supplier reference. evidence_source and measures are NOT NULL so a metric '
  'cannot be added without declaring which existing table it reads and what it actually '
  'measures; that pair is the explainability contract in the schema rather than in a doc. '
  'weight_bps is RELATIVE: the composite normalises over only the metrics that reached '
  'their minimum sample, so a metric with thin evidence drops out instead of silently '
  'dragging the total. Seeded weights total 10000 for readability only.';

COMMENT ON COLUMN public.supplier_scorecard_metrics.measures IS
  'Plain-English statement of exactly what the ratio means, INCLUDING what is excluded from '
  'the denominator. Surfaced verbatim by nx_supplier_scorecard so a reader is never shown a '
  'number without its definition.';

COMMENT ON COLUMN public.supplier_scorecard_metrics.min_sample_size IS
  'Below this many observations the metric returns score NULL with band insufficient. May '
  'raise the bar above the shared confidence ladder for a metric that deserves it; it can '
  'never lower it, because the ladder is applied as well.';

INSERT INTO public.supplier_scorecard_metrics
  (metric_key, label, dimension, weight_bps, min_sample_size, evidence_source, measures, params, sort)
VALUES
  ('rfq_response_timeliness', 'RFQ response timeliness', 'responsiveness', 1200, 5,
   'supplier_quotes JOIN supplier_rfqs',
   'Share of this supplier''s quotes submitted within the response window of the RFQ being opened. Quotes whose RFQ has no creation timestamp are excluded from both sides.',
   '{"response_window_hours": 168}'::jsonb, 10),

  ('quote_follow_through', 'Quote follow-through', 'responsiveness', 800, 5,
   'supplier_quotes',
   'Share of this supplier''s quotes that were not withdrawn. Measures whether a quote, once given, is honoured as a commitment.',
   '{}'::jsonb, 20),

  ('inspection_pass_rate', 'Inspection pass rate', 'quality', 2500, 5,
   'itp_point_results',
   'Share of DECIDED ITP points on this supplier''s inspected jobs recorded as passed. Pending, waived and not-applicable points are excluded from both sides, so an undecided point neither helps nor harms.',
   '{}'::jsonb, 30),

  ('ncr_free_jobs', 'NCR-free jobs', 'quality', 2000, 5,
   'jobs LEFT JOIN flash_reports',
   'Share of this supplier''s INSPECTED jobs that raised no NCR. A job with no inspection evidence at all is excluded, so an uninspected job can never count as clean.',
   '{}'::jsonb, 40),

  ('ncr_closure', 'NCR closure', 'quality', 1500, 5,
   'flash_reports',
   'Share of NCRs raised on this supplier''s jobs that reached resolved or closed. Measures remediation follow-through, not how many NCRs were raised.',
   '{}'::jsonb, 50),

  ('document_currency', 'Document currency', 'compliance', 1000, 3,
   'vendor_documents',
   'Share of this supplier''s ACTIVE documents that are unexpired. Measures whether documents on file are kept current — NOT completeness against a required document set, which this schema does not define.',
   '{}'::jsonb, 60),

  ('delivery_timeliness', 'Delivery timeliness', 'delivery', 1000, 5,
   'jobs',
   'Share of this supplier''s jobs whose source inspection started on or before the scheduled date, plus a grace window. Jobs missing either a scheduled date or a start timestamp are excluded from both sides rather than assumed on time.',
   '{"grace_hours": 24}'::jsonb, 70)
ON CONFLICT (metric_key) DO NOTHING;   -- never overwrite Admin-tuned config

-- ════════════════════════════════════════════════════════════════════════════
--  3. Singleton policy row — same shape as funding_term_defaults (448000 §1)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.supplier_scorecard_policy (
  id                        integer PRIMARY KEY DEFAULT 1,
  min_metrics_for_composite integer NOT NULL DEFAULT 2,
  -- THOUSANDTHS, not basis points. 1960 = z 1.96. Named for the divisor it is
  -- actually used with, because a column called *_bps that is divided by 1000
  -- is a defect waiting to be "corrected" into a five-fold error.
  confidence_z_milli        integer NOT NULL DEFAULT 1960,
  updated_at                timestamp with time zone NOT NULL DEFAULT now(),
  updated_by                uuid,
  CONSTRAINT ssc_policy_singleton    CHECK (id = 1),
  CONSTRAINT ssc_policy_min_metrics  CHECK (min_metrics_for_composite >= 1),
  CONSTRAINT ssc_policy_z_rng        CHECK (confidence_z_milli BETWEEN 1000 AND 3000)
);

INSERT INTO public.supplier_scorecard_policy (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.supplier_scorecard_policy IS
  'Singleton scorecard policy, configurable by Admin. min_metrics_for_composite is the '
  'number of metrics that must independently reach their sample floor before an overall '
  'score is emitted at all — one qualifying metric is an opinion, not a scorecard. '
  'confidence_z_milli is the z multiplier for the Wilson interval in THOUSANDTHS (1960 = '
  '1.96, a 95% interval). Carries no score and no supplier reference.';

-- ════════════════════════════════════════════════════════════════════════════
--  4. Read authority — ONE predicate, relationship-based
-- ════════════════════════════════════════════════════════════════════════════
--  The P0 this lane must not fail: a supplier must not see another supplier's
--  scorecard. Note what is NOT here — there is no "role = supplier" branch and
--  no "is a buyer" branch. Visibility follows a REAL commercial relationship
--  through the predicates 20260801340000 already established, so a supplier who
--  is also a buyer sees their own vendors and nothing else, and a supplier with
--  no relationship to another supplier sees nothing at all.
CREATE OR REPLACE FUNCTION public.nx_can_view_supplier_scorecard(
  p_supplier_id uuid,
  p_uid         uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_supplier_id IS NOT NULL AND p_uid IS NOT NULL AND (
    public.nx_is_admin(p_uid)
    -- the supplier's own scorecard
    OR p_supplier_id = p_uid
    -- …or a buyer principal-side of an RFQ that this supplier really quoted on
    OR EXISTS (
      SELECT 1
        FROM public.supplier_rfqs r
       WHERE public.nx_is_buyer_principal_side(r.client_id, p_uid)
         AND public.nx_buyer_supplier_related(r.client_id, p_supplier_id)
    )
  );
$$;

ALTER FUNCTION public.nx_can_view_supplier_scorecard(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_view_supplier_scorecard(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_view_supplier_scorecard(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_can_view_supplier_scorecard(uuid, uuid) IS
  'THE single authority for reading a supplier scorecard: an admin, the supplier themselves, '
  'or a buyer who is principal-side (nx_is_buyer_principal_side) of an RFQ this supplier has '
  'a presented/accepted quote or live contract on (nx_buyer_supplier_related). Deliberately '
  'relationship-based, not role-based — holding the supplier role grants nothing, so no '
  'supplier can read a competitor''s scorecard. Reused by every scorecard RPC so the rule is '
  'stated once.';

-- ════════════════════════════════════════════════════════════════════════════
--  5. Derived readers
-- ════════════════════════════════════════════════════════════════════════════

--  The supplier's jobs. nx_is_job_supplier is CALLED, never inlined, so the
--  definition of "this supplier belongs to this job" stays in one place.
--  The source_rfq_id / supplier_contracts pre-filter is a strict SUPERSET of
--  that function's two branches (a contract naming the job, or the accepted
--  quote on jobs.source_rfq_id), so it can only bound the scan — it can never
--  exclude a job the authority would have admitted.
CREATE OR REPLACE FUNCTION public.nx_supplier_scorecard_jobs(p_supplier_id uuid)
RETURNS TABLE (job_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT j.id
    FROM public.jobs j
   WHERE j.deleted_at IS NULL
     AND (j.source_rfq_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.supplier_contracts sc WHERE sc.job_id = j.id))
     AND public.nx_is_job_supplier(j.id, p_supplier_id);
$$;

ALTER FUNCTION public.nx_supplier_scorecard_jobs(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_scorecard_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_scorecard_jobs(uuid) TO authenticated, service_role;

--  Sample size -> band. One lookup, so precision policy has a single home.
CREATE OR REPLACE FUNCTION public.nx_supplier_scorecard_band(p_n integer)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT b.band
    FROM public.supplier_scorecard_confidence_bands b
   WHERE b.min_sample <= COALESCE(p_n, 0)
   ORDER BY b.min_sample DESC
   LIMIT 1;
$$;

ALTER FUNCTION public.nx_supplier_scorecard_band(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_scorecard_band(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_scorecard_band(integer) TO authenticated, service_role;

--  ── Raw counts for one metric ──────────────────────────────────────────────
--  Returns numerator + denominator ONLY. Every metric's arithmetic lives here
--  and nowhere else; scoring, rounding and interval maths are applied once, by
--  the caller, so there is exactly one rounding rule in the system.
CREATE OR REPLACE FUNCTION public.nx_supplier_scorecard_counts(
  p_supplier_id uuid,
  p_metric_key  text
) RETURNS TABLE (numerator bigint, denominator bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_params jsonb;
  v_window interval;
  v_grace  interval;
BEGIN
  SELECT m.params INTO v_params
    FROM public.supplier_scorecard_metrics m
   WHERE m.metric_key = p_metric_key AND m.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCORECARD_METRIC_NOT_FOUND: %', p_metric_key USING ERRCODE = 'P0002';
  END IF;

  IF p_metric_key = 'rfq_response_timeliness' THEN
    v_window := make_interval(hours => COALESCE((v_params->>'response_window_hours')::int, 168));
    RETURN QUERY
      SELECT count(*) FILTER (WHERE q.created_at <= r.created_at + v_window)::bigint,
             count(*)::bigint
        FROM public.supplier_quotes q
        JOIN public.supplier_rfqs   r ON r.id = q.rfq_id
       WHERE q.supplier_id = p_supplier_id
         AND q.created_at IS NOT NULL AND r.created_at IS NOT NULL;

  ELSIF p_metric_key = 'quote_follow_through' THEN
    RETURN QUERY
      SELECT count(*) FILTER (WHERE q.status <> 'withdrawn')::bigint,
             count(*)::bigint
        FROM public.supplier_quotes q
       WHERE q.supplier_id = p_supplier_id;

  ELSIF p_metric_key = 'inspection_pass_rate' THEN
    RETURN QUERY
      SELECT count(*) FILTER (WHERE ipr.result = 'passed')::bigint,
             count(*)::bigint
        FROM public.itp_point_results ipr
       WHERE ipr.job_id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id))
         AND ipr.result IN ('passed', 'failed');   -- decided points only

  ELSIF p_metric_key = 'ncr_free_jobs' THEN
    RETURN QUERY
      WITH inspected AS (
        SELECT j.job_id
          FROM public.nx_supplier_scorecard_jobs(p_supplier_id) j
         WHERE EXISTS (SELECT 1 FROM public.itp_point_results i WHERE i.job_id = j.job_id)
            OR EXISTS (SELECT 1 FROM public.inspection_reports ir
                        WHERE ir.job_id = j.job_id AND ir.deleted_at IS NULL)
      )
      SELECT count(*) FILTER (
               WHERE NOT EXISTS (SELECT 1 FROM public.flash_reports f
                                  WHERE f.job_id = inspected.job_id))::bigint,
             count(*)::bigint
        FROM inspected;

  ELSIF p_metric_key = 'ncr_closure' THEN
    RETURN QUERY
      SELECT count(*) FILTER (WHERE f.status IN ('resolved', 'closed'))::bigint,
             count(*)::bigint
        FROM public.flash_reports f
       WHERE f.job_id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id));

  ELSIF p_metric_key = 'document_currency' THEN
    RETURN QUERY
      SELECT count(*) FILTER (WHERE d.expires_at IS NULL OR d.expires_at > now())::bigint,
             count(*)::bigint
        FROM public.vendor_documents d
       WHERE d.vendor_id = p_supplier_id AND d.status = 'active';

  ELSIF p_metric_key = 'delivery_timeliness' THEN
    v_grace := make_interval(hours => COALESCE((v_params->>'grace_hours')::int, 24));
    RETURN QUERY
      SELECT count(*) FILTER (WHERE j.started_at <= j.scheduled_date + v_grace)::bigint,
             count(*)::bigint
        FROM public.jobs j
       WHERE j.id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id))
         AND j.scheduled_date IS NOT NULL
         AND j.started_at     IS NOT NULL;

  ELSE
    RAISE EXCEPTION 'SCORECARD_METRIC_UNIMPLEMENTED: %', p_metric_key USING ERRCODE = 'P0002';
  END IF;
END $fn$;

ALTER FUNCTION public.nx_supplier_scorecard_counts(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_scorecard_counts(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_scorecard_counts(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_supplier_scorecard_counts(uuid, text) IS
  'Raw numerator/denominator for one metric, derived entirely from existing rows. Returns '
  'counts ONLY — never a score — so that rounding, banding and interval maths are applied in '
  'exactly one place (nx_supplier_scorecard_metric) and cannot diverge per metric. Reads no '
  'money column; delivery timeliness deliberately uses jobs.scheduled_date/started_at rather '
  'than a release or settlement row.';

--  ── One scored metric ──────────────────────────────────────────────────────
--  THE single rounding rule in the system. Everything about honesty is here:
--  the sample size always travels with the score, the score is NULL rather than
--  0 when evidence is thin, precision is read from the ladder, and a Wilson
--  interval reports the uncertainty that remains.
CREATE OR REPLACE FUNCTION public.nx_supplier_scorecard_metric(
  p_supplier_id uuid,
  p_metric_key  text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  m         record;
  c         record;
  v_band    text;
  v_step    integer;
  v_p       double precision;
  v_z       double precision;
  v_centre  double precision;
  v_margin  double precision;
  v_score   integer := NULL;
  v_lo      integer := NULL;
  v_hi      integer := NULL;
  v_reason  text    := NULL;
BEGIN
  IF NOT public.nx_can_view_supplier_scorecard(p_supplier_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO m FROM public.supplier_scorecard_metrics
   WHERE metric_key = p_metric_key AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCORECARD_METRIC_NOT_FOUND: %', p_metric_key USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO c FROM public.nx_supplier_scorecard_counts(p_supplier_id, p_metric_key);

  v_band := public.nx_supplier_scorecard_band(c.denominator::int);
  SELECT rounding_step INTO v_step
    FROM public.supplier_scorecard_confidence_bands WHERE band = v_band;

  -- A metric may demand MORE evidence than the shared ladder, never less.
  IF c.denominator < m.min_sample_size THEN
    v_band  := CASE WHEN c.denominator = 0 THEN 'none' ELSE 'insufficient' END;
    v_step  := 0;
    v_reason := format(
      'Not scored: %s observation(s), below this metric''s minimum of %s.',
      c.denominator, m.min_sample_size);
  ELSIF COALESCE(v_step, 0) = 0 THEN
    v_reason := format(
      'Not scored: %s observation(s) is too thin for an honest figure.', c.denominator);
  END IF;

  -- Score and interval only where the evidence supports one. NULL, not 0:
  -- absent evidence asserts nothing, whereas a zero asserts bad performance.
  IF COALESCE(v_step, 0) > 0 AND c.denominator > 0 THEN
    v_p := c.numerator::double precision / c.denominator::double precision;

    -- Rounded to a whole multiple of the band's step; because step is an
    -- integer, a fractional score is unrepresentable.
    v_score := (round((v_p * 100.0) / v_step) * v_step)::integer;

    -- Wilson score interval — thin evidence shows up as a WIDTH, not a caveat.
    v_z      := (SELECT confidence_z_milli FROM public.supplier_scorecard_policy WHERE id = 1)
                / 1000.0;
    v_centre := (v_p + (v_z * v_z) / (2 * c.denominator)) / (1 + (v_z * v_z) / c.denominator);
    v_margin := (v_z / (1 + (v_z * v_z) / c.denominator))
                * sqrt((v_p * (1 - v_p)) / c.denominator
                       + (v_z * v_z) / (4 * c.denominator * c.denominator));
    v_lo := greatest(0,   round((v_centre - v_margin) * 100.0))::integer;
    v_hi := least  (100, round((v_centre + v_margin) * 100.0))::integer;
  END IF;

  RETURN jsonb_build_object(
    'metric_key',       m.metric_key,
    'label',            m.label,
    'dimension',        m.dimension,
    'weight_bps',       m.weight_bps,
    -- SAMPLE SIZE AND NUMERATOR ARE NOT OPTIONAL — same object as the score.
    'sample_size',      c.denominator,
    'numerator',        c.numerator,
    'score',            v_score,          -- NULL when evidence is thin
    'confidence',       v_band,
    'rounding_step',    COALESCE(v_step, 0),
    'min_sample_size',  m.min_sample_size,
    'interval_low',     v_lo,
    'interval_high',    v_hi,
    'reason',           v_reason,
    -- EXPLAINABILITY travels with the number, always.
    'evidence_source',  m.evidence_source,
    'measures',         m.measures);
END $fn$;

ALTER FUNCTION public.nx_supplier_scorecard_metric(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_scorecard_metric(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_scorecard_metric(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_supplier_scorecard_metric(uuid, text) IS
  'One scored metric, and THE single rounding rule in the scorecard system. Emits sample_size '
  'and numerator in the same object as the score so a figure can never travel without its '
  'evidence base; returns score NULL (never 0) below the metric''s minimum or the ladder''s; '
  'rounds to a whole multiple of the band''s integer step so a 2-decimal score is '
  'unrepresentable; and returns a Wilson interval so thin evidence is visible as a width. '
  'Authorisation delegates to nx_can_view_supplier_scorecard.';

--  ── The whole scorecard ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_supplier_scorecard(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_metrics   jsonb := '[]'::jsonb;
  v_one       jsonb;
  r           record;
  v_wsum      bigint  := 0;
  v_acc       numeric := 0;
  v_scored    int     := 0;
  v_total     int     := 0;
  v_minmetric int;
  v_weakest   text    := NULL;
  v_weak_rank int     := 999;
  v_rank      int;
  v_step      integer;
  v_overall   integer := NULL;
  v_reason    text    := NULL;
BEGIN
  IF NOT public.nx_can_view_supplier_scorecard(p_supplier_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT min_metrics_for_composite INTO v_minmetric
    FROM public.supplier_scorecard_policy WHERE id = 1;

  FOR r IN SELECT metric_key FROM public.supplier_scorecard_metrics
            WHERE is_active ORDER BY sort, metric_key
  LOOP
    v_one     := public.nx_supplier_scorecard_metric(p_supplier_id, r.metric_key);
    v_metrics := v_metrics || jsonb_build_array(v_one);
    v_total   := v_total + 1;

    IF v_one->'score' IS NOT NULL AND jsonb_typeof(v_one->'score') = 'number' THEN
      v_scored := v_scored + 1;
      v_wsum   := v_wsum + (v_one->>'weight_bps')::bigint;
      v_acc    := v_acc + (v_one->>'score')::numeric * (v_one->>'weight_bps')::numeric;

      -- The composite can be no more confident than its weakest contributor.
      SELECT sort INTO v_rank FROM public.supplier_scorecard_confidence_bands
       WHERE band = v_one->>'confidence';
      IF COALESCE(v_rank, 999) < v_weak_rank THEN
        v_weak_rank := COALESCE(v_rank, 999);
        v_weakest   := v_one->>'confidence';
      END IF;
    END IF;
  END LOOP;

  IF v_scored < v_minmetric OR v_wsum = 0 THEN
    v_reason := format(
      'No overall score: %s of %s metrics reached their evidence minimum; policy requires %s.',
      v_scored, v_total, v_minmetric);
  ELSE
    -- Weights normalise over CONTRIBUTORS only, so an unscored metric drops out
    -- rather than being silently counted as zero.
    SELECT rounding_step INTO v_step
      FROM public.supplier_scorecard_confidence_bands WHERE band = v_weakest;
    IF COALESCE(v_step, 0) > 0 THEN
      v_overall := (round((v_acc / v_wsum) / v_step) * v_step)::integer;
    ELSE
      v_reason := 'No overall score: the weakest contributing metric is not scoreable.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'supplier_id',       p_supplier_id,
    'generated_at',      now(),
    'overall_score',     v_overall,
    'overall_confidence', COALESCE(v_weakest, 'none'),
    'metrics_scored',    v_scored,
    'metrics_total',     v_total,
    'reason',            v_reason,
    'metrics',           v_metrics,
    'disclaimer',
      'Derived at read time from operational rows; nothing here is stored. Scores are whole '
      'numbers rounded to the precision the sample size supports, and a metric with too few '
      'observations reports no score rather than a confident-looking zero. This is NOT '
      'supplier_profiles.rating_avg, which is subjective buyer sentiment.');
END $fn$;

ALTER FUNCTION public.nx_supplier_scorecard(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_scorecard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_scorecard(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_supplier_scorecard(uuid) IS
  'The whole supplier scorecard, DERIVED at read time — no score is stored anywhere. The '
  'composite normalises weights over only the metrics that reached their evidence minimum, '
  'takes the confidence of its WEAKEST contributor, and is withheld entirely unless '
  'supplier_scorecard_policy.min_metrics_for_composite metrics qualify. Distinct from '
  'supplier_profiles.rating_avg (subjective buyer sentiment), which it neither reads nor '
  'writes. Authorisation delegates to nx_can_view_supplier_scorecard.';

--  ── Traceability: the actual rows behind a metric ──────────────────────────
CREATE OR REPLACE FUNCTION public.nx_supplier_scorecard_evidence(
  p_supplier_id uuid,
  p_metric_key  text
) RETURNS TABLE (
  evidence_kind         text,
  evidence_id           uuid,
  occurred_at           timestamp with time zone,
  counted_in_numerator  boolean,
  detail                jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_params jsonb;
  v_window interval;
  v_grace  interval;
BEGIN
  IF NOT public.nx_can_view_supplier_scorecard(p_supplier_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT m.params INTO v_params FROM public.supplier_scorecard_metrics m
   WHERE m.metric_key = p_metric_key AND m.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCORECARD_METRIC_NOT_FOUND: %', p_metric_key USING ERRCODE = 'P0002';
  END IF;

  IF p_metric_key = 'rfq_response_timeliness' THEN
    v_window := make_interval(hours => COALESCE((v_params->>'response_window_hours')::int, 168));
    RETURN QUERY
      SELECT 'supplier_quote'::text, q.id, q.created_at,
             (q.created_at <= r.created_at + v_window),
             jsonb_build_object('rfq_id', r.id, 'rfq_opened_at', r.created_at,
                                'quote_status', q.status)
        FROM public.supplier_quotes q
        JOIN public.supplier_rfqs   r ON r.id = q.rfq_id
       WHERE q.supplier_id = p_supplier_id
         AND q.created_at IS NOT NULL AND r.created_at IS NOT NULL
       ORDER BY q.created_at DESC;

  ELSIF p_metric_key = 'quote_follow_through' THEN
    RETURN QUERY
      SELECT 'supplier_quote'::text, q.id, q.created_at,
             (q.status <> 'withdrawn'),
             jsonb_build_object('rfq_id', q.rfq_id, 'quote_status', q.status)
        FROM public.supplier_quotes q
       WHERE q.supplier_id = p_supplier_id
       ORDER BY q.created_at DESC;

  ELSIF p_metric_key = 'inspection_pass_rate' THEN
    RETURN QUERY
      SELECT 'itp_point_result'::text, ipr.id, ipr.recorded_at,
             (ipr.result = 'passed'),
             jsonb_build_object('job_id', ipr.job_id, 'result', ipr.result,
                                'flash_report_id', ipr.flash_report_id)
        FROM public.itp_point_results ipr
       WHERE ipr.job_id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id))
         AND ipr.result IN ('passed', 'failed')
       ORDER BY ipr.recorded_at DESC NULLS LAST;

  ELSIF p_metric_key = 'ncr_free_jobs' THEN
    RETURN QUERY
      SELECT 'job'::text, j.id, j.created_at,
             NOT EXISTS (SELECT 1 FROM public.flash_reports f WHERE f.job_id = j.id),
             jsonb_build_object(
               'job_status', j.status,
               'ncr_count', (SELECT count(*) FROM public.flash_reports f WHERE f.job_id = j.id))
        FROM public.jobs j
       WHERE j.id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id))
         AND (EXISTS (SELECT 1 FROM public.itp_point_results i WHERE i.job_id = j.id)
              OR EXISTS (SELECT 1 FROM public.inspection_reports ir
                          WHERE ir.job_id = j.id AND ir.deleted_at IS NULL))
       ORDER BY j.created_at DESC;

  ELSIF p_metric_key = 'ncr_closure' THEN
    RETURN QUERY
      SELECT 'flash_report'::text, f.id, f.created_at,
             (f.status IN ('resolved', 'closed')),
             jsonb_build_object('job_id', f.job_id, 'severity', f.severity,
                                'status', f.status, 'resolved_at', f.resolved_at)
        FROM public.flash_reports f
       WHERE f.job_id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id))
       ORDER BY f.created_at DESC;

  ELSIF p_metric_key = 'document_currency' THEN
    RETURN QUERY
      SELECT 'vendor_document'::text, d.id, d.created_at,
             (d.expires_at IS NULL OR d.expires_at > now()),
             jsonb_build_object('doc_type', d.doc_type, 'expires_at', d.expires_at,
                                'status', d.status)
        FROM public.vendor_documents d
       WHERE d.vendor_id = p_supplier_id AND d.status = 'active'
       ORDER BY d.created_at DESC;

  ELSIF p_metric_key = 'delivery_timeliness' THEN
    v_grace := make_interval(hours => COALESCE((v_params->>'grace_hours')::int, 24));
    RETURN QUERY
      SELECT 'job'::text, j.id, j.started_at,
             (j.started_at <= j.scheduled_date + v_grace),
             jsonb_build_object('scheduled_date', j.scheduled_date,
                                'started_at', j.started_at, 'job_status', j.status)
        FROM public.jobs j
       WHERE j.id IN (SELECT job_id FROM public.nx_supplier_scorecard_jobs(p_supplier_id))
         AND j.scheduled_date IS NOT NULL AND j.started_at IS NOT NULL
       ORDER BY j.started_at DESC;

  ELSE
    RAISE EXCEPTION 'SCORECARD_METRIC_UNIMPLEMENTED: %', p_metric_key USING ERRCODE = 'P0002';
  END IF;
END $fn$;

ALTER FUNCTION public.nx_supplier_scorecard_evidence(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_supplier_scorecard_evidence(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_supplier_scorecard_evidence(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_supplier_scorecard_evidence(uuid, text) IS
  'The rows behind a metric: kind, id, timestamp, whether the row counted toward the '
  'numerator, and a small detail object. This is what makes the score traceable rather than '
  'merely claimed — every figure nx_supplier_scorecard emits can be expanded to the exact '
  'rows that produced it. Same authorisation predicate as the score itself, so evidence can '
  'never be a way around the read rule. Emits no money column.';

-- ════════════════════════════════════════════════════════════════════════════
--  6. RLS + grants
--
--  All three tables are GLOBAL CONFIGURATION: they carry no supplier_id and no
--  score, so there is nothing supplier-scoped in them to leak. Read is open to
--  authenticated (a buyer must be able to see what a metric means), write is
--  admin-only, and anon reaches none of it. Per-supplier confidentiality is
--  enforced where the supplier data actually is — in the RPCs, via
--  nx_can_view_supplier_scorecard.
-- ════════════════════════════════════════════════════════════════════════════
-- Single-spaced on purpose: scripts/qa/check-rls-admin-coverage.mjs:68 matches
-- `public.<table> ENABLE ROW LEVEL SECURITY` with exactly one space, so aligned
-- padding here would hide these tables from the god-mode RLS fence.
ALTER TABLE public.supplier_scorecard_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_scorecard_confidence_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_scorecard_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssc_metrics_admin_all ON public.supplier_scorecard_metrics;
CREATE POLICY ssc_metrics_admin_all ON public.supplier_scorecard_metrics
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS ssc_metrics_read ON public.supplier_scorecard_metrics;
CREATE POLICY ssc_metrics_read ON public.supplier_scorecard_metrics
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ssc_bands_admin_all ON public.supplier_scorecard_confidence_bands;
CREATE POLICY ssc_bands_admin_all ON public.supplier_scorecard_confidence_bands
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS ssc_bands_read ON public.supplier_scorecard_confidence_bands;
CREATE POLICY ssc_bands_read ON public.supplier_scorecard_confidence_bands
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ssc_policy_admin_all ON public.supplier_scorecard_policy;
CREATE POLICY ssc_policy_admin_all ON public.supplier_scorecard_policy
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS ssc_policy_read ON public.supplier_scorecard_policy;
CREATE POLICY ssc_policy_read ON public.supplier_scorecard_policy
  FOR SELECT USING (auth.uid() IS NOT NULL);

REVOKE ALL ON TABLE public.supplier_scorecard_metrics          FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.supplier_scorecard_confidence_bands FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.supplier_scorecard_policy           FROM anon, PUBLIC;

GRANT SELECT ON TABLE public.supplier_scorecard_metrics          TO authenticated;
GRANT SELECT ON TABLE public.supplier_scorecard_confidence_bands TO authenticated;
GRANT SELECT ON TABLE public.supplier_scorecard_policy           TO authenticated;

GRANT ALL ON TABLE public.supplier_scorecard_metrics          TO service_role;
GRANT ALL ON TABLE public.supplier_scorecard_confidence_bands TO service_role;
GRANT ALL ON TABLE public.supplier_scorecard_policy           TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  7. Selftest — the invariants this lane must not lose
-- ════════════════════════════════════════════════════════════════════════════
DO $selftest$
DECLARE
  v_n int;
  v_bad text;
  v_t text;
BEGIN
  -- 7a. NO SCORECARD V2, NO ANALYTICS V2, NO SECOND SUPPLIER DIRECTORY.
  --     Mirrors the fence 20260801410000:1292 already holds for reports.
  IF to_regclass('public.supplier_scorecards')       IS NOT NULL
     OR to_regclass('public.supplier_scores')        IS NOT NULL
     OR to_regclass('public.vendor_scorecards')      IS NOT NULL
     OR to_regclass('public.supplier_ratings')       IS NOT NULL
     OR to_regclass('public.supplier_performance')   IS NOT NULL
     OR to_regclass('public.supplier_analytics')     IS NOT NULL
     OR to_regclass('public.supplier_directory_v2')  IS NOT NULL
     OR to_regclass('public.supplier_profiles_v2')   IS NOT NULL THEN
    RAISE EXCEPTION
      'SELFTEST: a parallel scorecard, rating, analytics or supplier-directory table exists — scorecards are DERIVED and there must be exactly one supplier directory';
  END IF;

  -- 7b. The surfaces this lane reuses must still be the ones that exist.
  IF to_regclass('public.supplier_directory') IS NULL
     OR to_regclass('public.supplier_profiles') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the existing supplier directory or profile table was disturbed';
  END IF;
  IF to_regprocedure('public.nx_is_job_supplier(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_buyer_supplier_related(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_is_buyer_principal_side(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION
      'SELFTEST: a reused supplier authority from 20260801340000 is missing — this lane must not re-implement it';
  END IF;

  -- 7c. NO SECOND NCR PATH. flash_reports is the NCR carrier; 20260801406000:49
  --     settled that and 20260801410000:1298 fences it. Reproduced.
  IF to_regclass('public.ncr_reports') IS NOT NULL
     OR to_regclass('public.supplier_ncrs') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: a second NCR table exists — an NCR is an ordinary flash report';
  END IF;
  IF to_regclass('public.flash_reports') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: flash_reports is missing — the NCR metrics have no source';
  END IF;

  -- 7d. NO STORED SCORE. A score column anywhere in this lane's tables would be
  --     a second source of truth that drifts the first time an NCR is closed.
  FOREACH v_t IN ARRAY ARRAY['supplier_scorecard_metrics',
                             'supplier_scorecard_confidence_bands',
                             'supplier_scorecard_policy']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = v_t
                  AND column_name ~* '(score|rating|grade|rank)') THEN
      RAISE EXCEPTION
        'SELFTEST: % stores a score/rating column — scorecards are derived at read time, never stored', v_t;
    END IF;
    -- …and no supplier reference either: these are global config.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = v_t
                  AND column_name ~* '(supplier|vendor)_id') THEN
      RAISE EXCEPTION 'SELFTEST: % is supplier-scoped — it must be global configuration only', v_t;
    END IF;
  END LOOP;

  -- 7e. FAKE PRECISION MUST BE UNREPRESENTABLE. Every band's rounding step is a
  --     whole number of points, so no score can carry a decimal at any n.
  IF EXISTS (SELECT 1 FROM public.supplier_scorecard_confidence_bands
              WHERE rounding_step <> round(rounding_step) OR rounding_step < 0) THEN
    RAISE EXCEPTION 'SELFTEST: a confidence band carries a fractional rounding step';
  END IF;
  --     …and a 3-observation sample must not be scoreable by ANY metric.
  IF (SELECT rounding_step FROM public.supplier_scorecard_confidence_bands
       WHERE band = public.nx_supplier_scorecard_band(3)) <> 0 THEN
    RAISE EXCEPTION
      'SELFTEST: 3 observations map to a scoreable band — the owner''s rule is that 3 data points produce no score, let alone a 2-decimal one';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_scorecard_metrics WHERE min_sample_size < 3) THEN
    RAISE EXCEPTION 'SELFTEST: a metric claims to be scoreable below 3 observations';
  END IF;

  -- 7f. EXPLAINABILITY IS STRUCTURAL: every metric declares source + meaning,
  --     and both columns are NOT NULL so a future one cannot skip them.
  IF EXISTS (SELECT 1 FROM public.supplier_scorecard_metrics
              WHERE btrim(COALESCE(evidence_source, '')) = ''
                 OR btrim(COALESCE(measures, ''))        = '') THEN
    RAISE EXCEPTION 'SELFTEST: a metric does not declare its evidence source or what it measures';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='supplier_scorecard_metrics'
                AND column_name IN ('evidence_source','measures')
                AND is_nullable = 'YES') THEN
    RAISE EXCEPTION
      'SELFTEST: evidence_source/measures became nullable — an unexplainable metric would be addable';
  END IF;

  -- 7g. SAMPLE SIZE TRAVELS WITH EVERY SCORE. The scoring function must emit
  --     sample_size and numerator, and must be able to return a NULL score.
  IF position('sample_size' IN
        pg_get_functiondef('public.nx_supplier_scorecard_metric(uuid,text)'::regprocedure)) = 0
     OR position('numerator' IN
        pg_get_functiondef('public.nx_supplier_scorecard_metric(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: a score can be emitted without its sample size';
  END IF;

  -- 7h. NO MONEY ANYWHERE IN THIS LANE. Comments stripped first so a mention in
  --     prose cannot trip it and, more importantly, cannot mask a real read.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname LIKE 'nx\_supplier\_scorecard%'
     AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
         '(wallets|transactions|earnings|payouts|supplier_earnings|supplier_releases|_cents|_halalas|amount|price|settle|payout|escrow)';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % scorecard function(s) (%) reference a money surface — a scorecard measures performance and must touch no wallet, ledger, payout, settlement or price column', v_n, v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name LIKE 'supplier\_scorecard\_%'
                AND column_name ~* '(cents|halalas|amount|price|payout|spread|margin|balance)') THEN
    RAISE EXCEPTION 'SELFTEST: a scorecard table carries a money column';
  END IF;

  -- 7i. RLS ON EVERY NEW TABLE, AND ANON REACHES NONE OF IT.
  FOREACH v_t IN ARRAY ARRAY['supplier_scorecard_metrics',
                             'supplier_scorecard_confidence_bands',
                             'supplier_scorecard_policy']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables
                    WHERE schemaname = 'public' AND tablename = v_t AND rowsecurity) THEN
      RAISE EXCEPTION 'SELFTEST: % has RLS disabled', v_t;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_t, 'UPDATE') THEN
      RAISE EXCEPTION 'SELFTEST: anon can reach %', v_t;
    END IF;
  END LOOP;

  -- 7j. THE P0: anon may not execute any scorecard RPC, and every one of them
  --     must consult the single read predicate rather than its own rule.
  IF has_function_privilege('anon', 'public.nx_supplier_scorecard(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_supplier_scorecard_metric(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_supplier_scorecard_evidence(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_can_view_supplier_scorecard(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon can execute a scorecard RPC';
  END IF;

  FOREACH v_t IN ARRAY ARRAY['public.nx_supplier_scorecard(uuid)',
                             'public.nx_supplier_scorecard_metric(uuid,text)',
                             'public.nx_supplier_scorecard_evidence(uuid,text)']
  LOOP
    IF position('nx_can_view_supplier_scorecard' IN
                pg_get_functiondef(v_t::regprocedure)) = 0 THEN
      RAISE EXCEPTION
        'SELFTEST: % does not consult nx_can_view_supplier_scorecard — a supplier could read a competitor''s scorecard', v_t;
    END IF;
  END LOOP;

  -- …and the predicate must not have grown a role-based shortcut.
  IF pg_get_functiondef('public.nx_can_view_supplier_scorecard(uuid,uuid)'::regprocedure)
       ~* 'role\s*=\s*''supplier''' THEN
    RAISE EXCEPTION
      'SELFTEST: scorecard visibility became role-based — holding the supplier role must grant nothing';
  END IF;

  -- 7k. Every SECURITY DEFINER function in this lane pins search_path.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'nx\_supplier\_scorecard%' OR p.proname = 'nx_can_view_supplier_scorecard')
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
                      WHERE c LIKE 'search\_path=%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % SECURITY DEFINER function(s) (%) do not pin search_path', v_n, v_bad;
  END IF;

  -- 7l. rating_avg is NOT written by this lane — the subjective and objective
  --     instruments stay separate, as certifications/inspector_credentials do.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'nx\_supplier\_scorecard%' OR p.proname = 'nx_can_view_supplier_scorecard')
     AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
         '(insert\s+into|update)\s+(public\.)?supplier_profiles\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % scorecard function(s) (%) write supplier_profiles — the derived scorecard must not overwrite the subjective buyer rating', v_n, v_bad;
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
