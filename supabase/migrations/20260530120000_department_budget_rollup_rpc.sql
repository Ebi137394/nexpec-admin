-- ════════════════════════════════════════════════════════════════════════════
--  20260530120000_department_budget_rollup_rpc.sql
--  Phase 6 / Sprint 5 — Cost-center → budget roll-up, query layer.
--
--  WHAT THIS LANDS
--  ───────────────
--    · fetch_department_budget_rollup(org_id, window)
--        Recursive CTE over departments in the org, joined to invoices
--        on department_id, summing committed_cents (everything not voided)
--        and paid_cents (status = paid) — both per currency. Roll-up is
--        computed by summing across the depth-first subtree so each row
--        carries direct_*, descendants_*, and total_* values.
--
--        Output also includes a synthetic row with department_id = NULL
--        capturing "unattributed" spend — invoices in this org's client
--        space (job.client_id ∈ org_members(p_org_id)) that have no
--        department_id set yet.
--
--    · fetch_department_spend_summary(department_id)
--        Tight summary for the DepartmentDetailPanel — direct vs rolled-up,
--        MTD / QTD / YTD slices, plus the 5 most recent invoices.
--
--  AUTH
--  ────
--  Both RPCs are SECURITY DEFINER. Reads gated by is_member_of_org() (the
--  helper landed in yesterday's hotfix migration). Super-admin is implicit
--  because is_member_of_org returns true via the role check upstream — no
--  no it doesn't actually. Let me re-state: is_member_of_org checks only
--  org_members. Super-admin sees everything regardless because they're
--  super_admin in profiles. We OR both into the gate explicitly below.
--
--  CURRENCIES
--  ──────────
--  Roll-ups group by (department_id, currency). The UI surfaces the
--  predominant currency and notes when multiple exist.
--
--  WINDOWS
--  ───────
--  'all_time' | 'mtd' | 'qtd' | 'ytd' | 'l90' | 'l365'
--  Filter is on invoices.issued_at (the canonical commitment moment).
--
--  Defensive against missing public.invoices — returns empty rather than
--  erroring, so the migration is safe to apply before the financial suite
--  foundation has been backfilled into this repo.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Helper: window → lower bound timestamp
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._budget_window_start(p_window text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_window, 'all_time'))
    WHEN 'mtd'      THEN date_trunc('month',   now())
    WHEN 'qtd'      THEN date_trunc('quarter', now())
    WHEN 'ytd'      THEN date_trunc('year',    now())
    WHEN 'l90'      THEN now() - interval '90 days'
    WHEN 'l365'     THEN now() - interval '365 days'
    WHEN 'all_time' THEN NULL::timestamptz
    ELSE                  NULL::timestamptz
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────
--  Helper: super_admin shortcut
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._actor_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public._actor_is_super_admin() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_department_budget_rollup
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_department_budget_rollup(
  p_org_id  uuid,
  p_window  text DEFAULT 'all_time'
)
RETURNS TABLE (
  department_id          uuid,
  parent_department_id   uuid,
  name                   text,
  cost_center            text,
  depth                  int,
  currency               text,
  direct_committed_cents bigint,
  direct_paid_cents      bigint,
  rollup_committed_cents bigint,
  rollup_paid_cents      bigint,
  direct_invoice_count   int,
  rollup_invoice_count   int,
  last_invoice_at        timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_window_lo  timestamptz := public._budget_window_start(p_window);
  v_has_inv    boolean := to_regclass('public.invoices') IS NOT NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
       public._actor_is_super_admin()
    OR public.is_member_of_org(p_org_id)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to view this organization''s spend'
      USING ERRCODE = '42501';
  END IF;

  -- Short-circuit: no invoices table yet → return department skeleton
  -- with zero totals so the UI degrades gracefully.
  IF NOT v_has_inv THEN
    RETURN QUERY
      WITH RECURSIVE tree AS (
        SELECT d.id, d.parent_department_id, d.name, d.cost_center, 0 AS depth
          FROM public.departments d
         WHERE d.org_id = p_org_id AND d.parent_department_id IS NULL
        UNION ALL
        SELECT d.id, d.parent_department_id, d.name, d.cost_center, t.depth + 1
          FROM public.departments d
          JOIN tree t ON t.id = d.parent_department_id
      )
      SELECT t.id, t.parent_department_id, t.name, t.cost_center, t.depth,
             'USD'::text,
             0::bigint, 0::bigint, 0::bigint, 0::bigint,
             0, 0,
             NULL::timestamptz
        FROM tree t
       ORDER BY t.depth, lower(t.name);
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  -- ── Department tree for this org, with depth annotation ──────────
  dept_tree AS (
    SELECT d.id, d.parent_department_id, d.name, d.cost_center, 0 AS depth
      FROM public.departments d
     WHERE d.org_id = p_org_id AND d.parent_department_id IS NULL
    UNION ALL
    SELECT d.id, d.parent_department_id, d.name, d.cost_center, t.depth + 1
      FROM public.departments d
      JOIN dept_tree t ON t.id = d.parent_department_id
  ),
  -- ── Every (descendant, ancestor) pair (incl. self) for fan-out ───
  descendant_of AS (
    SELECT d.id AS dept_id, d.id AS ancestor_id
      FROM public.departments d
     WHERE d.org_id = p_org_id
    UNION ALL
    SELECT df.dept_id, d.parent_department_id
      FROM descendant_of df
      JOIN public.departments d
        ON d.id = df.ancestor_id
     WHERE d.parent_department_id IS NOT NULL
  ),
  -- ── Direct invoice totals per (department, currency) ─────────────
  direct_totals AS (
    SELECT
      i.department_id                                   AS dept_id,
      COALESCE(i.currency, 'USD')                       AS currency,
      SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint AS committed_cents,
      SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint AS paid_cents,
      COUNT(*)::int                                     AS invoice_count,
      MAX(i.issued_at)                                  AS last_at
      FROM public.invoices i
     WHERE i.department_id IN (SELECT id FROM dept_tree)
       AND (v_window_lo IS NULL OR i.issued_at >= v_window_lo)
     GROUP BY i.department_id, COALESCE(i.currency, 'USD')
  ),
  -- ── Rolled-up totals = sum of direct totals over the subtree ─────
  rollup_totals AS (
    SELECT
      df.ancestor_id            AS dept_id,
      dt.currency               AS currency,
      SUM(dt.committed_cents)::bigint AS committed_cents,
      SUM(dt.paid_cents)::bigint      AS paid_cents,
      SUM(dt.invoice_count)::int      AS invoice_count,
      MAX(dt.last_at)                 AS last_at
      FROM descendant_of df
      JOIN direct_totals dt ON dt.dept_id = df.dept_id
     GROUP BY df.ancestor_id, dt.currency
  ),
  -- ── Every (dept, currency) we want a row for: union of both
  --     direct and rollup keys, so a parent shows even if it has
  --     no direct invoices but its children do.                    ─
  row_keys AS (
    SELECT dept_id, currency FROM direct_totals
    UNION
    SELECT dept_id, currency FROM rollup_totals
  )
  SELECT
    t.id                                                AS department_id,
    t.parent_department_id                              AS parent_department_id,
    t.name                                              AS name,
    t.cost_center                                       AS cost_center,
    t.depth                                             AS depth,
    rk.currency                                         AS currency,
    COALESCE(dt.committed_cents, 0)::bigint             AS direct_committed_cents,
    COALESCE(dt.paid_cents,      0)::bigint             AS direct_paid_cents,
    COALESCE(rt.committed_cents, 0)::bigint             AS rollup_committed_cents,
    COALESCE(rt.paid_cents,      0)::bigint             AS rollup_paid_cents,
    COALESCE(dt.invoice_count,   0)::int                AS direct_invoice_count,
    COALESCE(rt.invoice_count,   0)::int                AS rollup_invoice_count,
    GREATEST(dt.last_at, rt.last_at)                    AS last_invoice_at
    FROM row_keys rk
    JOIN dept_tree t       ON t.id      = rk.dept_id
    LEFT JOIN direct_totals dt ON dt.dept_id  = rk.dept_id AND dt.currency = rk.currency
    LEFT JOIN rollup_totals rt ON rt.dept_id  = rk.dept_id AND rt.currency = rk.currency

  UNION ALL

  -- ── Synthetic "Unattributed" row(s): invoices in this org's
  --    client space with NULL department_id. One row per currency. ─
  SELECT
    NULL::uuid                                          AS department_id,
    NULL::uuid                                          AS parent_department_id,
    'Unattributed'::text                                AS name,
    NULL::text                                          AS cost_center,
    -1                                                  AS depth,
    COALESCE(i.currency, 'USD')                         AS currency,
    SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint
                                                        AS direct_committed_cents,
    SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint
                                                        AS direct_paid_cents,
    SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint
                                                        AS rollup_committed_cents,
    SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint
                                                        AS rollup_paid_cents,
    COUNT(*)::int                                       AS direct_invoice_count,
    COUNT(*)::int                                       AS rollup_invoice_count,
    MAX(i.issued_at)                                    AS last_invoice_at
    FROM public.invoices i
    JOIN public.jobs j ON j.id = i.job_id
   WHERE i.department_id IS NULL
     AND (v_window_lo IS NULL OR i.issued_at >= v_window_lo)
     AND j.client_id IN (
       SELECT user_id FROM public.org_members WHERE org_id = p_org_id
     )
   GROUP BY COALESCE(i.currency, 'USD')
   HAVING COUNT(*) > 0

   ORDER BY depth, lower(name), currency;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_department_budget_rollup(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_department_spend_summary
--  Compact summary for the DepartmentDetailPanel — direct + rolled-up
--  totals for the all-time horizon plus MTD / QTD / YTD slices, plus
--  the last 5 invoices attributed to this dept or any descendant.
--
--  Returns a single jsonb so the client can deserialise without per-
--  currency multi-row gymnastics. Currency mixing is rare at a single-
--  dept level; we expose the predominant currency and a flag.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_department_spend_summary(
  p_department_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_org_id      uuid;
  v_dept_name   text;
  v_cost_center text;
  v_has_inv     boolean := to_regclass('public.invoices') IS NOT NULL;
  v_predom      text;
  v_currency_count int;
  v_direct      jsonb;
  v_rollup      jsonb;
  v_recent      jsonb;
  v_window_mtd  timestamptz := date_trunc('month',   now());
  v_window_qtd  timestamptz := date_trunc('quarter', now());
  v_window_ytd  timestamptz := date_trunc('year',    now());
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id, name, cost_center
    INTO v_org_id, v_dept_name, v_cost_center
    FROM public.departments WHERE id = p_department_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
       public._actor_is_super_admin()
    OR public.is_member_of_org(v_org_id)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to view this department''s spend'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_has_inv THEN
    RETURN jsonb_build_object(
      'ok', true,
      'department_id', p_department_id,
      'department_name', v_dept_name,
      'cost_center', v_cost_center,
      'currency', 'USD',
      'mixed_currencies', false,
      'direct',  jsonb_build_object(
        'all_time_committed_cents', 0,
        'all_time_paid_cents', 0,
        'mtd_committed_cents', 0,
        'qtd_committed_cents', 0,
        'ytd_committed_cents', 0,
        'invoice_count', 0,
        'last_invoice_at', null
      ),
      'rollup', jsonb_build_object(
        'all_time_committed_cents', 0,
        'all_time_paid_cents', 0,
        'mtd_committed_cents', 0,
        'qtd_committed_cents', 0,
        'ytd_committed_cents', 0,
        'invoice_count', 0,
        'last_invoice_at', null
      ),
      'recent_invoices', '[]'::jsonb
    );
  END IF;

  -- Collect descendant ids of this department (incl. self).
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  ),
  -- Currency mix
  currency_mix AS (
    SELECT COALESCE(i.currency, 'USD') AS currency, COUNT(*)::int AS n
      FROM public.invoices i
     WHERE i.department_id IN (SELECT id FROM subtree)
     GROUP BY COALESCE(i.currency, 'USD')
     ORDER BY n DESC
  )
  SELECT (SELECT currency FROM currency_mix LIMIT 1),
         (SELECT count(*) FROM currency_mix)
    INTO v_predom, v_currency_count;

  v_predom := COALESCE(v_predom, 'USD');

  -- Direct totals (this dept only) in predominant currency.
  SELECT jsonb_build_object(
    'all_time_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END), 0),
    'all_time_paid_cents',
      COALESCE(SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END), 0),
    'mtd_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_mtd THEN i.total_cents ELSE 0 END), 0),
    'qtd_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_qtd THEN i.total_cents ELSE 0 END), 0),
    'ytd_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_ytd THEN i.total_cents ELSE 0 END), 0),
    'invoice_count', COUNT(*)::int,
    'last_invoice_at', MAX(i.issued_at)
  )
    INTO v_direct
    FROM public.invoices i
   WHERE i.department_id = p_department_id
     AND COALESCE(i.currency, 'USD') = v_predom;

  -- Rolled-up totals (this dept + descendants) in predominant currency.
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  )
  SELECT jsonb_build_object(
    'all_time_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END), 0),
    'all_time_paid_cents',
      COALESCE(SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END), 0),
    'mtd_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_mtd THEN i.total_cents ELSE 0 END), 0),
    'qtd_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_qtd THEN i.total_cents ELSE 0 END), 0),
    'ytd_committed_cents',
      COALESCE(SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_ytd THEN i.total_cents ELSE 0 END), 0),
    'invoice_count', COUNT(*)::int,
    'last_invoice_at', MAX(i.issued_at)
  )
    INTO v_rollup
    FROM public.invoices i
   WHERE i.department_id IN (SELECT id FROM subtree)
     AND COALESCE(i.currency, 'USD') = v_predom;

  -- Recent 5 invoices in this dept or any descendant.
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  )
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT jsonb_build_object(
        'invoice_id',     i.id,
        'invoice_number', i.invoice_number,
        'job_id',         i.job_id,
        'total_cents',    i.total_cents,
        'currency',       COALESCE(i.currency, 'USD'),
        'status',         i.status,
        'issued_at',      i.issued_at,
        'department_id',  i.department_id,
        'cost_center_snapshot', i.cost_center_snapshot
      ) AS row
        FROM public.invoices i
       WHERE i.department_id IN (SELECT id FROM subtree)
       ORDER BY i.issued_at DESC NULLS LAST
       LIMIT 5
    ) sub;

  RETURN jsonb_build_object(
    'ok', true,
    'department_id', p_department_id,
    'department_name', v_dept_name,
    'cost_center', v_cost_center,
    'currency', v_predom,
    'mixed_currencies', COALESCE(v_currency_count, 0) > 1,
    'direct', COALESCE(v_direct, '{}'::jsonb),
    'rollup', COALESCE(v_rollup, '{}'::jsonb),
    'recent_invoices', COALESCE(v_recent, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_department_spend_summary(uuid) TO authenticated;

COMMIT;
