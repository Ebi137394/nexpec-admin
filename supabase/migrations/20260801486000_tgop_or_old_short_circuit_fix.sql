-- ════════════════════════════════════════════════════════════════════════════
--  20260801486000_tgop_or_old_short_circuit_fix.sql
--
--  P1 — three INSERT triggers touch OLD through an OR, which SQL may evaluate.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  Three guards attached to BEFORE INSERT OR UPDATE test:
--
--      IF ... AND (TG_OP = 'INSERT' OR OLD.<field> ...) THEN
--
--  The author's intent is "skip the OLD comparison on INSERT". SQL does NOT
--  guarantee short-circuit evaluation of OR — the planner may evaluate either
--  operand in any order — so on the INSERT path OLD is dereferenced anyway. OLD
--  is unassigned there, and PostgreSQL raises:
--
--      ERROR: record "old" has no field "is_verified"
--
--  Reproduced: certification_expiry_test aborts at fixture setup on exactly
--  this, inserting into public.certifications.
--
--  ── WHY IT MATTERS BEYOND ONE TEST ─────────────────────────────────────────
--  This is the same family as 20260801466000, where a guard attached to INSERT
--  read OLD and was a silent no-op. Here it is louder — the INSERT fails
--  outright — but the affected guards are load-bearing:
--    • nx_certifications_verification_authority (certifications) — four-eyes
--      credential verification
--    • nx_guard_contract_before_money (deal_money_legs) — a MONEY guard
--    • tg_job_contracts_identity_snapshot (job_contracts) — identity snapshot
--  A guard that raises on every INSERT is not "safe because it fails closed";
--  it blocks the legitimate path and hides whatever it was meant to check.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Rewrite each occurrence as CASE, which DOES guarantee that the ELSE arm is
--  not evaluated when WHEN matches:
--
--      (CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.<field> ... END)
--
--  Semantics are identical to the author's intent; only the evaluation
--  guarantee changes. Every function body is otherwise reproduced verbatim from
--  pg_get_functiondef, so no authorization, money or identity logic is altered.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_certifications_verification_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     AND (CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.status IS DISTINCT FROM 'verified' END)
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
     AND (CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.status IS DISTINCT FROM 'verified' END) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.nx_guard_contract_before_money()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_status text;
BEGIN
  IF NEW.status = 'released' AND (CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.status IS DISTINCT FROM 'released' END) THEN
    IF NEW.agreement_id IS NULL THEN
      RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: money leg % has no gating agreement', NEW.id;
    END IF;
    SELECT status INTO v_status FROM public.agreements WHERE id = NEW.agreement_id;
    IF v_status IS DISTINCT FROM 'executed' THEN
      RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: gating agreement % is % (must be executed)', NEW.agreement_id, COALESCE(v_status,'missing');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_job_contracts_identity_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job_mode text;
BEGIN
  -- (a) IMMUTABILITY: once stamped, effective_identity_mode can never change.
  IF TG_OP = 'UPDATE' AND OLD.effective_identity_mode IS NOT NULL THEN
    NEW.effective_identity_mode := OLD.effective_identity_mode;
  END IF;

  -- (b) SNAPSHOT: on the first transition into fully_executed, stamp the Job's
  --     CURRENT identity_mode (fail-closed to 'protected' if somehow NULL).
  IF NEW.status = 'fully_executed'
     AND (CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.status IS DISTINCT FROM 'fully_executed' END)
     AND NEW.effective_identity_mode IS NULL
  THEN
    SELECT j.identity_mode INTO v_job_mode FROM public.jobs j WHERE j.id = NEW.job_id;
    NEW.effective_identity_mode := COALESCE(v_job_mode, 'protected');
  END IF;

  RETURN NEW;
END;
$function$;

DO $selftest$
DECLARE v_bad text;
BEGIN
  FOR v_bad IN
    SELECT DISTINCT p.proname
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND (t.tgtype & 4) > 0
       AND p.prosrc ~ 'TG_OP\s*=\s*''INSERT''\s+OR\s+OLD\.'
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % still dereferences OLD through an OR on the INSERT path — SQL does not guarantee short-circuit', v_bad;
  END LOOP;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
