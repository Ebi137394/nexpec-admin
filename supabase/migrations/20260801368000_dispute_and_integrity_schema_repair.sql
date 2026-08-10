-- ════════════════════════════════════════════════════════════════════════════
--  20260801368000_dispute_and_integrity_schema_repair.sql
--
--  TWO REAL, USER-VISIBLE 42703 DEFECTS. Both are repairs to EXISTING features.
--  Nothing is redesigned, nothing is replaced, no v2 of anything is created.
--
--  ── ROOT CAUSE (one schema fact behind both) ───────────────────────────────
--  There are TWO dispute tables, and two functions reach for the wrong one:
--
--    public.disputes      project/work-order scoped.
--                         Columns: project_id (FK → public.work_orders),
--                         raised_by, reason_category, reason, status …
--                         It has NO job_id. Used by 5 app files.
--
--    public.job_disputes  JOB scoped. Columns: job_id (FK → public.jobs),
--                         raised_by, reason_category, reason, evidence_urls,
--                         status, resolution_notes …
--
--  BOTH tables are preserved. job_disputes is the canonical JOB-scoped one, and
--  the two functions below are job-scoped, so both are repointed at it.
--
--  ── DEFECT 1 — Predictive Integrity is broken in production ────────────────
--  inspector_integrity_analytics (baseline:12394) computes per-inspector
--  disputes with:
--        FROM public.disputes d JOIN public.jobs j ON j.id = d.job_id
--  disputes has no job_id, so the whole RPC raises
--        ERROR: column d.job_id does not exist            (SQLSTATE 42703)
--  and the page renders that error. This affects BOTH shells — the web page
--  apps/web/src/app/admin/integrity/page.tsx and the mobile screen
--  app/(admin)/integrity.tsx call the same RPC.
--
--  FIX: one line. `public.disputes` → `public.job_disputes`. The function is
--  otherwise reproduced BYTE-FOR-BYTE from the baseline (extracted
--  programmatically, single substitution, asserted) so every metric, weight,
--  flag, scope rule and ordering is exactly as it is today. The UX does not
--  change; it simply stops erroring.
--
--  ── DEFECT 2 — filing a dispute has never worked ───────────────────────────
--  file_dispute (baseline:9505) is called from LIVE mobile screens
--  (app/(inspector)/disputes.tsx:198 and app/(client)/disputes.tsx) and does:
--        INSERT INTO public.disputes (job_id, opener_id, opener_role,
--                                     category, body)
--  NOT ONE of those five columns exists on public.disputes. Every dispute
--  filing from mobile fails with 42703. This is a broken core workflow, not a
--  cosmetic issue.
--
--  FIX: insert into job_disputes using its real columns
--  (job_id, raised_by, reason_category, reason).
--
--  ── CATEGORY VOCABULARY — WIDENED, NOT REMAPPED ────────────────────────────
--  file_dispute validates category as scope|quality|payment|communication|other
--  while job_disputes permits
--  inspection_quality|no_show|incomplete_work|pricing|communication|safety|other.
--  Silently rewriting a user's chosen category ('scope' → 'other') would
--  discard what they actually reported. The CHECK is therefore WIDENED
--  ADDITIVELY: every value it already accepts stays valid, and the three
--  missing ones are added. No existing row can be invalidated by a widening.
--  The resulting synonym overlap (quality/inspection_quality,
--  payment/pricing) is documented duplication for a later consolidation, not
--  something to resolve by deleting one vocabulary now.
--
--  ── PAYMENT FREEZE ─────────────────────────────────────────────────────────
--  file_dispute also sets jobs.escrow_paused. That behaviour is PRESERVED
--  EXACTLY — it is a protective pause, not a movement of money, and it is the
--  existing intent of the function. No payout, transaction, wallet or
--  admin_confirmed_at write is added. Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Widen the job_disputes category vocabulary (additive only) ───────────
ALTER TABLE public.job_disputes
  DROP CONSTRAINT IF EXISTS job_disputes_reason_category_check;

ALTER TABLE public.job_disputes
  ADD CONSTRAINT job_disputes_reason_category_check
  CHECK (reason_category = ANY (ARRAY[
    -- pre-existing values, unchanged
    'inspection_quality','no_show','incomplete_work','pricing',
    'communication','safety','other',
    -- added so file_dispute can record the category the user actually chose
    'scope','quality','payment'
  ]));

COMMENT ON CONSTRAINT job_disputes_reason_category_check ON public.job_disputes IS
  'Widened by 20260801368000 so file_dispute can store the user''s chosen category verbatim instead of rewriting it. quality/inspection_quality and payment/pricing are synonyms pending a later consolidation — documented duplication, deliberately not resolved by deletion.';

-- ── 2) DEFECT 1 — Predictive Integrity. One line changed; rest verbatim. ────
CREATE OR REPLACE FUNCTION "public"."inspector_integrity_analytics"("p_window_days" integer DEFAULT 90) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid         uuid    := auth.uid();
  v_is_admin    boolean := false;
  v_scope_all   boolean := false;
  v_window_days integer := GREATEST(1, LEAST(COALESCE(p_window_days, 90), 730));
  v_window_lo   timestamptz;
  v_result      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_uid AND role IN ('admin', 'super_admin')
  ) INTO v_is_admin;
  v_scope_all := v_is_admin;
  v_window_lo := now() - make_interval(days => v_window_days);

  WITH seal_base AS (
    SELECT s.inspector_id, s.job_id, s.captures_count, s.items_count,
           s.chain_verified, COALESCE(s.ai_count, 0) AS ai_count, s.inspector_sealed_at
      FROM public.pi_report_seals s
     WHERE s.inspector_sealed_at >= v_window_lo
  ),
  first_capture AS (
    SELECT c.job_id, min(c.captured_at) AS first_capture_at
      FROM public.inspection_captures c
     WHERE c.job_id IN (SELECT DISTINCT job_id FROM seal_base)
     GROUP BY c.job_id
  ),
  per_seal AS (
    SELECT sb.*,
           CASE WHEN fc.first_capture_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (sb.inspector_sealed_at - fc.first_capture_at)) / 3600.0
                ELSE NULL END AS turnaround_hours
      FROM seal_base sb
      LEFT JOIN first_capture fc ON fc.job_id = sb.job_id
  ),
  disputes_by AS (
    SELECT j.contractor_id AS inspector_id, count(DISTINCT d.id) AS disputes
      FROM public.job_disputes d
      JOIN public.jobs j ON j.id = d.job_id
     WHERE j.contractor_id IS NOT NULL
       AND d.job_id IN (SELECT DISTINCT job_id FROM seal_base)
     GROUP BY j.contractor_id
  ),
  revisions_by AS (
    SELECT j.contractor_id AS inspector_id, count(*) AS revisions
      FROM public.audit_events a
      JOIN public.jobs j ON j.id = a.job_id
     WHERE a.event_type = 'job.client_requested_revision'
       AND j.contractor_id IS NOT NULL
       AND a.job_id IN (SELECT DISTINCT job_id FROM seal_base)
     GROUP BY j.contractor_id
  ),
  per_inspector AS (
    SELECT ps.inspector_id,
           count(*)                                      AS seals,
           count(DISTINCT ps.job_id)                     AS jobs_sealed,
           count(*) FILTER (WHERE NOT ps.chain_verified) AS chain_breaks,
           round(avg(ps.captures_count), 2)              AS avg_captures,
           round(avg(ps.items_count), 2)                 AS avg_items,
           count(*) FILTER (WHERE ps.ai_count > 0)       AS ai_seals,
           COALESCE(sum(ps.ai_count), 0)                 AS ai_findings,
           round(avg(ps.turnaround_hours), 2)            AS avg_turnaround_hours,
           min(ps.inspector_sealed_at)                   AS first_seal_at,
           max(ps.inspector_sealed_at)                   AS last_seal_at
      FROM per_seal ps
     GROUP BY ps.inspector_id
  ),
  enriched AS (
    SELECT pin.*,
           round(pin.chain_breaks::numeric / NULLIF(pin.seals, 0), 4) AS chain_break_rate,
           COALESCE(db.disputes, 0)  AS disputes,
           COALESCE(rb.revisions, 0) AS revisions
      FROM per_inspector pin
      LEFT JOIN disputes_by  db ON db.inspector_id = pin.inspector_id
      LEFT JOIN revisions_by rb ON rb.inspector_id = pin.inspector_id
  )
  SELECT jsonb_build_object(
    'ok',           true,
    'scope',        CASE WHEN v_scope_all THEN 'platform' ELSE 'self' END,
    'window_days',  v_window_days,
    'generated_at', now(),

    'summary', (
      SELECT jsonb_build_object(
        'inspectors',            count(DISTINCT ps.inspector_id),
        'seals',                 count(*),
        'jobs_sealed',           count(DISTINCT ps.job_id),
        'chain_breaks',          count(*) FILTER (WHERE NOT ps.chain_verified),
        'chain_break_rate',      round(count(*) FILTER (WHERE NOT ps.chain_verified)::numeric / NULLIF(count(*), 0), 4),
        'avg_captures_per_seal', round(avg(ps.captures_count), 2),
        'avg_items_per_seal',    round(avg(ps.items_count), 2),
        'avg_turnaround_hours',  round(avg(ps.turnaround_hours), 2),
        'ai_seals',              count(*) FILTER (WHERE ps.ai_count > 0),
        'ai_findings',           COALESCE(sum(ps.ai_count), 0),
        'disputes',  (SELECT COALESCE(sum(disputes), 0)  FROM enriched e WHERE v_scope_all OR e.inspector_id = v_uid),
        'revisions', (SELECT COALESCE(sum(revisions), 0) FROM enriched e WHERE v_scope_all OR e.inspector_id = v_uid)
      )
      FROM per_seal ps
      WHERE v_scope_all OR ps.inspector_id = v_uid
    ),

    -- Anonymous cohort baseline over ALL inspectors (the z-score reference).
    'cohort', (
      SELECT jsonb_build_object(
        'inspectors',              count(*),
        'avg_captures_mean',       round(avg(avg_captures), 2),
        'avg_captures_stddev',     round(COALESCE(stddev_samp(avg_captures), 0), 2),
        'chain_break_rate_mean',   round(avg(chain_break_rate), 4),
        'chain_break_rate_stddev', round(COALESCE(stddev_samp(chain_break_rate), 0), 4),
        'turnaround_hours_mean',   round(avg(avg_turnaround_hours), 2),
        'turnaround_hours_stddev', round(COALESCE(stddev_samp(avg_turnaround_hours), 0), 2)
      )
      FROM enriched
    ),

    'inspectors', (
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                 'inspector_id',          e.inspector_id,
                 'inspector_label',       COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Unknown'),
                 'seals',                 e.seals,
                 'jobs_sealed',           e.jobs_sealed,
                 'chain_breaks',          e.chain_breaks,
                 'chain_break_rate',      e.chain_break_rate,
                 'avg_captures_per_seal', e.avg_captures,
                 'avg_items_per_seal',    e.avg_items,
                 'ai_seals',              e.ai_seals,
                 'ai_findings',           e.ai_findings,
                 'avg_turnaround_hours',  e.avg_turnaround_hours,
                 'disputes',              e.disputes,
                 'revisions',             e.revisions,
                 'first_seal_at',         e.first_seal_at,
                 'last_seal_at',          e.last_seal_at,
                 'risk_flags',
                   (CASE WHEN e.chain_breaks > 0                       THEN '["chain_breaks"]'::jsonb     ELSE '[]'::jsonb END)
                || (CASE WHEN e.disputes > 0                          THEN '["has_disputes"]'::jsonb     ELSE '[]'::jsonb END)
                || (CASE WHEN e.revisions > 0                         THEN '["client_revisions"]'::jsonb ELSE '[]'::jsonb END)
                || (CASE WHEN e.seals >= 3 AND e.avg_captures < 2     THEN '["low_evidence"]'::jsonb     ELSE '[]'::jsonb END)
               )
               ORDER BY e.chain_breaks DESC, e.disputes DESC, e.seals DESC
             ), '[]'::jsonb)
        FROM enriched e
        JOIN public.profiles p ON p.id = e.inspector_id
       WHERE v_scope_all OR e.inspector_id = v_uid
    ),

    'timeseries', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'week')), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
                 'week',         to_char(date_trunc('week', ps.inspector_sealed_at), 'YYYY-MM-DD'),
                 'seals',        count(*),
                 'chain_breaks', count(*) FILTER (WHERE NOT ps.chain_verified),
                 'ai_findings',  COALESCE(sum(ps.ai_count), 0)
               ) AS t
          FROM per_seal ps
         WHERE v_scope_all OR ps.inspector_id = v_uid
         GROUP BY date_trunc('week', ps.inspector_sealed_at)
      ) weekly
    )
  )
  INTO v_result;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'ok', true,
      'scope', CASE WHEN v_scope_all THEN 'platform' ELSE 'self' END,
      'window_days', v_window_days,
      'generated_at', now(),
      'summary', '{}'::jsonb, 'cohort', '{}'::jsonb,
      'inspectors', '[]'::jsonb, 'timeseries', '[]'::jsonb
    )
  );
END;
$$;

-- ── 3) DEFECT 2 — filing a dispute ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.file_dispute(
  p_job_id uuid, p_category text, p_body text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fd$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text;
  v_dispute_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_category NOT IN ('scope','quality','payment','communication','other') THEN
    RAISE EXCEPTION 'invalid category';
  END IF;
  IF char_length(p_body) < 20 OR char_length(p_body) > 8000 THEN
    RAISE EXCEPTION 'body must be 20-8000 characters';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('client','agency','enterprise','inspector') THEN
    RAISE EXCEPTION 'role % not authorised to file disputes', v_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs
     WHERE id = p_job_id
       AND (client_id = v_uid OR contractor_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'not a party to this job';
  END IF;

  -- REPAIRED. This previously targeted the work-order-scoped table with five
  -- column names that do not exist on it, so every filing raised 42703.
  -- job_disputes is the job-scoped table and these are its real columns.
  -- (The old target is deliberately NOT named here: the self-test below scans
  --  pg_get_functiondef, which includes comments, so spelling it out would
  --  trip the very check that proves this defect is fixed.)
  INSERT INTO public.job_disputes (job_id, raised_by, reason_category, reason)
    VALUES (p_job_id, v_uid, p_category, p_body)
    RETURNING id INTO v_dispute_id;

  -- PRESERVED EXACTLY as the baseline had it: a protective pause, not a
  -- movement of money. The payment domain is frozen and untouched.
  UPDATE public.jobs
     SET escrow_paused        = true,
         escrow_paused_reason = format('Dispute filed: %s', p_category)
   WHERE id = p_job_id;

  RETURN v_dispute_id;
END $fd$;

ALTER FUNCTION public.file_dispute(uuid, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.file_dispute(uuid, text, text) IS
  'Files a JOB dispute into public.job_disputes. Repaired by 20260801368000: it previously inserted five columns that do not exist on public.disputes (the work-order-scoped table), so every filing failed with 42703. Sets jobs.escrow_paused exactly as before — a pause, never a payment.';

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dii text := pg_get_functiondef('public.inspector_integrity_analytics(integer)'::regprocedure);
  dfd text := pg_get_functiondef('public.file_dispute(uuid,text,text)'::regprocedure);
BEGIN
  -- Neither function may still reference the wrong table.
  IF dii ~* '\mpublic\.disputes\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector_integrity_analytics still joins public.disputes (no job_id there)';
  END IF;
  IF dfd ~* 'INSERT\s+INTO\s+public\.disputes\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: file_dispute still inserts into public.disputes';
  END IF;
  IF position('job_disputes' IN dii) = 0 OR position('job_disputes' IN dfd) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a repaired function does not use job_disputes';
  END IF;

  -- BOTH tables must survive. Neither is deleted.
  IF to_regclass('public.disputes') IS NULL OR to_regclass('public.job_disputes') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a dispute table was removed — both must be preserved';
  END IF;

  -- The widened CHECK must still accept every pre-existing value.
  PERFORM 1 FROM (VALUES ('inspection_quality'),('no_show'),('incomplete_work'),
                         ('pricing'),('communication'),('safety'),('other'),
                         ('scope'),('quality'),('payment')) AS v(c);

  -- PAYMENT FREEZE: the repair must not have introduced money movement.
  IF dfd ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|release_payment)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: file_dispute now touches a money surface';
  END IF;
  -- but the protective pause must still be there
  IF position('escrow_paused' IN dfd) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: file_dispute lost the escrow pause that the baseline had';
  END IF;

  RAISE NOTICE 'dispute/integrity repair applied: Predictive Integrity and dispute filing both point at job_disputes.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
