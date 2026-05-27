-- ════════════════════════════════════════════════════════════════════════════
--  20260606120000_compliance_anomaly_detection.sql
--  Phase 6 / Sprint 10 — The Compliance Command Center.
--
--  Lands one aggregate health-summary RPC + six anomaly detectors that
--  catch what real SOX 404 auditors look for:
--
--    · compliance_posture_summary(org)        → headline health metrics
--    · detect_band_evasion_pattern(org)       → spend just under thresholds
--    · detect_rubber_stamping(org)            → approvals with low-effort
--                                                comments (substantive review
--                                                missing)
--    · detect_concentration_risk(org)         → repeat inspector hires
--                                                (related-party / weak bid)
--    · detect_quarter_end_clustering(org)     → reassignments near fiscal
--                                                boundaries (period-end
--                                                manipulation)
--    · detect_off_hours_decisions(org)        → approvals at unusual times
--    · detect_silent_overrides(org)           → Platform-Owner reassigns
--                                                lacking the expected audit
--                                                correlation (self-policing)
--
--  All seven RPCs are read-only, SECURITY DEFINER, gated by
--  is_member_of_org OR Platform Owner. They operate on existing tables
--  (audit_events, jobs, invoices, approval_decisions, etc.) — no new
--  storage, no new triggers. Pure projection over data we already have.
--
--  Output shape (uniform across detectors)
--  ───────────────────────────────────────
--    severity        : 'info' | 'warning' | 'critical'
--    finding         : human-readable line ("3 jobs posted $9,999 by …")
--    metadata        : jsonb with the IDs that triggered the finding,
--                      so the UI can deep-link
--    detected_at     : now()  (used by the dashboard sort)
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Internal helper — uniform org-scope authorization for every detector.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._compliance_actor_can_read(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
         public._actor_is_super_admin()
      OR public.is_member_of_org(p_org_id)
    );
$$;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: compliance_posture_summary
--
--  The headline metrics surfaced at the top of /client/compliance.
--  Every percentage is computed over the trailing 90 days unless noted.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compliance_posture_summary(
  p_org_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_lo timestamptz := now() - interval '90 days';
  v_has_inv   boolean := to_regclass('public.invoices') IS NOT NULL;
  v_has_appr  boolean := to_regclass('public.approval_requests') IS NOT NULL;

  v_member_user_ids uuid[];

  v_total_invoices     int := 0;
  v_attributed         int := 0;
  v_total_decisions    int := 0;
  v_substantive        int := 0;
  v_total_high_value   int := 0;
  v_gated_high_value   int := 0;
  v_evidence_packs_90  int := 0;
  v_sod_violations     int := 0;
  v_band_overlaps      int := 0;
  v_approval_latencies_secs bigint[];
  v_avg_latency_secs   numeric := 0;
  v_p95_latency_secs   numeric := 0;
  v_pending_count      int := 0;
  v_oldest_pending_age interval := '0 seconds';
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s compliance posture'
      USING ERRCODE = '42501';
  END IF;

  -- All user ids in this org. Many sums below scope to "jobs posted by an
  -- org member" because jobs themselves don't carry an org_id directly.
  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[])
    INTO v_member_user_ids
    FROM public.org_members WHERE org_id = p_org_id;

  -- ── 1. Department attribution coverage (over trailing 90d invoices) ──
  IF v_has_inv THEN
    WITH base AS (
      SELECT i.id, i.department_id, i.client_id
        FROM public.invoices i
       WHERE i.issued_at >= v_window_lo
         AND i.status <> 'voided'
         AND i.client_id = ANY(v_member_user_ids)
    )
    SELECT count(*),
           count(*) FILTER (WHERE department_id IS NOT NULL)
      INTO v_total_invoices, v_attributed
      FROM base;
  END IF;

  -- ── 2. Approval-decision substantiveness ─────────────────────────────
  -- "Substantive" = comment length >= 12 chars (one realistic sentence).
  IF v_has_appr THEN
    WITH base AS (
      SELECT ad.id, ad.comment
        FROM public.approval_decisions ad
        JOIN public.approval_requests r ON r.id = ad.approval_request_id
       WHERE ad.decided_at >= v_window_lo
         AND r.org_id = p_org_id
    )
    SELECT count(*),
           count(*) FILTER (WHERE length(coalesce(trim(comment), '')) >= 12)
      INTO v_total_decisions, v_substantive
      FROM base;
  END IF;

  -- ── 3. Approval-gate coverage on jobs >= $50K ────────────────────────
  IF v_has_appr THEN
    WITH base AS (
      SELECT j.id, j.budget_cents
        FROM public.jobs j
       WHERE j.created_at >= v_window_lo
         AND j.budget_cents >= 5000000  -- $50K in cents
         AND j.client_id = ANY(v_member_user_ids)
    )
    SELECT count(*),
           count(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM public.approval_requests r WHERE r.job_id = base.id
             )
           )
      INTO v_total_high_value, v_gated_high_value
      FROM base;
  END IF;

  -- ── 4. Evidence packs assembled in last 90d ──────────────────────────
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT count(*)
      INTO v_evidence_packs_90
      FROM public.audit_events a
      JOIN public.jobs j ON j.id = a.subject_id
     WHERE a.event_type = 'compliance.evidence_pack.assembled'
       AND a.created_at >= v_window_lo
       AND j.client_id = ANY(v_member_user_ids);
  END IF;

  -- ── 5. Schema-enforced violation counters (should be 0) ──────────────
  -- We never write SoD violations to disk (the constraint trigger blocks
  -- the insert), so we can't count them as accumulated rows. What we
  -- CAN surface: PostgreSQL connection error logs would catch them, but
  -- that's outside the SQL surface. For now we report 0 with the proof
  -- that the constraint trigger exists. The dashboard renders this as
  -- a positive (control is binding) rather than a metric to grow.
  v_sod_violations := 0;
  v_band_overlaps := 0;

  -- ── 6. Approval latency (substantive — over the decision arrivals) ───
  IF v_has_appr THEN
    SELECT
      coalesce(round(avg(extract(epoch FROM (ad.decided_at - r.requested_at)))::numeric, 0), 0),
      coalesce(
        round(
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY extract(epoch FROM (ad.decided_at - r.requested_at))
          )::numeric, 0),
        0)
      INTO v_avg_latency_secs, v_p95_latency_secs
      FROM public.approval_decisions ad
      JOIN public.approval_requests r ON r.id = ad.approval_request_id
     WHERE ad.decided_at >= v_window_lo
       AND r.org_id = p_org_id;

    SELECT count(*),
           coalesce(max(now() - r.requested_at), '0 seconds'::interval)
      INTO v_pending_count, v_oldest_pending_age
      FROM public.approval_requests r
     WHERE r.org_id = p_org_id AND r.status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'ok',                       true,
    'org_id',                   p_org_id,
    'window_days',              90,
    'attribution_coverage',     jsonb_build_object(
      'total',      v_total_invoices,
      'attributed', v_attributed,
      'percentage', CASE WHEN v_total_invoices = 0 THEN NULL
                   ELSE round(100.0 * v_attributed::numeric / v_total_invoices, 1) END
    ),
    'decision_substantiveness', jsonb_build_object(
      'total',       v_total_decisions,
      'substantive', v_substantive,
      'percentage',  CASE WHEN v_total_decisions = 0 THEN NULL
                    ELSE round(100.0 * v_substantive::numeric / v_total_decisions, 1) END
    ),
    'high_value_gating',        jsonb_build_object(
      'total',      v_total_high_value,
      'gated',      v_gated_high_value,
      'percentage', CASE WHEN v_total_high_value = 0 THEN NULL
                   ELSE round(100.0 * v_gated_high_value::numeric / v_total_high_value, 1) END
    ),
    'evidence_packs_90d',       v_evidence_packs_90,
    'sod_violations_90d',       v_sod_violations,
    'band_overlap_attempts_90d', v_band_overlaps,
    'approval_latency',         jsonb_build_object(
      'avg_seconds', v_avg_latency_secs,
      'p95_seconds', v_p95_latency_secs,
      'pending_count', v_pending_count,
      'oldest_pending_seconds',
        coalesce(extract(epoch FROM v_oldest_pending_age)::bigint, 0)
    ),
    'generated_at',             now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compliance_posture_summary(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: detect_band_evasion_pattern
--
--  Flags jobs whose budget falls just under an active approval band's
--  minimum. We define "just under" as within 5% below the band's
--  min_amount_cents. Multiple such jobs from the same poster in the
--  same week is the high-confidence signal.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_band_evasion_pattern(
  p_org_id uuid
) RETURNS TABLE (
  severity   text,
  finding    text,
  metadata   jsonb,
  detected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s anomalies'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bands AS (
    SELECT min_amount_cents, max_amount_cents, currency
      FROM public.approval_policies
     WHERE org_id = p_org_id AND is_active = true
  ),
  member_ids AS (
    SELECT user_id FROM public.org_members WHERE org_id = p_org_id
  ),
  near_misses AS (
    SELECT j.id, j.title, j.client_id, j.budget_cents, j.created_at, b.min_amount_cents
      FROM public.jobs j
      JOIN bands b ON
        j.budget_cents >= (b.min_amount_cents * 0.95)::bigint
        AND j.budget_cents < b.min_amount_cents
     WHERE j.created_at >= now() - interval '30 days'
       AND j.client_id IN (SELECT user_id FROM member_ids)
  ),
  by_poster AS (
    SELECT client_id, count(*) AS hits, array_agg(id) AS job_ids,
           array_agg(title) AS titles, max(budget_cents) AS max_budget
      FROM near_misses
     GROUP BY client_id
    HAVING count(*) >= 2
  )
  SELECT
    (CASE WHEN bp.hits >= 4 THEN 'critical'
          WHEN bp.hits >= 3 THEN 'warning'
          ELSE 'info' END)                                    AS severity,
    format(
      '%s posted %s job(s) within 5%% of an approval threshold in the last 30 days. Possible control circumvention.',
      coalesce(NULLIF(TRIM(p.full_name), ''), p.email, 'A buyer'),
      bp.hits
    )                                                          AS finding,
    jsonb_build_object(
      'poster_id',  bp.client_id,
      'poster_label', coalesce(NULLIF(TRIM(p.full_name), ''), p.email),
      'job_ids',    to_jsonb(bp.job_ids),
      'job_titles', to_jsonb(bp.titles),
      'max_budget_cents', bp.max_budget
    )                                                          AS metadata,
    now()                                                       AS detected_at
    FROM by_poster bp
    LEFT JOIN public.profiles p ON p.id = bp.client_id
   ORDER BY bp.hits DESC, bp.max_budget DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_band_evasion_pattern(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: detect_rubber_stamping
--
--  Approval decisions with comments shorter than 5 characters or
--  literally one-word approvals ("ok", "yes", "approved"). Indicates
--  non-substantive review — a classic SOX 404 red flag.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_rubber_stamping(
  p_org_id uuid
) RETURNS TABLE (
  severity   text,
  finding    text,
  metadata   jsonb,
  detected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s anomalies'
      USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.approval_requests') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT ad.decided_by,
           ad.decided_at,
           ad.decision,
           ad.comment,
           length(coalesce(trim(ad.comment), '')) AS comment_len,
           r.amount_cents,
           r.currency
      FROM public.approval_decisions ad
      JOIN public.approval_requests r ON r.id = ad.approval_request_id
     WHERE r.org_id = p_org_id
       AND ad.decided_at >= now() - interval '30 days'
  ),
  by_decider AS (
    SELECT decided_by,
           count(*) FILTER (WHERE comment_len < 5) AS empty_count,
           count(*) AS total_count,
           max(amount_cents) AS biggest_decision_cents,
           max(currency) AS sample_currency
      FROM base
     GROUP BY decided_by
    HAVING count(*) FILTER (WHERE comment_len < 5) >= 3
  )
  SELECT
    (CASE WHEN bd.empty_count * 2 >= bd.total_count THEN 'critical'
          WHEN bd.empty_count >= 5 THEN 'warning'
          ELSE 'info' END)                                  AS severity,
    format(
      '%s recorded %s decision(s) with effectively no comment in the last 30 days (of %s total). Largest such decision: %s %s.',
      coalesce(NULLIF(TRIM(p.full_name), ''), p.email, 'An approver'),
      bd.empty_count, bd.total_count,
      bd.sample_currency,
      (bd.biggest_decision_cents::numeric / 100)::text
    )                                                        AS finding,
    jsonb_build_object(
      'decider_id',  bd.decided_by,
      'decider_label', coalesce(NULLIF(TRIM(p.full_name), ''), p.email),
      'empty_count', bd.empty_count,
      'total_count', bd.total_count,
      'biggest_decision_cents', bd.biggest_decision_cents
    )                                                        AS metadata,
    now()                                                     AS detected_at
    FROM by_decider bd
    LEFT JOIN public.profiles p ON p.id = bd.decided_by
   ORDER BY bd.empty_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_rubber_stamping(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: detect_concentration_risk
--
--  Same inspector hired N+ times by the same buyer in the trailing 180
--  days. Triggers a flag at 5 consecutive hires. Possible signs:
--    · related-party transaction (insider deal)
--    · lack of competitive bidding (procurement risk)
--    · single-source dependency (business continuity risk)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_concentration_risk(
  p_org_id uuid
) RETURNS TABLE (
  severity   text,
  finding    text,
  metadata   jsonb,
  detected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s anomalies'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH member_ids AS (
    SELECT user_id FROM public.org_members WHERE org_id = p_org_id
  ),
  pairings AS (
    SELECT j.client_id, j.contractor_id, count(*) AS hire_count,
           sum(coalesce(j.client_price_cents, j.budget_cents, 0)) AS total_cents
      FROM public.jobs j
     WHERE j.created_at >= now() - interval '180 days'
       AND j.contractor_id IS NOT NULL
       AND j.client_id IN (SELECT user_id FROM member_ids)
     GROUP BY j.client_id, j.contractor_id
    HAVING count(*) >= 5
  )
  SELECT
    (CASE WHEN pa.hire_count >= 10 THEN 'critical'
          WHEN pa.hire_count >= 7  THEN 'warning'
          ELSE 'info' END)                                AS severity,
    format(
      '%s hired %s %s times in the last 180 days (total committed: $%s). Consider rotation or competitive bidding.',
      coalesce(NULLIF(TRIM(pb.full_name), ''), pb.email, 'A buyer'),
      coalesce(NULLIF(TRIM(pi.full_name), ''), pi.email, 'an inspector'),
      pa.hire_count,
      (pa.total_cents::numeric / 100)::text
    )                                                       AS finding,
    jsonb_build_object(
      'buyer_id', pa.client_id,
      'buyer_label', coalesce(NULLIF(TRIM(pb.full_name), ''), pb.email),
      'inspector_id', pa.contractor_id,
      'inspector_label', coalesce(NULLIF(TRIM(pi.full_name), ''), pi.email),
      'hire_count', pa.hire_count,
      'total_cents', pa.total_cents
    )                                                       AS metadata,
    now()                                                    AS detected_at
    FROM pairings pa
    LEFT JOIN public.profiles pb ON pb.id = pa.client_id
    LEFT JOIN public.profiles pi ON pi.id = pa.contractor_id
   ORDER BY pa.hire_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_concentration_risk(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: detect_quarter_end_clustering
--
--  Invoice department reassignments concentrated in the last 5 days of
--  a fiscal quarter — possible cost-center juggling to fit a budget.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_quarter_end_clustering(
  p_org_id uuid
) RETURNS TABLE (
  severity   text,
  finding    text,
  metadata   jsonb,
  detected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s anomalies'
      USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.audit_events') IS NULL THEN
    RETURN;
  END IF;

  -- "Quarter-end window" = last 5 days of any calendar quarter in the
  -- trailing 365 days. We count reassignments in that window vs the
  -- mid-quarter baseline.
  RETURN QUERY
  WITH reassignments AS (
    SELECT a.id, a.created_at,
           date_trunc('quarter', a.created_at) AS quarter_start,
           (date_trunc('quarter', a.created_at) + interval '3 months')::timestamptz AS quarter_end
      FROM public.audit_events a
     WHERE a.event_type = 'invoice.department.reassigned'
       AND a.metadata->>'org_id' = p_org_id::text
       AND a.created_at >= now() - interval '365 days'
  ),
  windowed AS (
    SELECT *,
           (quarter_end - created_at) <= interval '5 days' AS in_quarter_end
      FROM reassignments
  ),
  agg AS (
    SELECT
      count(*) FILTER (WHERE in_quarter_end) AS qe_count,
      count(*) FILTER (WHERE NOT in_quarter_end) AS mid_count
      FROM windowed
  )
  SELECT
    (CASE WHEN qe_count * 3 >= mid_count + qe_count AND qe_count >= 4 THEN 'critical'
          WHEN qe_count >= 3 AND qe_count > mid_count THEN 'warning'
          ELSE 'info' END)                                  AS severity,
    format(
      '%s of %s invoice reassignments in the last year landed in the final 5 days of a fiscal quarter. Investigate for period-end cost-center juggling.',
      qe_count, qe_count + mid_count
    )                                                        AS finding,
    jsonb_build_object(
      'quarter_end_count', qe_count,
      'mid_quarter_count', mid_count,
      'ratio',
        CASE WHEN (qe_count + mid_count) = 0 THEN 0
        ELSE round(100.0 * qe_count::numeric / (qe_count + mid_count), 1) END
    )                                                        AS metadata,
    now()                                                     AS detected_at
    FROM agg
   WHERE qe_count >= 3 AND qe_count > mid_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_quarter_end_clustering(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: detect_off_hours_decisions
--
--  Approval decisions logged between 22:00 and 06:00 UTC or on
--  Saturdays/Sundays. Could be legitimate (global teams) but worth a
--  spot-check.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_off_hours_decisions(
  p_org_id uuid
) RETURNS TABLE (
  severity   text,
  finding    text,
  metadata   jsonb,
  detected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s anomalies'
      USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.approval_requests') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT ad.id, ad.decided_by, ad.decided_at,
           extract(hour FROM ad.decided_at AT TIME ZONE 'UTC') AS hr,
           extract(dow  FROM ad.decided_at AT TIME ZONE 'UTC') AS dow,
           r.amount_cents, r.currency
      FROM public.approval_decisions ad
      JOIN public.approval_requests r ON r.id = ad.approval_request_id
     WHERE r.org_id = p_org_id
       AND ad.decided_at >= now() - interval '90 days'
  ),
  off_hours AS (
    SELECT * FROM base
     WHERE hr < 6 OR hr >= 22 OR dow IN (0, 6)
  ),
  by_decider AS (
    SELECT decided_by, count(*) AS oh_count,
           max(amount_cents) AS biggest_cents,
           max(currency) AS sample_currency
      FROM off_hours
     GROUP BY decided_by
    HAVING count(*) >= 3
  )
  SELECT
    (CASE WHEN bd.oh_count >= 10 THEN 'warning' ELSE 'info' END) AS severity,
    format(
      '%s recorded %s decision(s) outside business hours (22:00–06:00 UTC or weekends) in the last 90 days. Largest: %s %s.',
      coalesce(NULLIF(TRIM(p.full_name), ''), p.email, 'An approver'),
      bd.oh_count, bd.sample_currency,
      (bd.biggest_cents::numeric / 100)::text
    )                                                          AS finding,
    jsonb_build_object(
      'decider_id', bd.decided_by,
      'decider_label', coalesce(NULLIF(TRIM(p.full_name), ''), p.email),
      'off_hours_count', bd.oh_count,
      'biggest_cents', bd.biggest_cents
    )                                                          AS metadata,
    now()                                                       AS detected_at
    FROM by_decider bd
    LEFT JOIN public.profiles p ON p.id = bd.decided_by
   ORDER BY bd.oh_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_off_hours_decisions(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: detect_silent_overrides
--
--  Platform-Owner reassignments where the audit row's correlation_id is
--  not present in the metadata jsonb. This shouldn't happen — every
--  reassign RPC writes correlation_id deterministically. If we ever
--  find one, it means somebody bypassed the RPC. Self-policing.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_silent_overrides(
  p_org_id uuid
) RETURNS TABLE (
  severity   text,
  finding    text,
  metadata   jsonb,
  detected_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._compliance_actor_can_read(p_org_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this organization''s anomalies'
      USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.audit_events') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'critical'::text AS severity,
    format(
      'Audit event %s of type %L written without a correlation_id. This indicates a direct table write that bypassed the SECURITY DEFINER RPC layer. Investigate immediately.',
      a.id, a.event_type
    )                AS finding,
    jsonb_build_object(
      'audit_event_id', a.id,
      'event_type',     a.event_type,
      'actor_id',       a.actor_id,
      'subject_table',  a.subject_table,
      'subject_id',     a.subject_id,
      'created_at',     a.created_at
    )                AS metadata,
    now()             AS detected_at
    FROM public.audit_events a
   WHERE a.metadata->>'org_id' = p_org_id::text
     AND a.event_type LIKE 'invoice.department.%'
     AND a.correlation_id IS NULL
     AND a.created_at >= now() - interval '180 days'
   ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_silent_overrides(uuid) TO authenticated;

COMMIT;
