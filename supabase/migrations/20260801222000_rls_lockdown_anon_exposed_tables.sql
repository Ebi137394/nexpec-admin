-- ============================================================================
--  20260801222000_rls_lockdown_anon_exposed_tables.sql
--
--  FINAL LOCKDOWN — close the anon/unauthenticated access hole on sensitive
--  tables that shipped RLS-DISABLED with GRANT ALL TO anon + authenticated.
--
--  THREAT:
--    The 10 tables below were granted to `anon` (the PUBLIC api key shipped in
--    every client bundle) with RLS off. Anyone could hit PostgREST unauthenticated
--    and read/UPDATE/DELETE/TRUNCATE platform money ledgers, inspector payout
--    balances, the payment audit trail, signed legal agreements, inspector PII
--    documents, certifications, and push tokens.
--
--  WHAT THIS MIGRATION DOES (zero-breakage close of the catastrophic vector):
--    • EVERY table: REVOKE ALL FROM anon, PUBLIC  → closes unauthenticated access
--      entirely. (The app uses the `authenticated` role for all these flows, so
--      this does not affect logged-in users.)
--    • SERVER/TRIGGER/DEAD tables (no client write path — verified):
--      platform_wallet, payment_audit_log, inspector_earnings, push_token_history,
--      chat_rooms, job_messages → also REVOKE writes from `authenticated` and
--      ENABLE RLS so authenticated cross-tenant mint/truncate is impossible.
--      Reads that an admin needs go through SECURITY DEFINER RPCs (bypass RLS);
--      inspector_earnings keeps an owner+admin SELECT-only policy for the wallet UI.
--
--  DELIBERATELY DEFERRED (owner-scoped CRUD — need per-table owner policies, see
--  the follow-up migration noted below): inspector_documents, certifications,
--  signed_agreements, documents. These have legitimate authenticated OWNER writes
--  (inspector manages their own docs/certs/agreements), so a correct fix is
--  ENABLE RLS + owner policy keyed on the verified owner column. This migration
--  removes their anon exposure now; full RLS + owner policies is the immediate
--  next migration (the "RLS open-table audit" epic).
--
--  SAFE TO RE-RUN: all statements are idempotent (IF EXISTS / CREATE POLICY
--  guarded by prior DROP); wrapped in a transaction.
-- ============================================================================

BEGIN;

-- ── 0. Close anon/PUBLIC on ALL 10 (the catastrophic vector) ───────────────
REVOKE ALL ON TABLE public.platform_wallet      FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.inspector_earnings   FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.payment_audit_log    FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.push_token_history   FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.chat_rooms           FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.job_messages         FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.inspector_documents  FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.certifications       FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.signed_agreements    FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.documents            FROM anon, PUBLIC;

-- ── 1. platform_wallet — platform money ledger; admin-read only, writes via RPC
ALTER TABLE public.platform_wallet ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_wallet FROM authenticated;
GRANT SELECT ON TABLE public.platform_wallet TO authenticated;  -- gated by policy below
DROP POLICY IF EXISTS platform_wallet_admin_select ON public.platform_wallet;
CREATE POLICY platform_wallet_admin_select ON public.platform_wallet
  FOR SELECT TO authenticated USING (public.nx_is_admin());

-- ── 2. payment_audit_log — forensic audit trail; admin-read only, no client writes
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_audit_log FROM authenticated;
GRANT SELECT ON TABLE public.payment_audit_log TO authenticated;  -- gated by policy below
DROP POLICY IF EXISTS payment_audit_log_admin_select ON public.payment_audit_log;
CREATE POLICY payment_audit_log_admin_select ON public.payment_audit_log
  FOR SELECT TO authenticated USING (public.nx_is_admin());

-- ── 3. inspector_earnings — payout balances; NO client write path. Lock writes;
--      keep owner + admin SELECT for the wallet UI.
ALTER TABLE public.inspector_earnings ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.inspector_earnings FROM authenticated;
DROP POLICY IF EXISTS inspector_earnings_owner_admin_select ON public.inspector_earnings;
CREATE POLICY inspector_earnings_owner_admin_select ON public.inspector_earnings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.nx_is_admin());

-- ── 4. push_token_history — device PII; populated server-side. Admin-read only.
ALTER TABLE public.push_token_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_token_history FROM authenticated;
GRANT SELECT ON TABLE public.push_token_history TO authenticated;  -- gated by policy below
DROP POLICY IF EXISTS push_token_history_admin_select ON public.push_token_history;
CREATE POLICY push_token_history_admin_select ON public.push_token_history
  FOR SELECT TO authenticated USING (public.nx_is_admin());

-- ── 5+6. chat_rooms / job_messages — LEGACY/DEAD (0 code refs). Deny all; the
--      modern chat lives in conversations/messages. Kept (not dropped) in case
--      of FK/audit references; RLS-on + no policy = deny by default.
ALTER TABLE public.chat_rooms   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_rooms   FROM authenticated;
ALTER TABLE public.job_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_messages FROM authenticated;

-- ── 7-10. inspector_documents / certifications / signed_agreements / documents
--      anon already revoked above. Full ENABLE RLS + owner policies is the
--      immediate FOLLOW-UP migration (needs verified owner columns + admin
--      overlay). Until then authenticated retains its existing access — a P1
--      cross-tenant concern, but no longer an unauthenticated (anon) hole.

COMMIT;

-- ============================================================================
-- FOLLOW-UP (next migration — the "RLS open-table audit" epic):
--   For inspector_documents (owner=inspector_id), certifications (owner=user_id?),
--   signed_agreements (owner=user_id?), documents (owner=?):
--     ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
--     REVOKE ALL FROM authenticated; GRANT SELECT,INSERT,UPDATE,DELETE TO authenticated;
--     CREATE POLICY <t>_owner_all FOR ALL TO authenticated
--       USING (<owner_col> = auth.uid() OR public.nx_is_admin())
--       WITH CHECK (<owner_col> = auth.uid() OR public.nx_is_admin());
--   Verify each owner column against the live schema first (PostgREST 42703s the
--   whole policy if the column name is wrong). Add a pgTAP guard asserting RLS-on
--   + no-anon-grant for the full sensitive set.
-- ============================================================================
