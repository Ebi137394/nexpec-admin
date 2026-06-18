-- ════════════════════════════════════════════════════════════════════════════
--  20260801149000_admin_financial_read_rpcs.sql
--
--  Mobile admin financial parity WITHOUT widening the money-table RLS.
--
--  Decision (owner): keep the money/price-blind tables (transactions,
--  payout_requests, invoices, withdrawals, payments, job_expenses) RPC/
--  service-only — NO client-side admin SELECT overlay. But the mobile admin
--  financial screens (app/(admin)/financial.tsx + financial/_shared.tsx) read
--  payout_requests + transactions directly, and mobile has no service_role path
--  (anon client + user JWT, bound by RLS) — so admin saw empty.
--
--  Fix: two admin-only SECURITY DEFINER readers (owned by postgres, bypass RLS,
--  hard nx_is_admin() guard, search_path locked). They return jsonb in the EXACT
--  shape the screens already consume, so the repoint is a 1:1 swap of the query
--  builder for an .rpc() call. The base tables stay locked; the only admin read
--  path is through these guarded functions.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Pending/any payout requests (sum + list on the financial detail) ─────
CREATE OR REPLACE FUNCTION public.admin_list_payout_requests(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(pr)), '[]'::jsonb)
    FROM public.payout_requests pr
    WHERE p_status IS NULL OR pr.status = p_status
  );
END
$fn$;

-- ─── 2. Recent transactions with job title joined (preview list) ─────────────
CREATE OR REPLACE FUNCTION public.admin_recent_transactions(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(r.row), '[]'::jsonb)
    FROM (
      SELECT to_jsonb(t) || jsonb_build_object('job', jsonb_build_object('title', j.title)) AS row
      FROM public.transactions t
      LEFT JOIN public.jobs j ON j.id = t.job_id
      ORDER BY t.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 20), 1)
    ) r
  );
END
$fn$;

-- ─── Grants: execute by authenticated only (body self-guards to admin) ───────
REVOKE ALL ON FUNCTION public.admin_list_payout_requests(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_recent_transactions(int)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payout_requests(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_recent_transactions(int)   TO authenticated, service_role;

ALTER FUNCTION public.admin_list_payout_requests(text) OWNER TO postgres;
ALTER FUNCTION public.admin_recent_transactions(int)   OWNER TO postgres;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regprocedure('public.admin_list_payout_requests(text)') IS NULL
     OR to_regprocedure('public.admin_recent_transactions(int)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: admin financial read RPCs not created';
  END IF;
  RAISE NOTICE 'admin financial read RPCs ready (money tables stay RLS-locked; admin reads via these only).';
END
$selftest$;
