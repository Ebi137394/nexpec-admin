-- ════════════════════════════════════════════════════════════════════════════
--  20260801447000_consent_receipt_status_rls.sql
--
--  Closes the `consent_receipt_status` cross-user visibility defect.
--
--  Numbered 447000 deliberately: it belongs to the security wave opened by
--  20260801446000 and must land before Lane 5, while leaving Lane 5's
--  reassigned allocation at 20260801448000 untouched. (446000 was reassigned
--  from Lane 5 to security by 20260801446000; 448000 is Lane 5. Verified free.)
--
--  ── TWO COMPOUNDING DEFECTS ────────────────────────────────────────────────
--
--  (1) THE VIEW BYPASSES RLS.  baseline:22244
--        CREATE OR REPLACE VIEW public.consent_receipt_status AS
--          SELECT id AS consent_id, user_id, document_id, consent_status,
--                 signed_at, receipt_sent_at, receipt_email_id, receipt_filename, ...
--            FROM public.legal_consents lc;
--      No WHERE clause, `OWNER TO postgres`, and no `security_invoker`. A view
--      without security_invoker executes with the *owner's* rights, so row
--      level security on legal_consents does not apply to reads through it.
--
--      Worse, 20260801442000 placed this view on its keep-SELECT list
--      (442000:378) — the list that revokes only INSERT/UPDATE/DELETE/TRUNCATE/
--      REFERENCES/TRIGGER from anon while deliberately preserving SELECT for
--      views with a legitimate public read. This view has no such legitimate
--      public read: it exposes user_id, document_id, consent status, signature
--      timestamps and receipt_email_id for EVERY user. That is an
--      unauthenticated PII disclosure, not a public directory.
--
--  (2) THE BASE TABLE'S RLS IS ALREADY DEFEATED.  Fixing the view alone is not
--      enough. legal_consents has RLS enabled (baseline:30628) and a correct
--      policy (baseline:29681)
--        "Users can view their own consents" FOR SELECT USING (auth.uid()::text = user_id)
--      but ALSO carries (baseline:29501)
--        "Enable read for users based on user_id" FOR SELECT USING (true)
--      whose name describes a per-user restriction it does not implement.
--      PostgreSQL ORs permissive policies together, so `USING (true)` subsumes
--      the correct policy and every authenticated caller can read every row of
--      legal_consents directly — view or no view.
--
--      The INSERT side has the same shape: "Enable insert for all users"
--      WITH CHECK (true) alongside "Users can insert their own consents"
--      WITH CHECK (auth.uid()::text = user_id). The permissive one lets any
--      caller write a consent record attributed to any user_id — consent
--      forgery. Both blanket policies are dropped here.
--
--  ── WHY DROPPING THE BLANKET POLICIES IS SAFE ──────────────────────────────
--  The only application reader is src/screens/ConsentHistoryScreen.tsx, which
--  shows the signed-in user their OWN consent history — exactly what the
--  self-scoped policy allows. There is no admin SELECT policy on this table
--  today, so Admin reads already go through service_role, which bypasses RLS
--  and is unaffected. An explicit admin policy is added anyway so Admin does
--  not silently depend on service_role for a user-facing surface.
--
--  Additive and forward-only. No consent history is deleted.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Make the view honour the caller's RLS ───────────────────────────────
--  Precedent in-repo: audit_events_public (20260801154000:73) and
--  job_applications (baseline:23464) both use security_invoker = true.
ALTER VIEW public.consent_receipt_status SET (security_invoker = true);

-- ─── 2. Remove anon read; this view is not a public directory ───────────────
REVOKE ALL ON TABLE public.consent_receipt_status FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.consent_receipt_status TO authenticated, service_role;

-- ─── 3. Drop the blanket policies that defeat RLS on the base table ─────────
DROP POLICY IF EXISTS "Enable read for users based on user_id" ON public.legal_consents;
DROP POLICY IF EXISTS "Enable insert for all users"            ON public.legal_consents;

-- ─── 4. Keep Admin explicit rather than implicitly service-role-only ────────
DO $admin$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'nx_is_admin')
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                      WHERE schemaname = 'public' AND tablename = 'legal_consents'
                        AND policyname = 'Admins can view all consents')
  THEN
    EXECUTE $p$
      CREATE POLICY "Admins can view all consents" ON public.legal_consents
        FOR SELECT USING (public.nx_is_admin())
    $p$;
  END IF;
END
$admin$;

COMMENT ON VIEW public.consent_receipt_status IS
  'Consent receipt status for the CALLING user. security_invoker = true, so RLS on '
  'legal_consents applies (20260801447000). Previously definer-rights with anon SELECT '
  'retained by 20260801442000''s keep-SELECT list, which exposed every user''s consent '
  'records — user_id, document_id, status, signature timestamps, receipt_email_id — '
  'unauthenticated. Not a public directory; do not re-grant anon.';

-- ─── 5. Selftest ────────────────────────────────────────────────────────────
--  STATIC/CATALOGUE properties only. Proves reachability and policy shape, not
--  that a live query returns the right rows; that needs the behavioural suite.
DO $selftest$
DECLARE v_n int; v_bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'consent_receipt_status'
       AND c.reloptions::text ILIKE '%security_invoker=true%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: consent_receipt_status is not security_invoker — it still bypasses RLS';
  END IF;

  IF has_table_privilege('anon', 'public.consent_receipt_status', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can still read consent_receipt_status — unauthenticated PII disclosure';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.consent_receipt_status', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated lost SELECT — ConsentHistoryScreen would break';
  END IF;

  -- no permissive USING(true) / WITH CHECK(true) SELECT-or-INSERT policy may remain
  SELECT count(*), string_agg(policyname, ', ')
    INTO v_n, v_bad
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'legal_consents'
     AND permissive = 'PERMISSIVE'
     AND cmd IN ('SELECT', 'INSERT')
     AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true');
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % blanket true policy(ies) still on legal_consents (%) — RLS remains defeated', v_n, v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='legal_consents'
                    AND cmd='SELECT' AND qual ILIKE '%auth.uid()%') THEN
    RAISE EXCEPTION 'SELFTEST: the self-scoped SELECT policy on legal_consents is missing';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
