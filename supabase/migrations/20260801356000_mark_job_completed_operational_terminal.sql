-- ════════════════════════════════════════════════════════════════════════════
--  20260801356000_mark_job_completed_operational_terminal.sql
--
--  OPERATIONAL LIFECYCLE GAP (audit finding, in-scope, NOT a payment change).
--
--  A job could never reach the terminal operational status 'completed':
--    • guard_jobs_status_transition ALREADY permits in_progress → completed and
--      disputed → completed (20260801302000), but
--    • NO live code path performs that transition. approve_job_and_pay is the
--      only function that sets status='completed' and it ALSO inserts a
--      transactions row (it moves money) and has zero callers; the two trigger
--      functions that once did it are attached to nothing; the guard's own error
--      HINT names mark_job_completed, which never existed.
--  So a sold, inspected, reported job stuck at 'in_progress' forever, and every
--  downstream operational signal keyed on completion never fired.
--
--  ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  public.mark_job_completed(p_job_id uuid, p_note text) — an EXPLICIT,
--  admin-only, money-free operational transition to 'completed'. It is a
--  deliberate manual action, not a trigger on report approval, so admin keeps
--  control of when a job closes (consistent with the manual-settlement model).
--
--  ── PAYMENT FREEZE — THIS FUNCTION MOVES NO MONEY ───────────────────────────
--  The inspector-payout trigger fires ONLY `AFTER UPDATE OF admin_confirmed_at`
--  (trg_credit_inspector_on_confirm). This function writes status + updated_at
--  and NOTHING else — it never touches admin_confirmed_at, payout_*, wallets,
--  transactions, escrow_status, or invoices. Completing a job therefore has ZERO
--  financial effect; settlement remains 100% manual via the existing
--  request_withdrawal → admin_mark_withdrawal_paid path. A self-test below
--  fails the migration if a money write ever appears in this function's body.
--
--  ── SAFETY ──────────────────────────────────────────────────────────────────
--    • Additive only. No table/column/policy change. No existing function or
--      migration is modified. The transition itself was already legal.
--    • Admin-only (nx_is_admin), REVOKE from anon.
--    • Idempotent: completing an already-completed job returns ok, no-op.
--    • Refuses anything the guard would refuse anyway, with clearer errors, and
--      refuses non-terminal-eligible states up front (must be in_progress or
--      disputed) so the caller gets a meaningful message, not a guard 22000.
--    • Row-locked (FOR UPDATE) to serialise concurrent completion attempts.
--  Idempotent (CREATE OR REPLACE); self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_job_completed(
  p_job_id uuid,
  p_note   text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_job RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  -- Idempotent: already terminal-complete → success, no write.
  IF v_job.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'status', 'completed', 'idempotent', true);
  END IF;

  -- Only from a state the guard will actually accept. Clearer than a raw 22000.
  IF v_job.status NOT IN ('in_progress', 'disputed') THEN
    RAISE EXCEPTION 'job % cannot be completed from status % (must be in_progress or disputed)', p_job_id, v_job.status
      USING errcode = '22023';
  END IF;

  -- The ONLY write is status + updated_at. It deliberately does not confirm
  -- dispatch, credit any ledger, or move funds — completion has no financial
  -- effect (the self-test below fails the deploy if a money surface is named
  -- anywhere in this definition, comments included). The AFTER-UPDATE audit
  -- trigger records this; trg_notify_jobs notifies the client of the status
  -- change. Both are existing, all-paths mechanisms.
  UPDATE public.jobs
     SET status     = 'completed',
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok',     true,
    'job_id', p_job_id,
    'status', 'completed',
    'note',   NULLIF(btrim(coalesce(p_note, '')), '')
  );
END $$;

ALTER FUNCTION public.mark_job_completed(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_job_completed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_job_completed(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_job_completed(uuid, text) IS
  'Admin-only, money-free operational transition of a job to status=completed (from in_progress or disputed). Writes status + updated_at ONLY — never admin_confirmed_at, payout, wallet, transactions or escrow, so settlement stays manual. Idempotent, row-locked. The transition was already legal under guard_jobs_status_transition; this is the missing canonical caller.';

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def text := pg_get_functiondef('public.mark_job_completed(uuid,text)'::regprocedure);
BEGIN
  -- (a) SECURITY DEFINER + admin gate present
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'mark_job_completed' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: mark_job_completed must be SECURITY DEFINER';
  END IF;
  IF position('admin only' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin gate missing';
  END IF;

  -- (b) MONEY-FREE. The whole point. If any of these ever appears in the body,
  --     completion would have a financial side effect — fail the deploy.
  IF v_def ~* '\madmin_confirmed_at\M'
     OR v_def ~* '\mpayout'
     OR v_def ~* '\mwallet'
     OR v_def ~* '\mtransactions\M'
     OR v_def ~* '\minspector_payout_cents\M'
     OR v_def ~* '\mescrow'
     OR v_def ~* '\minvoices\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: mark_job_completed references a money surface — completion must move no money';
  END IF;

  -- (c) it writes jobs.status and nothing structurally alarming
  IF position($q$SET status     = 'completed'$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: mark_job_completed does not set status=completed';
  END IF;

  -- (d) not reachable by anon
  IF has_function_privilege('anon', 'public.mark_job_completed(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can execute mark_job_completed';
  END IF;

  -- (e) the transition is legal under the live guard (regression tie-in)
  IF pg_get_functiondef('public.guard_jobs_status_transition()'::regprocedure)
       !~ $q$WHEN 'in_progress' THEN NEW.status IN ('completed'$q$ THEN
    RAISE EXCEPTION 'SELFTEST FAILED: guard no longer permits in_progress → completed';
  END IF;

  RAISE NOTICE 'mark_job_completed ready: admin-only, money-free, idempotent operational completion.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
