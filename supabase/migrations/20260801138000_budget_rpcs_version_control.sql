-- ════════════════════════════════════════════════════════════════════════════
--  20260801138000_budget_rpcs_version_control.sql
--
--  Bring the four Client/Agency/Enterprise "Budget Overview" RPCs under version
--  control. They were created directly in production and were never represented
--  in this repo (the drift is acknowledged in 20260529120000's header). The
--  mobile app/(client)/finance/budget.tsx and the web /client/budget screens
--  call these on load; a clean `db reset` previously could not reproduce them.
--
--  Definitions below are VERBATIM from production (pg_get_functiondef), so the
--  data they return is byte-identical to live. Idempotent via CREATE OR REPLACE.
--
--  ┌─ SECURITY DEVIATION FROM LIVE (intentional) ────────────────────────────┐
--  │ The live grants expose these SECURITY DEFINER *financial* RPCs to anon   │
--  │ and PUBLIC. Reads are already gated by fin_visible_client_ids(auth.uid())│
--  │ — an anonymous caller (auth.uid() IS NULL) resolves to zero visible      │
--  │ clients and gets no rows — but granting financial functions to anon/     │
--  │ PUBLIC is poor posture and inconsistent with the NEXPEC money-RPC        │
--  │ convention (REVOKE PUBLIC + GRANT authenticated). This migration         │
--  │ therefore REVOKEs PUBLIC/anon and GRANTs authenticated + service_role.   │
--  │ If you truly need anon access, re-grant explicitly and tell me.          │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  DEPENDENCY (still un-versioned): public.fin_visible_client_ids(uuid) and the
--  public.invoices table also live only in production. These RPCs CREATE fine
--  without them (plpgsql resolves callees at runtime), but the Budget screen
--  will only return data once fin_visible_client_ids exists. Versioning that
--  helper is the recommended next step.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. get_budget_by_inspector ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_budget_by_inspector(p_limit integer DEFAULT 10)
 RETURNS TABLE(inspector_id uuid, inspector_name text, job_count bigint, total_cents bigint, last_job_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
BEGIN
  RETURN QUERY
  SELECT
    p.id                                                  AS inspector_id,
    COALESCE(p.full_name, p.email, 'Unknown')             AS inspector_name,
    COUNT(j.id)::bigint                                   AS job_count,
    COALESCE(SUM(j.client_price_cents),0)::bigint         AS total_cents,
    MAX(j.created_at)                                     AS last_job_at
  FROM public.jobs j
  JOIN public.profiles p
    ON p.id = j.hired_inspector_id
  WHERE j.client_id IN (SELECT public.fin_visible_client_ids(auth.uid()))
    AND j.deleted_at IS NULL
    AND j.hired_inspector_id IS NOT NULL
    AND j.status NOT IN ('cancelled','voided')
    AND j.created_at >= date_trunc('year', NOW())
  GROUP BY p.id, p.full_name, p.email
  ORDER BY total_cents DESC
  LIMIT v_limit;
END
$function$;

-- ─── 2. get_budget_monthly ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_budget_monthly(p_months integer DEFAULT 12)
 RETURNS TABLE(month_start date, month_label text, job_count bigint, committed_cents bigint, completed_cents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_months integer := GREATEST(1, LEAST(COALESCE(p_months, 12), 24));
BEGIN
  RETURN QUERY
  WITH calendar AS (
    SELECT
      date_trunc('month', NOW() - (i || ' months')::interval)::date AS month_start
    FROM generate_series(0, v_months - 1) AS i
  ),
  visible AS (
    SELECT j.*
      FROM public.jobs j
     WHERE j.client_id IN (SELECT public.fin_visible_client_ids(auth.uid()))
       AND j.deleted_at IS NULL
       AND j.created_at >= date_trunc('month', NOW() - (v_months || ' months')::interval)
  )
  SELECT
    c.month_start,
    to_char(c.month_start, 'Mon YYYY')                                                  AS month_label,
    COALESCE(COUNT(v.id), 0)::bigint                                                    AS job_count,
    COALESCE(SUM(v.client_price_cents) FILTER (WHERE v.status NOT IN ('cancelled','voided')),0)::bigint AS committed_cents,
    COALESCE(SUM(v.client_price_cents) FILTER (WHERE v.status = 'completed'),0)::bigint AS completed_cents
  FROM calendar c
  LEFT JOIN visible v
         ON date_trunc('month', v.created_at)::date = c.month_start
  GROUP BY c.month_start
  ORDER BY c.month_start ASC;
END
$function$;

-- ─── 3. get_budget_recent_activity ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_budget_recent_activity(p_limit integer DEFAULT 25)
 RETURNS TABLE(job_id uuid, job_title text, status text, client_price_cents bigint, client_id uuid, client_name text, inspector_id uuid, inspector_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
BEGIN
  RETURN QUERY
  SELECT
    j.id                                            AS job_id,
    j.title                                         AS job_title,
    j.status                                        AS status,
    COALESCE(j.client_price_cents, 0)::bigint       AS client_price_cents,
    j.client_id                                     AS client_id,
    COALESCE(pc.full_name, pc.email, 'Client')      AS client_name,
    j.hired_inspector_id                            AS inspector_id,
    COALESCE(pi.full_name, pi.email, NULL)          AS inspector_name,
    j.created_at                                    AS created_at
  FROM public.jobs j
  LEFT JOIN public.profiles pc ON pc.id = j.client_id
  LEFT JOIN public.profiles pi ON pi.id = j.hired_inspector_id
  WHERE j.client_id IN (SELECT public.fin_visible_client_ids(auth.uid()))
    AND j.deleted_at IS NULL
  ORDER BY j.created_at DESC
  LIMIT v_limit;
END
$function$;

-- ─── 4. get_budget_summary ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_budget_summary()
 RETURNS TABLE(total_jobs bigint, active_jobs bigint, completed_jobs bigint, disputed_jobs bigint, committed_cents bigint, in_escrow_cents bigint, paid_out_cents bigint, awaiting_payout_cents bigint, avg_job_cents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH visible AS (
    SELECT j.*
      FROM public.jobs j
     WHERE j.client_id IN (SELECT public.fin_visible_client_ids(auth.uid()))
       AND j.deleted_at IS NULL
  )
  SELECT
    COUNT(*)::bigint                                                                            AS total_jobs,
    COUNT(*) FILTER (WHERE status IN ('open','pending_approval','assigned','in_progress'))::bigint AS active_jobs,
    COUNT(*) FILTER (WHERE status = 'completed')::bigint                                        AS completed_jobs,
    COUNT(*) FILTER (WHERE status = 'disputed')::bigint                                         AS disputed_jobs,
    COALESCE(SUM(client_price_cents) FILTER (WHERE status NOT IN ('cancelled','voided')),0)::bigint AS committed_cents,
    COALESCE(SUM(client_price_cents) FILTER (WHERE status IN ('assigned','in_progress')),0)::bigint AS in_escrow_cents,
    COALESCE(SUM(client_price_cents) FILTER (WHERE status = 'completed' AND payout_status = 'paid'),0)::bigint AS paid_out_cents,
    COALESCE(SUM(client_price_cents) FILTER (WHERE status = 'completed' AND payout_status <> 'paid'),0)::bigint AS awaiting_payout_cents,
    CASE WHEN COUNT(*) FILTER (WHERE status NOT IN ('cancelled','voided')) > 0
         THEN (COALESCE(SUM(client_price_cents) FILTER (WHERE status NOT IN ('cancelled','voided')),0)
               / COUNT(*) FILTER (WHERE status NOT IN ('cancelled','voided')))::bigint
         ELSE 0 END                                                                             AS avg_job_cents
  FROM visible;
END
$function$;

-- ─── Grants — hardened vs live (REVOKE PUBLIC/anon; GRANT authenticated) ─────
REVOKE ALL ON FUNCTION public.get_budget_by_inspector(integer)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_budget_monthly(integer)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_budget_recent_activity(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_budget_summary()               FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_budget_by_inspector(integer)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_budget_monthly(integer)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_budget_recent_activity(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_budget_summary()                TO authenticated, service_role;

-- ─── Self-test: all four resolvable with the expected signatures ─────────────
DO $selftest$
BEGIN
  IF to_regprocedure('public.get_budget_summary()') IS NULL
     OR to_regprocedure('public.get_budget_monthly(integer)') IS NULL
     OR to_regprocedure('public.get_budget_by_inspector(integer)') IS NULL
     OR to_regprocedure('public.get_budget_recent_activity(integer)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: one or more budget RPCs missing after migration';
  END IF;
  RAISE NOTICE 'Budget RPCs versioned: summary + monthly + by_inspector + recent_activity (authenticated-only).';
END
$selftest$;
