-- ════════════════════════════════════════════════════════════════════════════
--  20260602120000_multi_currency_rollup_rpcs.sql
--  Phase 6 / Sprint 7 — Multi-currency-aware budget roll-ups.
--
--  CREATE OR REPLACEs the two existing rollup RPCs so each returned
--  row carries BOTH the native amounts (unchanged storage values)
--  AND a converted projection in the caller's chosen display currency.
--
--  · The native columns are kept verbatim — historical audit reads
--    against an older snapshot of the function continue to make sense.
--  · A new `p_display_currency` parameter (default = org's base_currency
--    when omitted) adds the converted columns.
--  · Conversion goes through convert_cents() which itself reads the
--    fx_rates table; if no rate path exists, the converted column is
--    NULL and the UI surfaces "rate unavailable" rather than zero.
--
--  Backward compatibility:
--  · Calling either RPC with no display-currency arg is still legal.
--    The function defaults to the org's base_currency, so legacy
--    callers automatically get USD-converted (or whichever org-default)
--    figures without code changes.
--  · The shape of the returned columns is a strict superset of the
--    previous version — existing TypeScript fetchers continue to
--    deserialize cleanly.
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Helper — resolve "the display currency to use" for an org.
--
--  Precedence:
--    1. p_requested (caller's choice, e.g. user toggled the selector)
--    2. organizations.base_currency (the org's preferred default)
--    3. 'USD' (last-resort fallback)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._resolve_display_currency(
  p_org_id     uuid,
  p_requested  text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(p_requested, ''),
    (SELECT base_currency::text FROM public.organizations WHERE id = p_org_id),
    'USD'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_department_budget_rollup  (CURRENCY-AWARE)
--
--  The returned shape gains four new columns:
--    · display_currency               which currency the *_display
--                                     values are expressed in
--    · display_committed_cents        rollup_committed_cents converted
--    · display_paid_cents             rollup_paid_cents converted
--    · rate_unavailable               true when conversion returned NULL
--
--  Native columns kept verbatim from the prior version so callers that
--  care about original amounts (e.g. compliance exports) still see them.
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fetch_department_budget_rollup(uuid, text);

CREATE OR REPLACE FUNCTION public.fetch_department_budget_rollup(
  p_org_id            uuid,
  p_window            text DEFAULT 'all_time',
  p_display_currency  text DEFAULT NULL
)
RETURNS TABLE (
  department_id          uuid,
  parent_department_id   uuid,
  name                   text,
  cost_center            text,
  depth                  int,
  currency               text,                -- native currency
  direct_committed_cents bigint,
  direct_paid_cents      bigint,
  rollup_committed_cents bigint,
  rollup_paid_cents      bigint,
  direct_invoice_count   int,
  rollup_invoice_count   int,
  last_invoice_at        timestamptz,
  -- Sprint 7 — multi-currency display projection
  display_currency       text,
  display_committed_cents bigint,
  display_paid_cents     bigint,
  rate_unavailable       boolean
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
  v_display    text;
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

  v_display := public._resolve_display_currency(p_org_id, p_display_currency);

  IF NOT v_has_inv THEN
    -- Empty skeleton — same shape, all zero numbers, no rate flag.
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
             v_display, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
             0, 0, NULL::timestamptz,
             v_display, 0::bigint, 0::bigint, false
        FROM tree t
       ORDER BY t.depth, lower(t.name);
    RETURN;
  END IF;

  -- ── Main aggregation (same CTE shape as the pre-currency version). ──
  RETURN QUERY
  WITH RECURSIVE
  dept_tree AS (
    SELECT d.id, d.parent_department_id, d.name, d.cost_center, 0 AS depth
      FROM public.departments d
     WHERE d.org_id = p_org_id AND d.parent_department_id IS NULL
    UNION ALL
    SELECT d.id, d.parent_department_id, d.name, d.cost_center, t.depth + 1
      FROM public.departments d
      JOIN dept_tree t ON t.id = d.parent_department_id
  ),
  descendant_of AS (
    SELECT d.id AS dept_id, d.id AS ancestor_id
      FROM public.departments d
     WHERE d.org_id = p_org_id
    UNION ALL
    SELECT df.dept_id, d.parent_department_id
      FROM descendant_of df
      JOIN public.departments d ON d.id = df.ancestor_id
     WHERE d.parent_department_id IS NOT NULL
  ),
  direct_totals AS (
    SELECT
      i.department_id                           AS dept_id,
      COALESCE(i.currency, 'USD')               AS currency,
      SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint AS committed_cents,
      SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint AS paid_cents,
      COUNT(*)::int                             AS invoice_count,
      MAX(i.issued_at)                          AS last_at
      FROM public.invoices i
     WHERE i.department_id IN (SELECT id FROM dept_tree)
       AND (v_window_lo IS NULL OR i.issued_at >= v_window_lo)
     GROUP BY i.department_id, COALESCE(i.currency, 'USD')
  ),
  rollup_totals AS (
    SELECT
      df.ancestor_id          AS dept_id,
      dt.currency             AS currency,
      SUM(dt.committed_cents)::bigint AS committed_cents,
      SUM(dt.paid_cents)::bigint      AS paid_cents,
      SUM(dt.invoice_count)::int      AS invoice_count,
      MAX(dt.last_at)                 AS last_at
      FROM descendant_of df
      JOIN direct_totals dt ON dt.dept_id = df.dept_id
     GROUP BY df.ancestor_id, dt.currency
  ),
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
    GREATEST(dt.last_at, rt.last_at)                    AS last_invoice_at,
    -- ── Display projection ──
    v_display                                           AS display_currency,
    public.convert_cents(
      COALESCE(rt.committed_cents, 0)::bigint,
      rk.currency, v_display,
      COALESCE(GREATEST(dt.last_at, rt.last_at), now())
    )                                                   AS display_committed_cents,
    public.convert_cents(
      COALESCE(rt.paid_cents, 0)::bigint,
      rk.currency, v_display,
      COALESCE(GREATEST(dt.last_at, rt.last_at), now())
    )                                                   AS display_paid_cents,
    (
      rk.currency <> v_display
      AND public.convert_cents(1, rk.currency, v_display, now()) IS NULL
    )                                                   AS rate_unavailable
    FROM row_keys rk
    JOIN dept_tree t ON t.id = rk.dept_id
    LEFT JOIN direct_totals dt ON dt.dept_id = rk.dept_id AND dt.currency = rk.currency
    LEFT JOIN rollup_totals rt ON rt.dept_id = rk.dept_id AND rt.currency = rk.currency

  UNION ALL

  -- ── Synthetic "Unattributed" rows ──
  SELECT
    NULL::uuid                                          AS department_id,
    NULL::uuid                                          AS parent_department_id,
    'Unattributed'::text                                AS name,
    NULL::text                                          AS cost_center,
    -1                                                  AS depth,
    COALESCE(i.currency, 'USD')                         AS currency,
    SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint AS direct_committed_cents,
    SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint AS direct_paid_cents,
    SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint AS rollup_committed_cents,
    SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint AS rollup_paid_cents,
    COUNT(*)::int                                       AS direct_invoice_count,
    COUNT(*)::int                                       AS rollup_invoice_count,
    MAX(i.issued_at)                                    AS last_invoice_at,
    v_display                                           AS display_currency,
    public.convert_cents(
      SUM(CASE WHEN i.status <> 'voided' THEN i.total_cents ELSE 0 END)::bigint,
      COALESCE(i.currency, 'USD'), v_display, MAX(i.issued_at)
    )                                                   AS display_committed_cents,
    public.convert_cents(
      SUM(CASE WHEN i.status =  'paid'   THEN i.total_cents ELSE 0 END)::bigint,
      COALESCE(i.currency, 'USD'), v_display, MAX(i.issued_at)
    )                                                   AS display_paid_cents,
    (
      COALESCE(i.currency, 'USD') <> v_display
      AND public.convert_cents(1, COALESCE(i.currency, 'USD'), v_display, now()) IS NULL
    )                                                   AS rate_unavailable
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

GRANT EXECUTE ON FUNCTION public.fetch_department_budget_rollup(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_department_spend_summary  (CURRENCY-AWARE)
--
--  Adds display_currency + converted direct/rollup blocks at the top
--  level of the jsonb payload. Native values stay in `direct` and
--  `rollup` for caller compatibility.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_department_spend_summary(
  p_department_id    uuid,
  p_display_currency text DEFAULT NULL
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
  v_display     text;
  v_display_direct jsonb;
  v_display_rollup jsonb;
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

  v_display := public._resolve_display_currency(v_org_id, p_display_currency);

  IF NOT v_has_inv THEN
    RETURN jsonb_build_object(
      'ok', true,
      'department_id', p_department_id,
      'department_name', v_dept_name,
      'cost_center', v_cost_center,
      'currency', 'USD',
      'mixed_currencies', false,
      'display_currency', v_display,
      'direct',  jsonb_build_object(
        'all_time_committed_cents', 0, 'all_time_paid_cents', 0,
        'mtd_committed_cents', 0, 'qtd_committed_cents', 0, 'ytd_committed_cents', 0,
        'invoice_count', 0, 'last_invoice_at', null
      ),
      'rollup', jsonb_build_object(
        'all_time_committed_cents', 0, 'all_time_paid_cents', 0,
        'mtd_committed_cents', 0, 'qtd_committed_cents', 0, 'ytd_committed_cents', 0,
        'invoice_count', 0, 'last_invoice_at', null
      ),
      'display_direct',  jsonb_build_object(
        'all_time_committed_cents', 0, 'all_time_paid_cents', 0,
        'mtd_committed_cents', 0, 'qtd_committed_cents', 0, 'ytd_committed_cents', 0,
        'rate_unavailable', false
      ),
      'display_rollup', jsonb_build_object(
        'all_time_committed_cents', 0, 'all_time_paid_cents', 0,
        'mtd_committed_cents', 0, 'qtd_committed_cents', 0, 'ytd_committed_cents', 0,
        'rate_unavailable', false
      ),
      'recent_invoices', '[]'::jsonb
    );
  END IF;

  -- ── currency mix + predominant ──
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  ),
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

  -- ── Native direct/rollup (predominant currency only) ──
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

  -- ── Display projection — converts EVERY currency in the subtree
  --    into v_display via convert_cents, then sums. This handles
  --    multi-currency invoice mixes correctly. ──
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  ),
  display_direct AS (
    SELECT
      SUM(CASE WHEN i.status <> 'voided'
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS all_time_committed_cents,
      SUM(CASE WHEN i.status = 'paid'
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS all_time_paid_cents,
      SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_mtd
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS mtd_committed_cents,
      SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_qtd
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS qtd_committed_cents,
      SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_ytd
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS ytd_committed_cents,
      bool_or(public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at) IS NULL
              AND i.total_cents IS NOT NULL) AS rate_unavailable
      FROM public.invoices i
     WHERE i.department_id = p_department_id
  )
  SELECT jsonb_build_object(
    'all_time_committed_cents', COALESCE(all_time_committed_cents, 0),
    'all_time_paid_cents',      COALESCE(all_time_paid_cents, 0),
    'mtd_committed_cents',      COALESCE(mtd_committed_cents, 0),
    'qtd_committed_cents',      COALESCE(qtd_committed_cents, 0),
    'ytd_committed_cents',      COALESCE(ytd_committed_cents, 0),
    'rate_unavailable',         COALESCE(rate_unavailable, false)
  ) INTO v_display_direct FROM display_direct;

  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  ),
  display_rollup AS (
    SELECT
      SUM(CASE WHEN i.status <> 'voided'
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS all_time_committed_cents,
      SUM(CASE WHEN i.status = 'paid'
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS all_time_paid_cents,
      SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_mtd
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS mtd_committed_cents,
      SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_qtd
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS qtd_committed_cents,
      SUM(CASE WHEN i.status <> 'voided' AND i.issued_at >= v_window_ytd
               THEN public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at)
               ELSE 0 END)::bigint AS ytd_committed_cents,
      bool_or(public.convert_cents(i.total_cents, COALESCE(i.currency,'USD'), v_display, i.issued_at) IS NULL
              AND i.total_cents IS NOT NULL) AS rate_unavailable
      FROM public.invoices i
     WHERE i.department_id IN (SELECT id FROM subtree)
  )
  SELECT jsonb_build_object(
    'all_time_committed_cents', COALESCE(all_time_committed_cents, 0),
    'all_time_paid_cents',      COALESCE(all_time_paid_cents, 0),
    'mtd_committed_cents',      COALESCE(mtd_committed_cents, 0),
    'qtd_committed_cents',      COALESCE(qtd_committed_cents, 0),
    'ytd_committed_cents',      COALESCE(ytd_committed_cents, 0),
    'rate_unavailable',         COALESCE(rate_unavailable, false)
  ) INTO v_display_rollup FROM display_rollup;

  -- ── Recent invoices (each row includes its native + converted amount) ──
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
        'invoice_id',           i.id,
        'invoice_number',       i.invoice_number,
        'job_id',                i.job_id,
        'total_cents',          i.total_cents,
        'currency',             COALESCE(i.currency, 'USD'),
        'status',               i.status,
        'issued_at',            i.issued_at,
        'department_id',        i.department_id,
        'cost_center_snapshot', i.cost_center_snapshot,
        -- Sprint 7 — display projection per row
        'display_currency',     v_display,
        'display_total_cents',  public.convert_cents(
                                  i.total_cents,
                                  COALESCE(i.currency, 'USD'),
                                  v_display,
                                  i.issued_at
                                )
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
    'display_currency', v_display,
    'direct', COALESCE(v_direct, '{}'::jsonb),
    'rollup', COALESCE(v_rollup, '{}'::jsonb),
    'display_direct',  COALESCE(v_display_direct,  '{}'::jsonb),
    'display_rollup',  COALESCE(v_display_rollup,  '{}'::jsonb),
    'recent_invoices', COALESCE(v_recent, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_department_spend_summary(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  Backward-compatible single-arg overload — preserves any call sites
--  that haven't been ported to the multi-currency parameter yet.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_department_spend_summary(
  p_department_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.fetch_department_spend_summary(p_department_id, NULL);
$$;

GRANT EXECUTE ON FUNCTION public.fetch_department_spend_summary(uuid) TO authenticated;

COMMIT;
