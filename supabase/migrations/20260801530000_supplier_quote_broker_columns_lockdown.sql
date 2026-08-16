-- ════════════════════════════════════════════════════════════════════════════
--  20260801530000_supplier_quote_broker_columns_lockdown.sql
--
--  P0 — a supplier could read AND rewrite the broker-controlled columns on
--  their own quote: the platform's margin, the award state, and the audit
--  attribution of who brokered it.
--
--  ── THE DEFECT (reproduced on Staging with a real supplier JWT) ────────────
--  public.supplier_quotes carries two kinds of column on one row:
--
--      supplier-owned : quote (the bid jsonb)
--      broker-owned   : client_price_cents, admin_note, presented_at,
--                       presented_by, status
--
--  RLS scopes WHICH ROW a supplier may touch (`quote_supplier`: FOR ALL USING
--  supplier_id = auth.uid()). Nothing scoped WHICH COLUMN, and `authenticated`
--  held table-wide SELECT/INSERT/UPDATE/DELETE. PostgREST exposes the table
--  directly, so the canonical RPCs were merely the front door:
--
--    PATCH /supplier_quotes?id=eq.<own quote>
--      { "client_price_cents": 1 }        -> 200, margin rewritten
--      { "status": "accepted" }           -> 200, SELF-AWARDED
--      { "presented_by": "<self>" }       -> 200, audit attribution forged
--      { "admin_note": "..." }            -> 200, broker note overwritten
--
--  and a plain GET returned client_price_cents. A supplier knows their own
--  cost, so reading the client price hands them NEXPEC's exact spread — the
--  precise thing marketplace.ts:30-35 says must never reach them.
--
--  Self-award is the worst of these. `award_quote` correctly refuses a supplier
--  (`not_authorized`) and `admin_present_quote` refuses anyone who is not an
--  admin — but a direct PATCH bypassed both and set status='accepted', which is
--  the trigger that spawns the source/FAT job. Admin was not the only award
--  authority in practice.
--
--  Mobile made the read half worse: src/hooks/useSupplierEcosystem.ts issued
--  `.select('*')` on supplier_quotes in three places, so the spread and the
--  internal admin note were shipped to the supplier's device. That client is
--  corrected in the same commit.
--
--  ── THE FIX: THE PATTERN public.jobs ALREADY USES ─────────────────────────
--  `authenticated` holds NO table-level SELECT on public.jobs. It holds
--  column-level SELECT on the safe columns only, and the money columns
--  (client_price_cents, inspector_payout_cents) are simply not granted. Reads
--  that legitimately need them go through jobs_secure_view, which is owned by
--  postgres, marked security_barrier, and gates the sensitive columns behind
--  nx_is_admin().
--
--  This migration applies exactly that shape to supplier_quotes:
--
--    • table-level privileges revoked from anon and authenticated
--    • column-level SELECT granted for the supplier-safe columns
--    • column-level INSERT/UPDATE granted only for the bid itself
--    • rfq_admin_quotes_view added for the admin console
--
--  ── WHY NO TRIGGER GUARD ───────────────────────────────────────────────────
--  The obvious alternative — a BEFORE UPDATE guard like
--  nx_guard_jobs_funding_columns — is WRONG here, and it is worth recording
--  why so it is not "fixed" back in later. Two canonical RPCs legitimately
--  write these columns while the CALLER is not a platform actor:
--
--    • submit_quote  sets status='submitted'  — caller is the SUPPLIER
--    • award_quote   sets status='accepted'   — caller is the RFQ's CLIENT
--
--  SECURITY DEFINER does not change auth.uid() or the JWT role, so
--  nx_actor_is_platform() is false inside both, and a platform-only trigger
--  would break the award path. Column privileges are the right layer precisely
--  because SECURITY DEFINER functions execute with the owner's rights and are
--  unaffected by them, while a direct PostgREST request is not.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • RLS on supplier_quotes: untouched. Row scoping was never the defect.
--   • submit_quote / admin_present_quote / award_quote / award_and_dispatch:
--     untouched, and all four keep working — proved by the regression suite.
--   • No other table, and no policy anywhere.
--   • Every path this migration changes ends up strictly more restrictive.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Close the table, then reopen it column by column ───────────────────
REVOKE ALL ON TABLE public.supplier_quotes FROM anon;
REVOKE ALL ON TABLE public.supplier_quotes FROM authenticated;

-- Read: everything a supplier's own bid card renders, and nothing else.
-- Deliberately ABSENT: client_price_cents (the platform spread), admin_note
-- (internal broker note), presented_by (which admin brokered it).
GRANT SELECT (id, rfq_id, supplier_id, quote, status, created_at, presented_at)
  ON public.supplier_quotes TO authenticated;

-- Write: the bid itself. The canonical writer is submit_quote (SECURITY
-- DEFINER, unaffected by these grants); these narrow grants exist so a direct
-- request can still only ever touch the supplier's own offer text.
GRANT INSERT (rfq_id, supplier_id, quote) ON public.supplier_quotes TO authenticated;
GRANT UPDATE (quote)                      ON public.supplier_quotes TO authenticated;

-- No DELETE: withdrawing a bid is a status transition owned by the broker
-- flow, and no client code deletes a quote row.

-- ─── 2. The admin console still needs the raw quote AND the markup ─────────
-- Same construction as jobs_secure_view: owned by postgres so it reads the
-- base table with owner rights, security_barrier so the admin predicate cannot
-- be reordered behind a leaky function, and an explicit nx_is_admin() gate so
-- the view is empty for everyone else.
DROP VIEW IF EXISTS public.rfq_admin_quotes_view;
CREATE VIEW public.rfq_admin_quotes_view
  WITH (security_barrier = true) AS
SELECT
  q.id,
  q.rfq_id,
  q.supplier_id,
  q.quote,
  q.status,
  q.client_price_cents,
  q.admin_note,
  q.presented_at,
  q.presented_by,
  q.created_at
FROM public.supplier_quotes q
WHERE public.nx_is_admin();

ALTER VIEW public.rfq_admin_quotes_view OWNER TO postgres;
REVOKE ALL ON public.rfq_admin_quotes_view FROM anon;
GRANT SELECT ON public.rfq_admin_quotes_view TO authenticated;
GRANT ALL    ON public.rfq_admin_quotes_view TO service_role;

-- ─── 3. Prove the outcome in the same transaction that caused it ───────────
DO $$
DECLARE v_leaky text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_leaky
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'supplier_quotes'
     AND grantee IN ('anon', 'authenticated')
     AND column_name IN ('client_price_cents', 'admin_note', 'presented_by');
  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION
      'BROKER_COLUMNS_STILL_EXPOSED: anon/authenticated retain privileges on %', v_leaky;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'supplier_quotes'
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'BROKER_COLUMNS_STILL_EXPOSED: anon retains a table grant on supplier_quotes';
  END IF;

  RAISE NOTICE 'ok: supplier_quotes broker columns are closed to anon and authenticated.';
END $$;

COMMIT;
