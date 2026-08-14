-- ════════════════════════════════════════════════════════════════════════════
--  20260801488000_missing_overload_and_dead_trigger_fix.sql
--
--  Two P1 defects that only executing the schema could surface. Both were
--  invisible to every static guard: the SQL parses, the objects exist, and the
--  broken references only resolve at RUNTIME, on a code path no CI ever ran
--  because there was no database to run it against.
--
--  ── 1. nx_job_reschedule_visit CALLS A FUNCTION THAT DOES NOT EXIST ────────
--  Its authorization line is:
--
--      IF NOT public.is_admin(v_admin) THEN
--
--  public.is_admin() exists, but takes NO arguments — it reads auth.uid()
--  itself and resolves the role from public.user_roles. There is no
--  is_admin(uuid) overload anywhere in the schema, so the call raises
--
--      function public.is_admin(uuid) does not exist
--
--  the moment any caller reaches it. Rescheduling a visit was therefore broken
--  outright, for administrators included: the guard meant to authorise the
--  action was the thing that failed. Proven at runtime — multi_visit and
--  visit_reporting both abort here with the error naming
--  nx_job_reschedule_visit line 7.
--
--  Fixed by pointing it at public.nx_is_admin(uuid), which is the canonical
--  admin predicate everywhere else in this schema and the one its sibling
--  visit functions already use (nx_job_active_visit_for calls
--  public.nx_is_admin(v_caller)). Deliberately NOT fixed by inventing an
--  is_admin(uuid) overload: is_admin() resolves roles from public.user_roles
--  while nx_is_admin() resolves them from public.profiles.role, so an overload
--  would quietly introduce a SECOND source of admin truth. The rest of the
--  function is reproduced byte-for-byte, including 394000's load-bearing
--  supersede-before-insert ordering and its active-crew-only carry-forward.
--
--  ── 2. protect_certification_verification IS DEAD CODE THAT BREAKS WRITES ──
--  It is a BEFORE UPDATE trigger on public.contractor_certifications
--  (baseline:27794) whose body references THREE things that do not exist on
--  that table:
--
--      OLD.is_verified / NEW.is_verified   -- no such column
--      NEW.updated_at                      -- no such column
--      is_admin()                          -- resolves, but see below
--
--  contractor_certifications is (id, contractor_id, title, issued_by,
--  expiry_date, cert_url, status, created_at). So every UPDATE that does not
--  carry a service_role JWT raises `record "old" has no field "is_verified"`
--  and the write fails. The table has been effectively read-only for end users,
--  and the "only administrators can verify" rule it advertises has never once
--  been enforced — the trigger dies before reaching it.
--
--  Rewritten against the column the table actually uses to carry verification:
--  `status`. The intent is preserved exactly — a non-admin may not change the
--  verification state — and it now runs. NEW.updated_at is dropped because
--  there is no such column. is_admin() is replaced with nx_is_admin() for the
--  same one-source-of-truth reason as above.
--
--  Neither change touches money, payout, settlement or funding.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Reschedule: use the canonical admin predicate ────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_reschedule_visit(
  p_visit_id  uuid,
  p_new_start timestamptz,
  p_new_end   timestamptz DEFAULT NULL,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_old   RECORD;
  v_new   uuid;
BEGIN
  -- was: public.is_admin(v_admin) — an overload that does not exist.
  IF NOT public.nx_is_admin(v_admin) THEN
    RAISE EXCEPTION 'only an administrator may reschedule a visit'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_old FROM public.job_visits WHERE id = p_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit % not found', p_visit_id USING errcode = '23503';
  END IF;

  IF v_old.status IN ('completed','cancelled','rescheduled') THEN
    RAISE EXCEPTION 'visit % cannot be rescheduled from status %', p_visit_id, v_old.status
      USING errcode = '22023';
  END IF;

  -- ★ 394000 — ORDER IS LOAD-BEARING. The old row must leave the live set
  --   BEFORE its replacement claims the same visit_number, or the partial
  --   unique index rejects the insert exactly as the unconditional one did.
  --   Supersede, never delete: the schedule history stays legible.
  UPDATE public.job_visits SET status = 'rescheduled' WHERE id = p_visit_id;

  INSERT INTO public.job_visits
    (job_id, visit_number, title, visit_kind, status, scheduled_start,
     scheduled_end, timezone, recurrence_group_id, rescheduled_from_id,
     notes, created_by)
  VALUES (v_old.job_id, v_old.visit_number, v_old.title, v_old.visit_kind,
          'scheduled', p_new_start, p_new_end, v_old.timezone,
          v_old.recurrence_group_id, v_old.id,
          COALESCE(NULLIF(btrim(coalesce(p_reason,'')), ''), v_old.notes), v_admin)
  RETURNING id INTO v_new;

  -- Carry the crew across, so rescheduling does not silently unassign anyone —
  -- but ★ 394000 only ACTIVE crew. Removal is a soft delete, so the old
  -- assignment rows for removed inspectors still exist and were previously
  -- propagated forward, re-granting a removed inspector a live assignment.
  INSERT INTO public.job_visit_assignments (visit_id, job_inspector_id, is_lead, assigned_by)
  SELECT v_new, a.job_inspector_id, a.is_lead, v_admin
    FROM public.job_visit_assignments a
    JOIN public.job_inspectors ji ON ji.id = a.job_inspector_id
   WHERE a.visit_id = p_visit_id
     AND ji.status IN ('assigned','active');

  RETURN jsonb_build_object('ok', true, 'old_visit_id', p_visit_id, 'new_visit_id', v_new);
END;
$fn$;

-- ── 1b. Same defect, same class: nx_job_cancel_visit ────────────────────────
--  Found by the same runtime sweep. Identical broken call, identical fix.
--  Cancelling a visit was impossible for anyone, administrators included.
CREATE OR REPLACE FUNCTION public.nx_job_cancel_visit(p_visit_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_n     int;
BEGIN
  IF NOT public.nx_is_admin(v_admin) THEN
    RAISE EXCEPTION 'only an administrator may cancel a visit'
      USING errcode = '42501';
  END IF;

  -- 394000 added 'rescheduled'. Without it, cancelling a superseded row set
  -- status='cancelled', which put it back inside nx_job_visits' filter
  -- (status <> 'rescheduled') alongside the replacement that superseded it:
  -- two live rows on one visit_number and a severed supersession chain.
  UPDATE public.job_visits
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_admin,
         cancel_reason = NULLIF(btrim(coalesce(p_reason,'')), '')
   WHERE id = p_visit_id
     AND status NOT IN ('completed','cancelled','rescheduled');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'cancelled_visit_id', p_visit_id);
END;
$fn$;

-- ── 2. Certification verification guard, against real columns ───────────────
CREATE OR REPLACE FUNCTION public.protect_certification_verification()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- The platform (Stripe webhooks, jobs, migrations) keeps full authority.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- contractor_certifications carries verification in `status`, not in an
  -- is_verified boolean — that column has never existed on this table.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT public.nx_is_admin() THEN
      RAISE EXCEPTION 'FORBIDDEN: Only administrators can verify certifications'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- No NEW.updated_at assignment: the table has no such column, and touching
  -- it is what made every non-service_role UPDATE raise.
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION public.protect_certification_verification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_certification_verification() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.protect_certification_verification() IS
  'BEFORE UPDATE on contractor_certifications: a non-admin may not change the verification state. Rewritten by 20260801488000 — it previously referenced OLD/NEW.is_verified and NEW.updated_at, neither of which exists on this table, so every non-service_role UPDATE raised `record "old" has no field "is_verified"` and the rule it advertised was never actually enforced. Verification is carried by `status`.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_res text := regexp_replace(
                  pg_get_functiondef('public.nx_job_reschedule_visit(uuid,timestamptz,timestamptz,text)'::regprocedure),
                  '--[^\n]*', '', 'g');
  -- Comments stripped before matching: this function's own explanatory comments
  -- name the columns it no longer uses, which would trip the checks below.
  v_cert text := regexp_replace(
                   pg_get_functiondef('public.protect_certification_verification()'::regprocedure),
                   '--[^\n]*', '', 'g');
BEGIN
  -- 1. No caller may reach a non-existent overload again.
  IF v_res ~ '(^|[^a-z_.])is_admin\s*\(\s*[a-z_]' AND v_res !~ 'nx_is_admin\s*\(\s*[a-z_]' THEN
    RAISE EXCEPTION 'SELFTEST: nx_job_reschedule_visit still calls a bare is_admin(uuid), which does not exist';
  END IF;
  IF strpos(v_res, 'nx_is_admin') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_job_reschedule_visit lost its admin check entirely';
  END IF;

  -- 2. 394000's ordering and active-crew rules must survive the rewrite.
  IF strpos(v_res, 'rescheduled') = 0 OR v_res !~ 'ji\.status IN' THEN
    RAISE EXCEPTION 'SELFTEST: the supersede-before-insert ordering or the active-crew-only carry-forward was lost';
  END IF;

  -- 3. The certification guard must no longer touch columns that do not exist.
  IF v_cert ~ 'is_verified' THEN
    RAISE EXCEPTION 'SELFTEST: protect_certification_verification still references is_verified, which contractor_certifications does not have';
  END IF;
  IF v_cert ~ 'NEW\.updated_at' THEN
    RAISE EXCEPTION 'SELFTEST: protect_certification_verification still assigns NEW.updated_at, which contractor_certifications does not have';
  END IF;
  IF strpos(v_cert, 'OLD.status IS DISTINCT FROM NEW.status') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the certification guard no longer protects the status carrier';
  END IF;

  -- 4. Prove it against the live catalogue rather than by reading.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='contractor_certifications'
                AND column_name IN ('is_verified','updated_at')) THEN
    RAISE EXCEPTION 'SELFTEST: contractor_certifications gained is_verified/updated_at — revisit this rewrite, its premise changed';
  END IF;

  -- 5. Neither function may touch money.
  IF v_res ~* '\m(wallets|transactions|payout|escrow|settle_)\M'
     OR v_cert ~* '\m(wallets|transactions|payout|escrow|settle_)\M' THEN
    RAISE EXCEPTION 'SELFTEST: a function repaired here names a money surface';
  END IF;

  -- 6. CATALOGUE SWEEP: no function anywhere may call the non-existent
  --    is_admin(<arg>) overload again. Driven from pg_proc rather than a name
  --    list, so a future function cannot reintroduce it silently. Comments are
  --    stripped first: this migration's own notes quote the old broken call.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '\mpublic\.is_admin\s*\(\s*[a-z_]'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a public function still calls public.is_admin(<arg>), an overload that does not exist';
  END IF;

  RAISE NOTICE 'reschedule/cancel authorization and certification guard now resolve against objects that exist.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
