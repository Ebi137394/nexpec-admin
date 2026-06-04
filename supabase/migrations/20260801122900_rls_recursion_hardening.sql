-- ════════════════════════════════════════════════════════════════════════════
--  20260801122900_rls_recursion_hardening.sql
--
--  P0 FIX — two infinite-recursion RLS loops (Postgres error 42P17).
--
--  (a) MEETINGS: meeting_participants_read's USING clause sub-selects its OWN
--      table (job_meeting_participants) → self-recursion; meetings_read reads it
--      too → compounds. Any non-admin reading a meeting → 42P17.
--
--  (b) SUPPLIER MARKETPLACE: 122300 made supplier_rfqs.rfq_supplier_browse read
--      supplier_quotes, while supplier_quotes.quote_client_view reads
--      supplier_rfqs → a mutual loop. Any supplier reading RFQs (or client
--      reading quotes) → 42P17.
--
--  FIX: route the membership checks through SECURITY DEFINER helpers (owned by a
--  superuser → bypass RLS), so the policy expression never re-enters the same
--  relation's policy. Same proven pattern as nx_is_admin().
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (a) Meetings ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_meeting_participant(p_meeting uuid, p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.job_meeting_participants
     WHERE meeting_id = p_meeting AND user_id = p_uid
  );
$$;
REVOKE ALL ON FUNCTION public.is_meeting_participant(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_meeting_participant(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS meetings_read ON public.job_meetings;
CREATE POLICY meetings_read ON public.job_meetings FOR SELECT USING (
  organizer_id = auth.uid()
  OR public.nx_is_admin()
  OR public.is_meeting_participant(id, auth.uid())
);

DROP POLICY IF EXISTS meeting_participants_read ON public.job_meeting_participants;
CREATE POLICY meeting_participants_read ON public.job_meeting_participants FOR SELECT USING (
  user_id = auth.uid()
  OR public.nx_is_admin()
  OR public.is_meeting_participant(meeting_id, auth.uid())
);

-- ── (b) Supplier marketplace ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_has_quote_on_rfq(p_rfq uuid, p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.supplier_quotes
     WHERE rfq_id = p_rfq AND supplier_id = p_uid
  );
$$;
REVOKE ALL ON FUNCTION public.supplier_has_quote_on_rfq(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.supplier_has_quote_on_rfq(uuid,uuid) TO authenticated;

-- rewrite the browse policy: the supplier_quotes check now goes through the
-- helper (RLS-bypassing) → no re-entry into supplier_quotes' policy → no loop.
DROP POLICY IF EXISTS rfq_supplier_browse ON public.supplier_rfqs;
CREATE POLICY rfq_supplier_browse ON public.supplier_rfqs FOR SELECT USING (
  (status = 'open' AND EXISTS (
     SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = auth.uid() AND sp.is_active))
  OR public.supplier_has_quote_on_rfq(id, auth.uid())
);

-- ── SELF-TEST (existence; recursion is exercised at runtime as a normal user) ─
DO $$
BEGIN
  IF to_regprocedure('public.is_meeting_participant(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST is_meeting_participant missing'; END IF;
  IF to_regprocedure('public.supplier_has_quote_on_rfq(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST supplier_has_quote_on_rfq missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_meeting_participants' AND policyname='meeting_participants_read') THEN RAISE EXCEPTION 'SELFTEST participants policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_rfqs' AND policyname='rfq_supplier_browse') THEN RAISE EXCEPTION 'SELFTEST browse policy missing'; END IF;
  RAISE NOTICE 'RLS recursion hardened: meetings + supplier_rfqs/quotes now use SECURITY DEFINER membership helpers (42P17 eliminated).';
END $$;

COMMIT;
