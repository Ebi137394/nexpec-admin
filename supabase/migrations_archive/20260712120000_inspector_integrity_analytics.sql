-- ════════════════════════════════════════════════════════════════════════════
--  20260712120000_inspector_integrity_analytics.sql
--
--  P2.1 — Predictive-Integrity spine: seal-history analytics RPC.
--
--  Complements (does NOT duplicate) the org/procurement-scoped Compliance
--  Command Center (compliance_posture_summary + the 7 anomaly detectors in
--  20260606 / 20260614). Those watch buyer-side behaviour (band evasion,
--  rubber-stamping, concentration). THIS watches INSPECTOR seal integrity across
--  jobs — the signal that forecasts disputes before they happen:
--
--    • chain-break incidence            (tamper / broken capture chain)
--    • captures & items per seal        (evidence thoroughness / corner-cutting)
--    • capture→seal turnaround hours     (rushed / rubber-stamped fieldwork)
--    • AI engagement (ai_count)         (did the Co-Inspector get used)
--    • dispute & client-revision counts (downstream outcomes)
--
--  …each compared to a COHORT BASELINE (mean + stddev) so the dashboard / the
--  P2.2 scorer can z-score and rank risk. Read-only projection over existing
--  tables — no new storage, no triggers.
--
--  AUTHORIZATION (RLS-aware, fail-closed):
--    • admin / super_admin → PLATFORM scope (every inspector). The oversight view.
--    • everyone else       → SELF scope (their own inspector row only). An
--                            inspector sees their own integrity + the anonymous
--                            cohort baseline; a non-inspector sees an empty set.
--    The admin test is inlined against profiles.role to avoid the nx_is_admin()
--    0-arg/1-arg overload ambiguity. SECURITY DEFINER + pinned search_path.
--
--  PERFORMANCE: windowed on inspector_sealed_at (new index below); per-inspector
--  aggregation rides pi_report_seals(inspector_id). Single CTE statement.
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Keep the trailing-window scan cheap as seal volume grows.
CREATE INDEX IF NOT EXISTS pi_report_seals_sealed_at_idx
  ON public.pi_report_seals (inspector_sealed_at DESC);

CREATE OR REPLACE FUNCTION public.inspector_integrity_analytics(
  p_window_days integer DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
      FROM public.disputes d
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

GRANT EXECUTE ON FUNCTION public.inspector_integrity_analytics(integer) TO authenticated;

COMMENT ON FUNCTION public.inspector_integrity_analytics(integer) IS
  'Predictive-Integrity (P2.1): per-inspector seal-history metrics + anonymous cohort baselines. Admin → platform scope; others → own row only. Read-only, SECURITY DEFINER, fail-closed.';

COMMIT;
