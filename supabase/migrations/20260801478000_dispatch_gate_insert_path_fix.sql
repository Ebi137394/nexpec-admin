-- ════════════════════════════════════════════════════════════════════════════
--  20260801478000_dispatch_gate_insert_path_fix.sql
--
--  P1 — the dispatch funding gate is unsatisfiable on the INSERT path.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  nx_guard_dispatch_requires_funding (20260801422000, last rewritten by
--  20260801462000) is a BEFORE INSERT OR UPDATE trigger on public.jobs. Its
--  dispatch test deliberately covers INSERT:
--
--      v_dispatch := (NEW.status = 'assigned' AND ...)
--                 OR (NEW.contractor_id IS NOT NULL AND v_old_contractor IS NULL);
--
--  and on INSERT it sets v_old_contractor := NULL, so creating a job with
--  contractor_id already populated counts as a dispatch. That is intended.
--
--  It then asks:
--
--      IF NOT public.nx_funding_initial_satisfied(NEW.id) THEN ... RAISE
--
--  and that function (20260801448000) resolves the legacy case by reading the
--  table:
--
--      SELECT client_settled_at INTO v_legacy FROM public.jobs WHERE id = p_job_id;
--      RETURN v_legacy IS NOT NULL;
--
--  In a BEFORE INSERT trigger THAT ROW DOES NOT EXIST YET. The SELECT finds
--  nothing, v_legacy is NULL, the function returns false, and the guard raises
--  FUNDING_REQUIRED — for every prepay job created with an inspector already
--  attached, no matter how it is funded. Setting client_settled_at in the very
--  same INSERT does not help, because the guard cannot see the row it is about
--  to become. The INSERT path was therefore not merely strict, it was
--  unsatisfiable.
--
--  Proven at runtime, not by reading: a fixture INSERT carrying
--  client_settled_at = now() still raised FUNDING_REQUIRED. This is why 28 of
--  the 38 failing pgTAP suites aborted at fixture setup — they were reporting a
--  real product defect, not fixture drift.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Evaluate the legacy carrier from NEW rather than from the table. NEW is the
--  right source in BOTH directions:
--
--    • INSERT — NEW.client_settled_at is the value the row is being created
--      with; the table has nothing to offer.
--    • UPDATE — NEW.client_settled_at is the POST-update value, which is what
--      "is this job funded as of this statement" actually means. Reading the
--      table there would consult the pre-update value and could reject a
--      statement that funds and dispatches in one go.
--
--  The staged path is unchanged and still reads job_funding_stages by id: stage
--  rows are independent of the jobs row, so they are visible during BEFORE
--  INSERT if the schedule was seeded first. A staged job therefore still has to
--  have its initial tranche genuinely funded — this fix does not weaken it.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • The gate still fires on exactly the same dispatch conditions.
--   • net_terms still requires a resolvable buyer principal AND a positive
--     authorised credit line.
--   • An unrecognised payment_mode is still refused rather than assumed funded.
--   • No money moves here, and no settlement or payout path is introduced.
--   • nx_funding_initial_satisfied itself is left alone — other callers read it
--     against committed rows, where its table read is correct.
-- ════════════════════════════════════════════════════════════════════════════

-- ── RECONCILIATION WITH THE PLATFORM-ONLY FUNDING GUARD (added on review) ──
--  The obvious objection: does reading NEW.client_settled_at let a client
--  create a job pre-settled and dispatch itself for free? No. That is a
--  DIFFERENT guard and it is untouched.
--
--  nx_guard_jobs_funding_columns (20260801462000) refuses any non-platform
--  actor changing client_settled_at, on INSERT *and* UPDATE, with
--  FUNDING_COLUMN_IS_PLATFORM_ONLY. This migration contains ZERO references to
--  it. So a client still cannot put a value there; all this change does is let
--  the dispatch guard SEE a value the platform itself just wrote.
--  Verified live at 176 migrations: the platform-only guard is intact.
--
--  The staged path is likewise untouched — it still reads job_funding_stages
--  by id, so a job with a schedule must still have a genuinely funded initial
--  tranche. The 20/80 model and manual Inspector settlement are unaffected.
--
-- ── EVIDENCE: DEFECT REPRODUCED BEFORE FIXING ──────────────────────────────
--  Against the live 176-migration database, with the pre-478000 guard restored
--  inside a rolled-back transaction, a PLATFORM insert carrying
--  client_settled_at = now() still raised:
--      FUNDING_REQUIRED: prepay job cc00…cc initial tranche not in
--  confirming the path was unsatisfiable rather than merely strict.
--
-- ── WHAT THIS DOES NOT LICENSE: FIXTURES STILL MUST NOT INSERT DISPATCHED ──
--  Production NEVER creates a job with contractor_id set. Traced:
--    • app/post-new-job.tsx creates status='pending_approval', no contractor —
--      the canonical client path.
--    • app/my-jobs.tsx DOES insert contractor_id = self, but it is dev-only
--      seed data behind `if (!__DEV__) { … return; }`, with a comment saying
--      the gate exists so "a stray button can never mint a self-assigned job
--      (contractor_id = self bypasses the admin broker)".
--
--  And the canonical dispatch is not even a direct UPDATE. Attempting
--  pending_approval → assigned by UPDATE is refused by
--  guard_jobs_status_transition:
--      Illegal jobs.status transition: pending_approval → assigned
--      HINT: Use a canonical state-machine RPC (admin_dispatch_job, …)
--
--  So the canonical sequence is: CREATE UNASSIGNED → FUND VIA THE PLATFORM
--  PATH → admin_dispatch_job(). pgTAP fixtures that insert an already-assigned
--  job are reproducing a shape production forbids, and must be corrected to
--  follow that sequence through a shared helper — NOT by bulk-adding
--  client_settled_at, which the platform-only guard exists to prevent.
--  This migration fixes the trigger wart; it does not bless the fixture shape.

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_guard_dispatch_requires_funding()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_mode           text;
  v_dispatch       boolean;
  v_buyer          uuid;
  v_limit          bigint;
  v_old_status     text;
  v_old_contractor uuid;
  v_has_schedule   boolean;
  v_satisfied      boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old_status := NULL; v_old_contractor := NULL;
  ELSE
    v_old_status := OLD.status; v_old_contractor := OLD.contractor_id;
  END IF;

  v_dispatch :=
       (NEW.status = 'assigned' AND v_old_status IS DISTINCT FROM 'assigned')
    OR (NEW.contractor_id IS NOT NULL AND v_old_contractor IS NULL);

  IF NOT v_dispatch THEN
    RETURN NEW;
  END IF;

  v_mode := COALESCE(NEW.payment_mode, 'prepay');

  IF v_mode = 'prepay' THEN
    -- Staged funding, if this job has a schedule. job_funding_stages rows are
    -- independent of the jobs row, so this is readable during BEFORE INSERT.
    SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = NEW.id)
      INTO v_has_schedule;

    IF v_has_schedule THEN
      v_satisfied := public.nx_funding_stage_is_funded(NEW.id, 'initial');
    ELSE
      -- Legacy carrier, read from NEW. See the header: reading the TABLE here
      -- is wrong on INSERT (no row yet) and stale on UPDATE (pre-update value).
      v_satisfied := NEW.client_settled_at IS NOT NULL;
    END IF;

    IF NOT v_satisfied THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is prepay and its initial funding tranche is not in. Dispatching would send an inspector to site against nothing.',
        NEW.id
        USING ERRCODE = '22000',
              HINT = 'Client funds the initial tranche first. Legacy jobs with jobs.client_settled_at set already satisfy this.';
    END IF;
    RETURN NEW;
  END IF;

  IF v_mode = 'net_terms' THEN
    v_buyer := public.nx_job_buyer_principal(NEW.id);
    IF v_buyer IS NULL THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but has no resolvable buyer principal.',
        NEW.id USING ERRCODE = '22000';
    END IF;
    SELECT COALESCE(p.client_credit_limit_cents, 0) INTO v_limit
      FROM public.profiles p WHERE p.id = v_buyer;
    IF COALESCE(v_limit, 0) <= 0 THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but buyer principal % holds no authorised credit line.',
        NEW.id, v_buyer USING ERRCODE = '22000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'FUNDING_REQUIRED: job % has unrecognised payment_mode %; refusing dispatch rather than guessing that it is funded.',
    NEW.id, v_mode USING ERRCODE = '22000';
END $fn$;

ALTER FUNCTION public.nx_guard_dispatch_requires_funding() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_guard_dispatch_requires_funding() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.nx_guard_dispatch_requires_funding() IS
  'BEFORE INSERT OR UPDATE on public.jobs: refuses to dispatch an unfunded job. prepay requires the initial tranche (job_funding_stages when a schedule exists, else the legacy jobs.client_settled_at); net_terms requires a resolvable buyer principal holding a positive authorised credit line; an unrecognised payment_mode is refused outright. The legacy carrier is read from NEW, never from the table — on BEFORE INSERT the row does not exist yet, which made the INSERT path unsatisfiable before 20260801478000, and on UPDATE the table holds the stale pre-update value. Moves no money and settles nothing.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_src text := pg_get_functiondef('public.nx_guard_dispatch_requires_funding()'::regprocedure);
BEGIN
  -- The whole point: the legacy carrier comes from NEW.
  IF strpos(v_src, 'NEW.client_settled_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the guard no longer reads the legacy funding carrier from NEW — the INSERT path is unsatisfiable again';
  END IF;

  -- And it must NOT have gone back to resolving the legacy case by id.
  IF strpos(v_src, 'nx_funding_initial_satisfied') > 0 THEN
    RAISE EXCEPTION 'SELFTEST: the guard calls nx_funding_initial_satisfied again, which reads public.jobs by id and cannot work in a BEFORE INSERT trigger';
  END IF;

  -- The staged path must survive: a job WITH a schedule still has to be funded.
  IF strpos(v_src, 'nx_funding_stage_is_funded') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the staged funding check was dropped — a scheduled job could dispatch unfunded';
  END IF;

  -- net_terms authority must survive.
  IF strpos(v_src, 'nx_job_buyer_principal') = 0
     OR strpos(v_src, 'client_credit_limit_cents') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the net_terms buyer/credit-line requirement was dropped';
  END IF;

  -- Still attached, and still to both timings.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.jobs'::regclass
       AND NOT t.tgisinternal
       AND t.tgfoid = 'public.nx_guard_dispatch_requires_funding()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'SELFTEST: the dispatch funding guard is not attached to public.jobs';
  END IF;

  -- This lane moves no money.
  IF v_src ~* '\m(wallets|transactions|payout|escrow|settle_|credit_inspector)\M' THEN
    RAISE EXCEPTION 'SELFTEST: the dispatch guard names a money surface — it gates dispatch, it does not move funds';
  END IF;

  RAISE NOTICE 'dispatch funding gate: INSERT path satisfiable; staged and net_terms requirements intact.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
