-- ════════════════════════════════════════════════════════════════════════════
--  20260801302000_fix_admin_approval_publish_transition.sql
--
--  P0 — Admin approval is COMPLETELY BROKEN for every job in the pre-marketplace
--  state. "MOBILE FINAL QA": admin typed a $1,200 payout, pressed Confirm
--  Approval, and got `Review failed: NEXT_REDIRECT`. The payout persisted, but
--  moderation stayed pending_review, the job never opened, and mobile never saw
--  it. Rejection of a pending_approval job is broken by the identical cause.
--
--  ── ROOT CAUSE ─────────────────────────────────────────────────────────────
--  jobs_status_check admits 'pending_approval' (Sprint 8: "the parked
--  pre-marketplace state"), but guard_jobs_status_transition — the BEFORE UPDATE
--  OF status trigger that enforces the state machine — never got a branch for
--  it. Its table is:
--
--      CASE OLD.status
--        WHEN 'open' … WHEN 'assigned' … WHEN 'in_progress' … WHEN 'disputed' …
--        WHEN 'completed' THEN false   WHEN 'cancelled' THEN false
--        ELSE false            ← 'pending_approval' lands HERE
--      END
--
--  So the moment admin_review_job runs
--      UPDATE public.jobs SET … status = 'open' … WHERE id = p_job_id
--  on a pending_approval job, the guard raises
--      'Illegal jobs.status transition: pending_approval → open'
--  and the WHOLE function rolls back — moderation_status included. Nothing is
--  approved, nothing is published.
--
--  Trigger order makes no difference: BEFORE ROW triggers fire alphabetically,
--  so guard_jobs_status_transition_trigger (g…) runs before
--  trg_jobs_publish_on_approval (t…) — and even reversed, the guard would still
--  compare OLD='pending_approval' → NEW='open' and refuse it. The 268000
--  invariant trigger cannot help: it only sets NEW.status, it cannot authorise
--  the transition.
--
--  ── WHY EVERY PRIOR SELF-TEST MISSED IT ────────────────────────────────────
--  The guard bypasses when current_setting('role') IN ('service_role','postgres').
--  Migrations, the 268000 healing UPDATE and its live probe all ran that way (and
--  268000's probe was an INSERT, which this UPDATE-only trigger ignores anyway).
--  The guard only bites a real PostgREST request, where the role is
--  'authenticated' — SECURITY DEFINER does NOT rewrite the role GUC, so
--  admin_review_job gets no bypass. Hence: green migrations, broken product.
--
--  ── FIX 1 — teach the guard the pre-marketplace state ───────────────────────
--  Add ONE branch: pending_approval → open (approval publishes) or → cancelled
--  (rejection cascades via admin_cancel_job). Every other line of the function is
--  preserved byte-for-byte. This is strictly WIDENING: no transition that was
--  legal becomes illegal, terminal states stay terminal.
--
--  ── FIX 2 — make approval atomic ────────────────────────────────────────────
--  The admin panel issued TWO PostgREST calls — admin_set_job_pricing then
--  admin_review_job — so they are two transactions. Pricing committed, review
--  rolled back: that is exactly the partial state observed ($1,200 saved on a
--  job that is still pending_review). admin_review_job_with_pricing runs both
--  inside ONE plpgsql call, hence one transaction: either the payout AND the
--  approval land together, or neither does.
--
--  Both existing RPCs are left completely untouched and keep working for their
--  other callers; this only adds a transactional wrapper over them.
--
--  Retry-safe by construction — see the notes on the wrapper below.
--
--  Idempotent (CREATE OR REPLACE); self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The state-machine guard, with the pre-marketplace state admitted ─────
CREATE OR REPLACE FUNCTION public.guard_jobs_status_transition()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role text;
  v_legal boolean := false;
BEGIN
  -- No-op if status is unchanged (column wasn't touched, or set to itself).
  -- This is also what makes a re-approval retry free: NEW = OLD → return early.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Service-role / superuser bypass. Edge Functions and the admin
  -- dispatch RPC run under postgres or service_role and are the
  -- legitimate orchestration paths.
  v_role := current_setting('role', true);
  IF v_role IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- Block writes that drop status to NULL.
  IF NEW.status IS NULL THEN
    RAISE EXCEPTION 'jobs.status cannot be set to NULL (was: %)', OLD.status
      USING ERRCODE = '22000', HINT = 'Use a canonical RPC.';
  END IF;

  -- Legal transition table.
  v_legal := CASE OLD.status
    -- ★ 302000: the parked pre-marketplace state (jobs_status_check, Sprint 8).
    --   Approval publishes it (admin_review_job / trg_jobs_publish_on_approval);
    --   rejection cancels it (admin_review_job → admin_cancel_job). Without this
    --   branch both fell through to ELSE false and every admin decision on a
    --   freshly posted job was refused.
    WHEN 'pending_approval' THEN NEW.status IN ('open', 'cancelled')
    WHEN 'open'        THEN NEW.status IN ('assigned', 'cancelled')
    WHEN 'assigned'    THEN NEW.status IN ('in_progress', 'cancelled', 'disputed')
    WHEN 'in_progress' THEN NEW.status IN ('completed', 'disputed', 'cancelled')
    WHEN 'disputed'    THEN NEW.status IN ('completed', 'cancelled', 'in_progress')
    WHEN 'completed'   THEN false  -- terminal
    WHEN 'cancelled'   THEN false  -- terminal
    ELSE false
  END;

  IF NOT v_legal THEN
    RAISE EXCEPTION 'Illegal jobs.status transition: % → %', OLD.status, NEW.status
      USING ERRCODE = '22000',
            HINT = 'Use a canonical state-machine RPC (admin_dispatch_job, inspector_start_job, owner_cancel_job, admin_cancel_job, mark_job_completed, or open_dispute).';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_jobs_status_transition() OWNER TO postgres;

COMMENT ON FUNCTION public.guard_jobs_status_transition() IS
  'BEFORE UPDATE trigger on jobs. Refuses any status change not in the legal transition table. Service-role / postgres callers bypass for orchestration. 302000: pending_approval → open|cancelled admitted so admin approval/rejection of a freshly posted job can complete.';

-- ── 2) One transaction for payout + decision ────────────────────────────────
--  RETRY SAFETY (a second Confirm Approval is harmless):
--    • pricing  — assigns an absolute value, not a delta; writing 1200_00 twice
--                 leaves 1200_00.
--    • decision — admin_review_job's CASE only promotes FROM 'pending_approval',
--                 so an already-open job keeps status='open'; NEW.status is then
--                 NOT DISTINCT FROM OLD.status and the guard returns early.
--    • notify   — tg_notify_jobs fires only when moderation_status actually
--                 changes, so the retry emits ZERO extra notifications (270000
--                 already made the trigger the single source).
CREATE OR REPLACE FUNCTION public.admin_review_job_with_pricing(
  p_job_id                 uuid,
  p_decision               text,
  p_notes                  text   DEFAULT NULL,
  p_inspector_payout_cents bigint DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_priced boolean := false;
  v_review jsonb;
BEGIN
  -- Checked here too so an unauthorised caller is refused before ANY write,
  -- rather than relying on the inner functions' own guards.
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_inspector_payout_cents IS NOT NULL THEN
    IF p_inspector_payout_cents < 0 THEN
      RAISE EXCEPTION 'inspector payout cannot be negative';
    END IF;
    PERFORM public.admin_set_job_pricing(p_job_id, p_inspector_payout_cents);
    v_priced := true;
  END IF;

  -- Same transaction: if this raises, the pricing UPDATE above rolls back with
  -- it. That is the whole point — no more "payout saved, job still pending".
  v_review := public.admin_review_job(p_job_id, p_decision, p_notes);

  RETURN v_review || jsonb_build_object('pricing_applied', v_priced);
END $$;

ALTER FUNCTION public.admin_review_job_with_pricing(uuid, text, text, bigint)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_review_job_with_pricing(uuid, text, text, bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_job_with_pricing(uuid, text, text, bigint)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_review_job_with_pricing(uuid, text, text, bigint) IS
  'Atomic admin moderation decision: optionally sets the inspector payout and applies the review decision in ONE transaction, so a failure can never leave a job priced-but-unapproved. Delegates to admin_set_job_pricing + admin_review_job; both remain independently callable. Idempotent on retry.';

-- ── 3) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def    text;
  v_role   text;
  v_client uuid;
  v_probe  uuid;
  v_status text;
  v_live   boolean := false;
BEGIN
  v_def := pg_get_functiondef('public.guard_jobs_status_transition()'::regprocedure);

  -- (a) the new branch is present …
  IF position($q$WHEN 'pending_approval' THEN NEW.status IN ('open', 'cancelled')$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: guard still has no pending_approval branch — admin approval would keep failing';
  END IF;

  -- (b) … and nothing was loosened. Terminal states stay terminal and the
  --     pre-existing rows survive verbatim; this migration only widens.
  IF position($q$WHEN 'completed'   THEN false$q$ IN v_def) = 0
     OR position($q$WHEN 'cancelled'   THEN false$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: terminal states are no longer terminal';
  END IF;
  IF position($q$WHEN 'open'        THEN NEW.status IN ('assigned', 'cancelled')$q$ IN v_def) = 0
     OR position($q$WHEN 'assigned'    THEN NEW.status IN ('in_progress', 'cancelled', 'disputed')$q$ IN v_def) = 0
     OR position($q$WHEN 'in_progress' THEN NEW.status IN ('completed', 'disputed', 'cancelled')$q$ IN v_def) = 0
     OR position($q$WHEN 'disputed'    THEN NEW.status IN ('completed', 'cancelled', 'in_progress')$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an existing transition row was altered — this migration must be additive';
  END IF;

  -- (c) the trigger is still installed and enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'jobs' AND c.relnamespace = 'public'::regnamespace
       AND t.tgname = 'guard_jobs_status_transition_trigger' AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: guard_jobs_status_transition_trigger missing or disabled';
  END IF;

  -- (d) the atomic wrapper exists, is SECURITY DEFINER, and is NOT exposed to anon
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_review_job_with_pricing' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_review_job_with_pricing missing or not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon',
       'public.admin_review_job_with_pricing(uuid,text,text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can execute the admin review wrapper';
  END IF;

  -- (e) LIVE proof — actually drive a job pending_approval → open through the
  --     trigger. Only AUTHORITATIVE when this session is not itself bypassing
  --     the guard; that distinction is reported rather than assumed, because
  --     assuming it is precisely how this bug shipped green.
  v_role := coalesce(current_setting('role', true), 'none');
  SELECT id INTO v_client FROM public.profiles WHERE role = 'client' LIMIT 1;

  IF v_client IS NOT NULL THEN
    -- A plpgsql BEGIN…EXCEPTION block is an implicit SAVEPOINT, so raising on
    -- the way out unwinds the probe COMPLETELY — including the audit rows,
    -- job_events and notifications that AFTER triggers would otherwise leave
    -- behind pointing at a job that no longer exists. A plain DELETE could not
    -- undo those.
    BEGIN
      v_probe := gen_random_uuid();
      INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
      VALUES (v_probe, v_client, '__approval_transition_probe__',
              'guard self-test, rolled back', 'pending_approval', 'pending_review');

      UPDATE public.jobs SET status = 'open' WHERE id = v_probe;
      SELECT status INTO v_status FROM public.jobs WHERE id = v_probe;

      RAISE EXCEPTION 'NX_PROBE_ROLLBACK:%', coalesce(v_status, '<null>');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'NX_PROBE_ROLLBACK:%' THEN
        -- Normal path: the probe survived to the end and has now been undone.
        v_status := split_part(SQLERRM, ':', 2);
        v_live   := true;
      ELSIF SQLERRM LIKE '%Illegal jobs.status transition%' THEN
        -- The guard refused us — that is the actual bug, still present.
        RAISE EXCEPTION 'SELFTEST FAILED: guard still refuses pending_approval → open (%)', SQLERRM;
      ELSE
        -- Unrelated insert-time problem (future NOT NULL column, FK, another
        -- trigger's side effect). Degrade to the static proof rather than
        -- false-failing the migration.
        RAISE NOTICE 'live probe skipped (%): static proof (a)-(d) already stands', SQLERRM;
      END IF;
    END;

    IF v_live THEN
      IF v_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'SELFTEST FAILED: probe job did not reach open (got %)', v_status;
      END IF;
      IF v_role IN ('service_role', 'postgres') THEN
        RAISE NOTICE 'live probe passed but session role=% BYPASSES the guard — proof (a) is the binding one', v_role;
      ELSE
        RAISE NOTICE 'live probe AUTHORITATIVE (role=%): pending_approval → open accepted by the guard', v_role;
      END IF;
    END IF;
  END IF;

  RAISE NOTICE 'admin approval fixed: pending_approval publishes/cancels, payout+decision now atomic.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
