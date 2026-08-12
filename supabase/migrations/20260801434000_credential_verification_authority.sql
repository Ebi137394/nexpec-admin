-- ════════════════════════════════════════════════════════════════════════════
--  20260801434000_credential_verification_authority.sql
--
--  Lane D — credential verification authority.
--
--  ── THE AUTHORITY DECISION ─────────────────────────────────────────────────
--  AUTHORITATIVE VERIFICATION TRUTH = public.certifications.status.
--
--  Evidence, re-derived at this HEAD rather than inherited:
--
--   (a) It is the only carrier the schema constrains. baseline:21846/21860 —
--       status text NOT NULL DEFAULT 'pending', with certifications_status_check
--       CHECK (status IN ('pending','verified','rejected')). is_verified and
--       verified are nullable booleans with no constraint at all.
--
--   (b) Every reader gates on status. All of them:
--         nx_inspector_job_match_core  20260801360000:112  (25 match points)
--             c.status='verified' AND (expiry_date IS NULL OR > current_date)
--         nx_certification_expiry_scan 20260801362000:145  c.status='verified'
--         certification_stats view     baseline:21913      FILTER status=...
--         app/(agency)/jobs/[id].tsx:1282        .eq('status','verified')
--         app/(client)/jobs/[id]/applicants.tsx:1273 .eq('status','verified')
--         app/agency-job-details.tsx:29          .eq('status','verified')
--         app/(tabs)/profile.tsx:247   .in('status',['verified','active'])
--
--   (c) is_verified and verified have ZERO readers — no SQL, no TypeScript.
--       Every is_verified hit in app code belongs to a DIFFERENT table:
--       profiles.is_verified (inspector-directory, explore, profile header) and
--       contractor_certifications.is_verified (adminService). Not this table.
--
--   (d) Writers cannot currently create the contradiction on purpose. There is
--       no SQL writer at all — zero INSERT/UPDATE against public.certifications
--       in supabase/migrations or supabase/functions. The two app writers,
--       app/profile/certifications.tsx:139 and
--       app/(inspector)/wallet/cert-wallet.tsx:150, are INSERT-only and supply
--       neither status nor either mirror, so rows are born consistent and drift
--       can only have come from hand-run SQL. (Fixture UPDATEs exist in
--       supabase/tests/certification_expiry_test.sql; they move expiry only.)
--
--  ── WHERE THE CONTRACT IS WRONG (reported, not redesigned) ─────────────────
--  The P1 contract, Lane D, says of is_verified/verified: "nothing guarantees
--  they agree, and Admin verification authority reads one of them."
--
--  The first clause is correct. THE SECOND IS FALSE AT THIS HEAD. No admin
--  surface reads either column on this table — see (c). The only admin
--  verification UI in the repository,
--  app/(inspector)/legal/verification-screen.tsx → lib/adminService.ts →
--  src/roles/admin/services/adminService.ts:99,152, operates on
--  contractor_certifications, and it selects `certificate_name` and
--  `is_verified` — NEITHER COLUMN EXISTS on that table (baseline:22264 has
--  id, contractor_id, title, issued_by, expiry_date, cert_url, status,
--  created_at). getPendingVerifications() therefore returns [] on a PostgREST
--  42703, and verifyCertificate() writes a column that is not there.
--
--  This makes the fix SAFER than the contract assumed, not more dangerous:
--  naming status authoritative and demoting the two booleans breaks no reader,
--  because there is no reader to break.
--
--  ── THE DEFECT THAT MATTERS MORE THAN THE ONE THE CONTRACT NAMES ───────────
--  public.certifications has NO verification authority whatsoever. An inspector
--  can verify their own credential.
--
--    • 20260801224000:41 — certifications_owner_all, FOR ALL TO authenticated,
--      USING/WITH CHECK (user_id = auth.uid() OR nx_is_admin()). An owner may
--      write EVERY column of their own row, status and verified_by included.
--    • The baseline leaves nine further policies on this table. Two are FOR ALL
--      with only a USING clause (baseline:29557 "Manage own certs",
--      baseline:29709 "Users manage own certs"); for a FOR ALL policy Postgres
--      reuses USING as the WITH CHECK, so both permit any status.
--    • baseline:29647 "Users can update their own certifications" DOES carry
--      WITH CHECK (... AND status = 'pending') — but permissive policies are
--      OR'd, so the three unconstrained policies defeat it entirely.
--    • protect_certification_verification() is attached to
--      contractor_certifications (baseline:27794), NOT to this table.
--
--  Net: a self-verified credential scores 25 points in matching and passes the
--  client and agency applicant screens. This CANNOT be closed by RLS without
--  dropping baseline policies, which is a live behaviour change outside this
--  lane, so a BEFORE trigger is the correct instrument: it constrains writes
--  without weakening or removing any policy.
--
--  ── THE INVARIANT THIS MIGRATION ESTABLISHES ───────────────────────────────
--  For every row of public.certifications, from this migration forward:
--
--      COALESCE(is_verified,false) = COALESCE(verified,false)
--                                  = (status = 'verified')
--
--  and status may leave 'pending' only in a privileged context (an
--  administrator, or a server-side context that is not an end-user session),
--  and NEVER at the hand of the credential's own owner.
--
--  ── HOW ─────────────────────────────────────────────────────────────────────
--  A. Name the authority in the catalogue. is_verified and verified become
--     DEPRECATED derived mirrors by COMMENT. Neither is dropped: both are
--     indexed (baseline:26458 idx_certifications_user_verified, 26462
--     idx_certifications_verified) and this repository has a history of SQL
--     applied by hand, so unmigrated rows may exist.
--  B. Make contradiction impossible for NEW writes, two ways:
--       • a BEFORE INSERT OR UPDATE trigger that DERIVES both mirrors from
--         status on every write — no existing writer has to change, and none
--         can drift; and
--       • a declarative CHECK, added NOT VALID, stating the invariant in the
--         catalogue as the backstop.
--  C. Move verification authority to Admin, in the database.
--
--  ── WHY THE CHECK IS `NOT VALID` ───────────────────────────────────────────
--  Deliberate, and required by the lane. Production may already hold rows whose
--  mirrors contradict status — nobody ever enforced agreement. VALIDATE would
--  either fail the migration or force a backfill first, and rewriting those
--  rows is destructive to history: flipping `verified` from true to false on a
--  row whose status is 'pending' silently asserts a past decision never
--  happened. NOT VALID binds every NEW and every UPDATED row — Postgres
--  enforces a NOT VALID CHECK on all subsequent writes — leaves history
--  untouched, and lets a drifting row self-heal the first time it is written,
--  because the trigger normalizes before the CHECK is evaluated.
--
--  RECONCILIATION PATH for rows already there — report first:
--        SELECT * FROM public.nx_certification_flag_drift();
--  and only after an operator has read that report and decided, the repair,
--  which this migration deliberately does NOT run:
--        UPDATE public.certifications
--           SET is_verified = (status = 'verified'),
--               verified    = (status = 'verified')
--         WHERE COALESCE(is_verified,false) <> (status = 'verified')
--            OR COALESCE(verified,false)    <> (status = 'verified');
--        ALTER TABLE public.certifications
--          VALIDATE CONSTRAINT certifications_verification_flags_consistent;
--
--  ── TRIGGER ORDER (checked, not assumed) ───────────────────────────────────
--  public.certifications already carries certifications_updated_at BEFORE
--  UPDATE (baseline:27406). Postgres fires same-timing row triggers in NAME
--  order, so certifications_updated_at runs first and
--  trg_certifications_verification_authority second. Both are BEFORE ... ROW,
--  so NEW chains correctly and the derivation is the last word. Do not rename
--  either trigger without re-checking this.
--
--  ── DELIBERATELY NOT DONE ──────────────────────────────────────────────────
--   • NO Credentials v2. No table merged, renamed or dropped. All four tables
--     still exist and every reader still reads what it read before.
--   • NO expiry or reminder automation, and no expiry state is mutated.
--     20260801362000 already runs exactly one reminder ladder on this table,
--     and expiry there is DERIVED, never stamped. A second ladder is the
--     failure mode this lane exists to avoid. Asserted below.
--   • NO change to inspector_credentials. Its cci_credential_status enum and
--     credential_decision_consistency CHECK are already correct, and CCI TIER
--     ADMISSION is a different fact from "this certificate is genuine".
--   • NO change to inspector_certifications, INCLUDING no COMMENT on it. That
--     table belongs to 20260801436000; this lane does not write to it at all.
--   • NO fix to protect_certification_verification(). It is a real bug — a
--     BEFORE UPDATE trigger on contractor_certifications reading
--     OLD.is_verified / NEW.is_verified when contractor_certifications has no
--     is_verified column (baseline:22264), so every UPDATE not carrying a
--     service_role JWT raises `record "old" has no field "is_verified"`.
--     Repairing it turns a table that always errors on update into one that
--     sometimes succeeds — a live behaviour change on a table this lane was
--     told not to reshape. Reported, not touched.
--   • NO RLS change and no new grant. certifications_owner_all is left exactly
--     as 20260801224000 wrote it.
--   • NO business or payment effect. Credential state reaches no money or
--     dispatch surface. Asserted below.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  A. Name the authority in the catalogue
-- ════════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE public.certifications IS
  'CANONICAL per-credential document table for inspectors (the cert wallet). AUTHORITATIVE VERIFICATION TRUTH = certifications.status (pending | verified | rejected). Every reader uses it: the matching engine (20260801358000/20260801360000, status=''verified'' AND unexpired), the expiry reminder scan and nx_my_certification_status (20260801362000), the certification_stats view, and the mobile applicant/agency/profile screens. Verification authority is ADMIN-ONLY and enforced by trg_certifications_verification_authority — an inspector may add and remove their own credentials but may not verify them, and NO actor may verify their own credential, an administrator included. EXPIRY IS DERIVED from expiry_date, never stamped (20260801362000): status has no ''expired'' value and must not gain one. Scope boundary: this table answers "is this certificate genuine"; public.inspector_credentials answers the different question "what CCI tier is this inspector admitted to" and remains authoritative for that.';

COMMENT ON COLUMN public.certifications.status IS
  'AUTHORITATIVE verification state: pending | verified | rejected. The single source of truth for whether this credential counts. NOT NULL DEFAULT ''pending'' with certifications_status_check — which is why the derived mirrors can never be NULL-ambiguous. Admin-only to change (trg_certifications_verification_authority). Do not add ''expired'' — expiry is derived from expiry_date so a lapsed credential stops counting the moment it lapses, with no window where two carriers disagree.';

COMMENT ON COLUMN public.certifications.is_verified IS
  'DEPRECATED — DERIVED MIRROR, NOT AUTHORITATIVE. Kept only for backward compatibility and because idx_certifications_user_verified indexes it. As of 20260801434000 it is maintained automatically as (status = ''verified'') by trg_certifications_verification_authority and is constrained by certifications_verification_flags_consistent. It has no reader anywhere in this repository — every is_verified reader in the app belongs to profiles or to contractor_certifications, not to this table. Read status. Do not write this column; anything written here is overwritten from status on the same statement.';

COMMENT ON COLUMN public.certifications.verified IS
  'DEPRECATED — DERIVED MIRROR, NOT AUTHORITATIVE. Second duplicate of the same fact as is_verified; kept only for backward compatibility and because idx_certifications_verified indexes it. As of 20260801434000 it is maintained automatically as (status = ''verified'') by trg_certifications_verification_authority and is constrained by certifications_verification_flags_consistent. It has no reader anywhere in this repository. Read status. Do not write this column; anything written here is overwritten from status on the same statement.';

COMMENT ON COLUMN public.certifications.verified_at IS
  'When status last entered ''verified''. Stamped by trg_certifications_verification_authority on INSERT and on UPDATE when the caller did not supply it. Not cleared when a credential is later rejected — it records that a verification decision was once made, which is evidence. Write-protected from non-admins.';

COMMENT ON COLUMN public.certifications.verified_by IS
  'The actor who verified. Stamped from auth.uid() by trg_certifications_verification_authority when status enters ''verified'', if the caller did not supply it. Write-protected from non-admins, and can never equal user_id: no actor may verify their own credential.';

-- Scope comment on the CCI table so the next reader does not re-derive the map.
-- No structural change. inspector_certifications and contractor_certifications
-- are deliberately NOT commented here — 20260801436000 owns the former, and the
-- latter is left entirely alone by this lane.
COMMENT ON TABLE public.inspector_credentials IS
  'AUTHORITATIVE for CCI TIER ADMISSION — which tier an inspector is admitted to, with the cci_credential_status enum and the credential_decision_consistency CHECK guaranteeing a decided status always carries decided_at. This is NOT the per-certificate verification table: "is this certificate genuine" is answered by public.certifications.status (see 20260801434000). Both are authoritative, for different questions; neither supersedes the other.';

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
  v_client     boolean;
  v_privileged boolean;
BEGIN
  -- Who is writing? An end-user session always carries auth.uid(). A migration,
  -- a scheduled job, or a service_role key does not.
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

  -- A client session is one that either carries an identified end user, or is
  -- running as one of the two roles PostgREST switches into for untrusted
  -- callers. Testing current_user as well as the claim closes the case of a
  -- caller that presents NO claims at all: claims alone would leave v_jwt_role
  -- empty, and an empty string is not 'anon', so a claimless caller would
  -- otherwise be mistaken for a trusted server context.
  v_client := (v_actor IS NOT NULL)
              OR v_jwt_role = 'anon'
              OR current_user IN ('anon', 'authenticated');

  v_privileged := public.nx_is_admin() OR NOT v_client;

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
  END IF;

  -- Four eyes. Being an administrator authorises verifying SOMEONE ELSE'S
  -- credential; it never authorises self-issuing one's own. This is stricter
  -- than "an inspector may not self-verify" and strictly implies it. Server
  -- contexts have no identified actor and are unaffected.
  IF NEW.status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified')
     AND v_actor IS NOT NULL
     AND NEW.user_id = v_actor THEN
    RAISE EXCEPTION
      'FORBIDDEN: no actor may verify their own credential — verification is a second-party decision'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Attribution, stamped on entry to 'verified' when the caller did not supply
  -- it. Never cleared on exit: a rejection does not erase the fact that a
  -- verification decision was once taken. Stamped on INSERT too — an admin who
  -- files an already-verified credential must not lose the attribution.
  IF NEW.status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified') THEN
    NEW.verified_at := COALESCE(NEW.verified_at, now());
    NEW.verified_by := COALESCE(NEW.verified_by, v_actor);
  END IF;

  -- The whole point: the mirrors are DERIVED, on every write, from the one
  -- authority. This is what makes the two legacy booleans incapable of
  -- disagreeing with status, and it is why no existing writer has to change.
  -- status is NOT NULL, so neither assignment can produce NULL.
  NEW.is_verified := (NEW.status = 'verified');
  NEW.verified    := (NEW.status = 'verified');

  RETURN NEW;
END
$fn$;

ALTER FUNCTION public.nx_certifications_verification_authority() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_certifications_verification_authority() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.nx_certifications_verification_authority() IS
  'Verification authority + mirror derivation for public.certifications. (1) An authenticated non-admin may not file a credential as anything but pending, may not change status, and may not write verified_at / verified_by — an inspector cannot self-verify, which matters because matching awards 25 points for status=''verified''. (2) No actor may verify their OWN credential, an administrator included: being admin authorises verifying someone else. (3) is_verified and verified are DERIVED from status on every write, so the two deprecated mirrors can never disagree with the authority. Admin (nx_is_admin) and server-side contexts — no auth.uid(), and not running as anon/authenticated — retain full authority over other people''s credentials. Touches no money and no dispatch surface.';

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

  -- ── The derivation is only unambiguous because status cannot be NULL.
  --    If that ever changes, (status = 'verified') goes three-valued and the
  --    CHECK stops catching a NULL-status row.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='certifications'
                AND column_name='status' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'SELFTEST: certifications.status became nullable — the mirror derivation and the flags CHECK both depend on it being NOT NULL';
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

  -- ── Trigger order: the pre-existing BEFORE UPDATE trigger must still sort
  --    before the guard by name, so the guard's derivation is the last word.
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.certifications'::regclass
                AND tgname = 'certifications_updated_at' AND NOT tgisinternal)
     AND NOT ('certifications_updated_at' < 'trg_certifications_verification_authority') THEN
    RAISE EXCEPTION 'SELFTEST: trigger name order changed — the verification guard must fire after certifications_updated_at so its derivation is final';
  END IF;

  -- ── Authority: the guard must actually consult nx_is_admin, must derive both
  --    mirrors, and must refuse self-verification. A guard that forgot any of
  --    the three is worse than no guard, because the COMMENTs now promise all.
  IF v_guard !~ 'nx_is_admin' THEN
    RAISE EXCEPTION 'SELFTEST: the verification guard does not consult nx_is_admin — verification authority is not Admin-held';
  END IF;
  IF v_guard !~ 'NEW\.is_verified\s*:=' OR v_guard !~ 'NEW\.verified\s*:=' THEN
    RAISE EXCEPTION 'SELFTEST: the guard does not derive both deprecated mirrors from status — they can still diverge';
  END IF;
  IF v_guard !~ 'NEW\.user_id\s*=\s*v_actor' THEN
    RAISE EXCEPTION 'SELFTEST: the guard no longer refuses self-verification — an owner (including an admin owner) could verify their own credential';
  END IF;
  -- The claimless-caller hole: a guard that trusts an empty JWT role would
  -- treat an unauthenticated caller as a trusted server context.
  IF v_guard !~ 'current_user' THEN
    RAISE EXCEPTION 'SELFTEST: the guard decides privilege from JWT claims alone — a caller presenting no claims would be mistaken for a server context';
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

  RAISE NOTICE 'credential verification authority: certifications.status is authoritative; is_verified/verified deprecated to derived mirrors; self-verification refused for every actor; no expiry, money or RLS change.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
