-- ════════════════════════════════════════════════════════════════════════════
--  20260801434000_credential_verification_authority.sql
--
--  Lane D — credential verification normalization.
--
--  ── WHAT I FOUND (mapped, not assumed) ─────────────────────────────────────
--  Four tables carry something called a "certification". They are NOT four
--  copies of one concept; they are three concepts and one corpse:
--
--   1. public.certifications          CANONICAL per-credential document.
--        Readers, all filtering on `status`:
--          20260801358000 / 20260801360000  matching  (status='verified'
--                                            AND unexpired)
--          20260801362000  nx_certification_expiry_scan (status='verified')
--                          nx_my_certification_status  (returns status)
--          certification_stats view        (FILTER status='verified'|'pending')
--          app/(agency)/jobs/[id].tsx, app/(client)/jobs/[id]/applicants.tsx,
--          app/agency-job-details.tsx      (.eq('status','verified'))
--          app/(tabs)/profile.tsx          (.in('status',['verified','active']))
--        Writers: app/profile/certifications.tsx and
--          app/(inspector)/wallet/cert-wallet.tsx — INSERT only, and neither
--          sets status / is_verified / verified, so rows are born consistent.
--        UPDATE writers: NONE. Zero in the entire repository.
--
--   2. public.inspector_credentials   CCI TIER ADMISSION — a different fact.
--        Not a certificate; a platform tier decision with its own enum
--        (cci_credential_status) and its own CHECK
--        (credential_decision_consistency). Read by apps/web compliance,
--        users, documents, equipment; written by the CCI admin decision path
--        (baseline:2733-2790) and the admin screens. Untouched here — it is
--        already the best-shaped of the four and it answers a question
--        `certifications` does not.
--
--   3. public.inspector_certifications  THIN, and drifted from its callers.
--        See "DELIBERATELY NOT DONE".
--
--   4. public.contractor_certifications NEAR-DEAD legacy.
--        See "DELIBERATELY NOT DONE".
--
--  ── THE LIVE DEFECT ────────────────────────────────────────────────────────
--  public.certifications carries THREE carriers of one fact:
--        status text CHECK (pending|verified|rejected)   ← every reader
--        is_verified boolean DEFAULT false               ← zero readers
--        verified    boolean DEFAULT false               ← zero readers
--  Nothing tied them together, so a write that touched one and not the others
--  produced a row that was simultaneously verified and not verified. Two
--  indexes (idx_certifications_verified, idx_certifications_user_verified)
--  exist over the dead mirrors, which is exactly how such a column survives
--  long enough to be believed.
--
--  ── THE SECOND DEFECT, WHICH IS THE MORE SERIOUS ONE ───────────────────────
--  The inspector could verify their own credential. RLS on this table is
--  `certifications_owner_all` (20260801224000): FOR ALL TO authenticated,
--  USING/WITH CHECK (user_id = auth.uid() OR nx_is_admin()) — an owner may
--  write every column of their own row, including status, verified_at and
--  verified_by. There is no column-level guard: the baseline's
--  protect_certification_verification() trigger is attached to
--  contractor_certifications (baseline:27794), NOT to this table, and matching
--  (25 points) and broadcast targeting both trust status='verified'.
--  So a self-verified credential scored real jobs. That is the gap this
--  migration closes.
--
--  ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--  A. Names ONE authority in the catalogue: `certifications.status`.
--     is_verified and verified are DEPRECATED to derived mirrors by COMMENT.
--     Neither column is dropped — this repository has a documented history of
--     SQL applied by hand outside supabase/migrations, so unmigrated rows may
--     exist, and both columns are indexed.
--  B. Makes contradiction impossible going forward, two ways:
--       • a BEFORE INSERT OR UPDATE trigger that DERIVES both mirrors from
--         status on every write — so no existing writer has to change and none
--         can drift; and
--       • a declarative CHECK, added NOT VALID, as the backstop that states
--         the invariant in the catalogue.
--  C. Moves verification authority to Admin, in the database:
--     an authenticated non-admin may not set status away from 'pending' on
--     insert, may not change status at all, and may not write verified_at or
--     verified_by. Admin (nx_is_admin) and server-side contexts still can.
--
--  ── WHY THE CHECK IS `NOT VALID` ───────────────────────────────────────────
--  Deliberate, and it is the right tool. Production may already hold rows
--  where the mirrors contradict status — nobody ever enforced agreement, and
--  a hand-run script could have set either. VALIDATE would either fail the
--  migration or force me to rewrite those rows first. Rewriting them is a
--  destructive backfill of history: flipping `verified` from true to false on
--  a row whose status is 'pending' silently asserts that a past decision never
--  happened. So: NOT VALID binds every NEW and every UPDATED row (Postgres
--  enforces a NOT VALID CHECK on all subsequent writes), leaves history
--  untouched, and any drifting row self-heals the first time it is written,
--  because the trigger normalizes before the CHECK is evaluated.
--
--  RECONCILIATION PATH for the rows already there — report first:
--        SELECT * FROM public.nx_certification_flag_drift();
--  and, only after an operator has read that report and decided, the repair,
--  which is deliberately NOT run by this migration:
--        UPDATE public.certifications
--           SET is_verified = (status = 'verified'),
--               verified    = (status = 'verified')
--         WHERE COALESCE(is_verified,false) <> (status = 'verified')
--            OR COALESCE(verified,false)    <> (status = 'verified');
--        ALTER TABLE public.certifications
--          VALIDATE CONSTRAINT certifications_verification_flags_consistent;
--
--  ── DELIBERATELY NOT DONE ──────────────────────────────────────────────────
--   • NO Credentials v2. No table merged, renamed or dropped. The four tables
--     still exist and every reader still reads what it read before.
--   • NO expiry or reminder automation. 20260801362000 already runs exactly
--     one reminder ladder, on this table, and expiry there is DERIVED from
--     expiry_date rather than stamped. Adding a second is the failure mode.
--     This migration mutates no expiry state and schedules no job.
--   • NO change to inspector_credentials. Its enum and its
--     credential_decision_consistency CHECK are already correct, and CCI tier
--     admission is not the same fact as "this certificate is genuine".
--   • NO fix to inspector_certifications, and it needs one. The baseline table
--     (baseline:23178) has certification_type / certification_number /
--     issued_date / expiry_date / document_url / is_verified, but
--     apps/web/src/lib/data/inspectorCertifications.ts and
--     apps/web/src/lib/actions/inspectorCertifications.ts read and insert
--     issuing_body / certificate_number / issued_at / expires_at /
--     certificate_path / notes / updated_at — columns no migration creates.
--     The web compliance certification panel therefore cannot be writing to
--     the live schema. That is a schema-drift repair against a different
--     table with its own UI, not a verification-authority change, and folding
--     it in here would make this migration unreviewable.
--   • NO fix to protect_certification_verification(). It is a real bug —
--     it is a BEFORE UPDATE trigger on contractor_certifications reading
--     OLD.is_verified / NEW.is_verified, and contractor_certifications has no
--     is_verified column (baseline:22264), so every UPDATE that is not
--     carrying a service_role JWT raises `record "old" has no field
--     "is_verified"`. That includes expire_old_certifications() when run from
--     cron, which 20260801362000 repaired on the assumption it would then
--     work. Fixing it changes contractor_certifications write behaviour from
--     "always errors" to "sometimes succeeds", which is a live behaviour
--     change on a table this lane was told not to reshape. Reported, not
--     touched.
--   • NO business or payment effect of any kind. Credential state does not
--     reach wallets, transactions, payout_status, payout_paid_at or dispatch.
--     Asserted below.
--   • NO RLS change and no new grant. certifications_owner_all is left exactly
--     as 20260801224000 wrote it; the authority guard is a trigger, which
--     constrains writes without weakening any policy.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  A. Name the authority in the catalogue
-- ════════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE public.certifications IS
  'CANONICAL per-credential document table for inspectors (the cert wallet). AUTHORITATIVE VERIFICATION TRUTH = certifications.status (pending | verified | rejected). Every reader uses it: the matching engine (20260801358000/20260801360000, status=''verified'' AND unexpired), the expiry reminder scan and nx_my_certification_status (20260801362000), the certification_stats view, and the mobile applicant/agency/profile screens. Verification authority is ADMIN-ONLY and enforced by trg_certifications_verification_authority — an inspector may add and remove their own credentials but may not verify them. EXPIRY IS DERIVED from expiry_date, never stamped (20260801362000): status has no ''expired'' value and must not gain one. Scope boundary: this table answers "is this certificate genuine"; public.inspector_credentials answers the different question "what CCI tier is this inspector admitted to" and remains authoritative for that.';

COMMENT ON COLUMN public.certifications.status IS
  'AUTHORITATIVE verification state: pending | verified | rejected. The single source of truth for whether this credential counts. Admin-only to change (trg_certifications_verification_authority). Do not add ''expired'' — expiry is derived from expiry_date so a lapsed credential stops counting the moment it lapses, with no window where two carriers disagree.';

COMMENT ON COLUMN public.certifications.is_verified IS
  'DEPRECATED — DERIVED MIRROR, NOT AUTHORITATIVE. Kept only for backward compatibility and because idx_certifications_user_verified indexes it. As of 20260801434000 it is maintained automatically as (status = ''verified'') by trg_certifications_verification_authority and is constrained by certifications_verification_flags_consistent. It has no reader anywhere in this repository. Read status. Do not write this column; anything written here is overwritten from status on the same statement.';

COMMENT ON COLUMN public.certifications.verified IS
  'DEPRECATED — DERIVED MIRROR, NOT AUTHORITATIVE. Second duplicate of the same fact as is_verified; kept only for backward compatibility and because idx_certifications_verified indexes it. As of 20260801434000 it is maintained automatically as (status = ''verified'') by trg_certifications_verification_authority and is constrained by certifications_verification_flags_consistent. It has no reader anywhere in this repository. Read status. Do not write this column; anything written here is overwritten from status on the same statement.';

COMMENT ON COLUMN public.certifications.verified_at IS
  'When status last entered ''verified''. Stamped by trg_certifications_verification_authority when an Admin verifies, if the caller did not supply it. Not cleared when a credential is later rejected — it records that a verification decision was once made, which is evidence. Write-protected from non-admins.';

COMMENT ON COLUMN public.certifications.verified_by IS
  'The Admin who verified. Stamped from auth.uid() by trg_certifications_verification_authority when status enters ''verified'', if the caller did not supply it. Write-protected from non-admins — an inspector cannot name themselves here.';

-- Scope comments on the other three, so the next reader does not have to
-- re-derive the map. No structural change to any of them.
COMMENT ON TABLE public.inspector_credentials IS
  'AUTHORITATIVE for CCI TIER ADMISSION — which tier an inspector is admitted to, with the cci_credential_status enum and the credential_decision_consistency CHECK guaranteeing a decided status always carries decided_at. This is NOT the per-certificate verification table: "is this certificate genuine" is answered by public.certifications.status. Both are authoritative, for different questions; neither supersedes the other.';

COMMENT ON TABLE public.inspector_certifications IS
  'NOT AUTHORITATIVE for verification — read public.certifications.status. Thin table; its is_verified column has no guard and no reader. NOTE (20260801434000): the apps/web compliance panel reads and writes columns that do not exist here (issuing_body, certificate_number, issued_at, expires_at, certificate_path, notes, updated_at), so that panel cannot be reaching the live schema. Deliberately left alone by this lane: that is a schema-drift repair, not a verification-authority change.';

COMMENT ON TABLE public.contractor_certifications IS
  'LEGACY, near-dead — one application reference (src/roles/admin/services/adminService.ts) plus supabase/functions/verify-contractor. NOT AUTHORITATIVE for verification; read public.certifications.status. WARNING (20260801434000): its BEFORE UPDATE trigger trigger_protect_cert_verification runs protect_certification_verification(), which reads OLD.is_verified / NEW.is_verified — columns this table does not have — so any UPDATE not carrying a service_role JWT raises `record "old" has no field "is_verified"`. That is a pre-existing defect, reported and deliberately NOT changed by this lane because repairing it turns a table that always errors on update into one that sometimes succeeds.';

-- ════════════════════════════════════════════════════════════════════════════
--  B. The authority guard + mirror derivation
--
--  SECURITY INVOKER on purpose: this function needs no elevated rights (the
--  only privileged read it performs is nx_is_admin(), which is already
--  SECURITY DEFINER), so it adds no new definer surface. search_path is
--  pinned regardless.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_certifications_verification_authority()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
DECLARE
  v_actor      uuid := auth.uid();
  v_jwt_role   text;
  v_privileged boolean;
BEGIN
  -- Who is writing? An end-user session always carries auth.uid(). A
  -- migration, a cron job, or a service_role key does not. `anon` also has no
  -- auth.uid(), so it is excluded explicitly rather than by omission — even
  -- though 20260801222000 already revoked anon on this table.
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_jwt_role := COALESCE(
    v_jwt_role,
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    ''
  );

  v_privileged := public.nx_is_admin() OR (v_actor IS NULL AND v_jwt_role <> 'anon');

  IF TG_OP = 'INSERT' THEN
    -- An inspector files a credential; they do not file it pre-verified.
    IF NOT v_privileged AND COALESCE(NEW.status, 'pending') <> 'pending' THEN
      RAISE EXCEPTION
        'FORBIDDEN: a credential can only be filed as pending — verification is an Admin decision (certifications.status)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT v_privileged AND (NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL) THEN
      RAISE EXCEPTION
        'FORBIDDEN: verified_at / verified_by are stamped by the verifying Admin, not by the credential owner'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT v_privileged THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION
          'FORBIDDEN: only an administrator may change certification verification status (% -> %)',
          OLD.status, NEW.status
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
         OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
        RAISE EXCEPTION
          'FORBIDDEN: only an administrator may write certification verification attribution (verified_at / verified_by)'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    -- Attribution, stamped on entry to 'verified' only when the caller did not
    -- supply it. Never cleared on exit: a rejection does not erase the fact
    -- that a verification decision was once taken.
    IF NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified' THEN
      NEW.verified_at := COALESCE(NEW.verified_at, now());
      NEW.verified_by := COALESCE(NEW.verified_by, v_actor);
    END IF;
  END IF;

  -- The whole point: the mirrors are DERIVED, on every write, from the one
  -- authority. This is what makes the two legacy booleans incapable of
  -- disagreeing with status, and it is why no existing writer has to change.
  NEW.is_verified := (NEW.status = 'verified');
  NEW.verified    := (NEW.status = 'verified');

  RETURN NEW;
END
$fn$;

ALTER FUNCTION public.nx_certifications_verification_authority() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_certifications_verification_authority() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.nx_certifications_verification_authority() IS
  'Verification authority + mirror derivation for public.certifications. (1) An authenticated non-admin may not file a credential as anything but pending, may not change status, and may not write verified_at / verified_by — an inspector cannot self-verify, which matters because matching awards 25 points for status=''verified''. Admin (nx_is_admin) and server-side contexts (no auth.uid(), not anon) may. (2) is_verified and verified are DERIVED from status on every write, so the two deprecated mirrors can never disagree with the authority. Touches no money, no payout and no dispatch surface.';

DROP TRIGGER IF EXISTS trg_certifications_verification_authority ON public.certifications;
CREATE TRIGGER trg_certifications_verification_authority
  BEFORE INSERT OR UPDATE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.nx_certifications_verification_authority();

-- ════════════════════════════════════════════════════════════════════════════
--  C. The declarative backstop — NOT VALID by design (see header)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.certifications
  DROP CONSTRAINT IF EXISTS certifications_verification_flags_consistent;

ALTER TABLE public.certifications
  ADD CONSTRAINT certifications_verification_flags_consistent
  CHECK (
        COALESCE(is_verified, false) = (status = 'verified')
    AND COALESCE(verified,    false) = (status = 'verified')
  ) NOT VALID;

COMMENT ON CONSTRAINT certifications_verification_flags_consistent ON public.certifications IS
  'One fact, one truth: the deprecated is_verified/verified mirrors must equal (status = ''verified''). NOT VALID deliberately — pre-20260801434000 rows may already contradict, and rewriting them would be a destructive backfill of history. Postgres still enforces this on every INSERT and UPDATE, and trg_certifications_verification_authority normalizes before it is evaluated, so drifting rows self-heal on their next write. To finish the job: SELECT * FROM public.nx_certification_flag_drift(); then, deliberately, the repair UPDATE and VALIDATE CONSTRAINT documented in 20260801434000.';

-- ════════════════════════════════════════════════════════════════════════════
--  D. Reconciliation — REPORT ONLY. This function writes nothing.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_certification_flag_drift()
RETURNS TABLE (
  certification_id uuid,
  user_id          uuid,
  name             text,
  status           text,
  is_verified      boolean,
  verified         boolean,
  should_be        boolean,
  created_at       timestamptz
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
  SELECT c.id, c.user_id, c.name, c.status, c.is_verified, c.verified,
         (c.status = 'verified'), c.created_at
    FROM public.certifications c
   WHERE COALESCE(c.is_verified, false) <> (c.status = 'verified')
      OR COALESCE(c.verified,    false) <> (c.status = 'verified')
   ORDER BY c.created_at;
$fn$;

ALTER FUNCTION public.nx_certification_flag_drift() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_certification_flag_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_certification_flag_drift() TO service_role;

COMMENT ON FUNCTION public.nx_certification_flag_drift() IS
  'READ-ONLY reconciliation report: pre-20260801434000 certifications rows whose deprecated is_verified/verified mirrors contradict the authoritative status, with should_be = the value status implies. Writes nothing and repairs nothing — the repair is a deliberate operator action, documented in 20260801434000, because silently flipping a stored boolean rewrites the record of a past decision. Operator-only (service_role); it reads across all users, so it must never be reachable by authenticated or anon.';

-- ════════════════════════════════════════════════════════════════════════════
--  E. Self-test
-- ════════════════════════════════════════════════════════════════════════════
DO $selftest$
DECLARE
  v_guard  text := pg_get_functiondef('public.nx_certifications_verification_authority()'::regprocedure);
  v_drift  text := pg_get_functiondef('public.nx_certification_flag_drift()'::regprocedure);
  v_convalidated boolean;
BEGIN
  -- ── Nothing was dropped. All four tables, and both deprecated mirrors,
  --    must still exist: this lane deprecates, it does not delete.
  IF to_regclass('public.certifications')            IS NULL
     OR to_regclass('public.inspector_credentials')     IS NULL
     OR to_regclass('public.inspector_certifications')  IS NULL
     OR to_regclass('public.contractor_certifications') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: a credential table is missing — this migration merges and drops nothing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='certifications'
                    AND column_name IN ('is_verified','verified')
                  HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'SELFTEST: a deprecated mirror column was dropped — deprecate by constraint and COMMENT, never by DROP';
  END IF;

  -- ── The invariant exists, and is NOT VALID for the stated reason.
  SELECT convalidated INTO v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.certifications'::regclass
     AND conname  = 'certifications_verification_flags_consistent';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SELFTEST: certifications_verification_flags_consistent is missing — nothing binds is_verified/verified to status';
  END IF;
  IF v_convalidated THEN
    RAISE EXCEPTION 'SELFTEST: the flags constraint was validated — validating it here would either fail on pre-existing contradictory rows or require a destructive backfill; it must be added NOT VALID and validated only after nx_certification_flag_drift() has been read';
  END IF;

  -- ── The guard is attached, and to the right table.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.certifications'::regclass
       AND tgname  = 'trg_certifications_verification_authority'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST: trg_certifications_verification_authority is not attached to public.certifications — an inspector could still self-verify';
  END IF;

  -- ── Authority: the guard must actually consult nx_is_admin and must derive
  --    both mirrors. A guard that forgot either is worse than no guard,
  --    because the COMMENTs now promise both.
  IF v_guard !~ 'nx_is_admin' THEN
    RAISE EXCEPTION 'SELFTEST: the verification guard does not consult nx_is_admin — verification authority is not Admin-held';
  END IF;
  IF v_guard !~ 'NEW\.is_verified\s*:=' OR v_guard !~ 'NEW\.verified\s*:=' THEN
    RAISE EXCEPTION 'SELFTEST: the guard does not derive both deprecated mirrors from status — they can still diverge';
  END IF;

  -- ── search_path is pinned on both functions.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('nx_certifications_verification_authority','nx_certification_flag_drift')
       AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '^search_path='
       AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '\mpublic\M'
       AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '\mpg_temp\M'
     GROUP BY 1 HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a function added here does not pin search_path to public, pg_temp';
  END IF;

  -- ── No new reach for anon/PUBLIC, and the cross-user drift report is
  --    operator-only.
  IF has_function_privilege('anon',   'public.nx_certification_flag_drift()', 'EXECUTE')
     OR has_function_privilege('authenticated','public.nx_certification_flag_drift()','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: the cross-user drift report is reachable by an end user';
  END IF;
  IF has_table_privilege('anon', 'public.certifications', 'SELECT')
     OR has_table_privilege('anon', 'public.certifications', 'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: anon has reach on public.certifications — RLS posture regressed';
  END IF;

  -- ── RLS posture preserved exactly as 20260801224000 left it.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.certifications'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is not enabled on public.certifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='certifications'
                    AND policyname='certifications_owner_all') THEN
    RAISE EXCEPTION 'SELFTEST: certifications_owner_all was removed — this lane must not change RLS';
  END IF;

  -- ── Nothing here reads or writes money, payout or dispatch.
  IF v_guard ~* '\m(payout|payout_status|payout_paid_at|wallet|wallets|escrow|transactions|client_price_cents|inspector_payout_cents|job_inspectors|admin_dispatch_job)\M'
     OR v_drift ~* '\m(payout|payout_status|payout_paid_at|wallet|wallets|escrow|transactions|client_price_cents|inspector_payout_cents|job_inspectors|admin_dispatch_job)\M' THEN
    RAISE EXCEPTION 'SELFTEST: credential state reaches a money or dispatch surface — it must have no business effect';
  END IF;

  -- ── No expiry automation was added by this lane, and the one that exists
  --    is untouched. Four reminder systems on four tables is the failure mode.
  IF v_guard ~* '\m(expiry_date|expires_at|cron|certification_expiry_reminders|notify_safe)\M' THEN
    RAISE EXCEPTION 'SELFTEST: the verification guard touches expiry — expiry stays derived and stays in 20260801362000';
  END IF;
  IF to_regprocedure('public.nx_certification_expiry_scan(integer[])') IS NULL
     OR to_regprocedure('public.nx_my_certification_status()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the existing expiry system was disturbed — it must be left exactly as 20260801362000 built it';
  END IF;

  -- ── The authority claim must stay true: every canonical reader reads
  --    status, which is why status is the one named authoritative. If a
  --    reader ever switches to the deprecated mirrors, the COMMENTs above
  --    become a lie and this must fail loudly.
  IF pg_get_functiondef('public.nx_certification_expiry_scan(integer[])'::regprocedure) !~* 'status\s*=\s*''verified''' THEN
    RAISE EXCEPTION 'SELFTEST: nx_certification_expiry_scan no longer gates on certifications.status';
  END IF;
  IF to_regprocedure('public.nx_inspector_job_match_core(uuid,uuid)') IS NOT NULL
     AND pg_get_functiondef('public.nx_inspector_job_match_core(uuid,uuid)'::regprocedure) !~* 'status\s*=\s*''verified''' THEN
    RAISE EXCEPTION 'SELFTEST: the matching engine no longer gates on certifications.status';
  END IF;

  -- ── inspector_credentials is untouched: its own CHECK must survive.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.inspector_credentials'::regclass
                    AND conname  = 'credential_decision_consistency') THEN
    RAISE EXCEPTION 'SELFTEST: inspector_credentials.credential_decision_consistency is gone — this lane must not reshape the CCI system';
  END IF;

  RAISE NOTICE 'credential verification authority: certifications.status is authoritative; is_verified/verified deprecated to derived mirrors; self-verification refused; no expiry, money or RLS change.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
