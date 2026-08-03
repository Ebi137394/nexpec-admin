-- ════════════════════════════════════════════════════════════════════════════
--  20260801298000_awaiting_replacement_discoverable.sql
--
--  DEAD END — a job awaiting a replacement inspector can never get one unless a
--  second inspector happened to apply BEFORE the original hire.
--
--  REPRODUCTION: void the contract on "Pressure" → Admin correctly shows
--  "Awaiting replacement" → inspector2 opens /inspector/jobs → Pressure is not
--  listed → they cannot apply → the Admin replacement panel has no candidate →
--  the job is stuck with no inspector and no supported way to assign one.
--
--  ROOT CAUSE — admin_void_contract deliberately leaves jobs.status at
--  'in_progress' and only clears the inspector pointers ("awaiting replacement"
--  is a DERIVED state). But every discovery and application gate is written
--  against status='open', so all three refuse the job:
--
--    1. RLS SELECT  jobs_browse_open_approved  → status='open' AND approved
--       RLS SELECT  jobs_read                  → status='open' AND contractor NULL
--         ⇒ the job is invisible to any inspector who is not already a party.
--    2. App query   apps/web/src/lib/data/openJobs.ts → .eq('status','open')
--         ⇒ filtered out of Open jobs even for someone who could see it.
--    3. RLS INSERT  applications_insert → j.status='open' AND j.contractor_id IS NULL
--         ⇒ even with a direct link, applying is refused at the DB layer.
--
--  So this could not be fixed in the UI — the floor itself is closed.
--
--  FIX — one shared predicate, nx_job_awaiting_replacement(), and two ADDITIVE
--  permissive policies that admit exactly that state. Nothing existing is
--  dropped, loosened or rewritten:
--    • a job is "awaiting replacement" only when it is engaged (in_progress),
--      carries NO inspector pointer of any kind, is moderation-approved and not
--      deleted, AND has a voided contract but no live one. That last pair is
--      what makes it precise: a job mid-flight with a healthy contract, or one
--      that never had a contract, does not qualify.
--    • the RESTRICTIVE department-scoping policy still ANDs on top, so tenant
--      isolation is unchanged.
--
--  INVARIANTS PRESERVED:
--    • The voided contract is NEVER touched here — no status change, no
--      un-voiding. It remains voided legal history for ever. Replacement always
--      creates a NEW contract via admin_replace_inspector.
--    • Re-selecting the FORMER inspector was already supported and stays so:
--      admin_replace_inspector accepts any application not in
--      (rejected, withdrawn) — including the former inspector's 'hired' row —
--      and its "already the inspector" guard only fires against a LIVE contract,
--      of which there is none after a void. The admin panel likewise stops
--      excluding them because jobs.contractor_id is NULL post-void.
--    • No new job status, no workflow redesign, no change to the sign RPCs.
--
--  Idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS) + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The shared predicate ─────────────────────────────────────────────────
--  SECURITY DEFINER is REQUIRED: this is called from a policy ON public.jobs and
--  itself reads public.jobs, which would recurse under invoker rights. Same
--  pattern as is_active_contract_inspector (20260801284000).
CREATE OR REPLACE FUNCTION public.nx_job_awaiting_replacement(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND j.deleted_at IS NULL
       AND j.status = 'in_progress'
       AND j.moderation_status = 'approved'
       -- no inspector of any kind is currently attached
       AND j.contractor_id      IS NULL
       AND j.hired_inspector_id IS NULL
       AND j.inspector_id       IS NULL
       -- a contract was voided …
       AND EXISTS (
         SELECT 1 FROM public.job_contracts c
          WHERE c.job_id = j.id AND c.status = 'voided'
       )
       -- … and none is live (the partial unique index allows at most one)
       AND NOT EXISTS (
         SELECT 1 FROM public.job_contracts c
          WHERE c.job_id = j.id AND c.status <> 'voided'
       )
  );
$$;

ALTER FUNCTION public.nx_job_awaiting_replacement(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_awaiting_replacement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_awaiting_replacement(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_awaiting_replacement(uuid) IS
  'TRUE when a job lost its inspector to a contract void and needs a replacement: engaged status, no inspector pointer, moderation-approved, a voided contract present and no live one. Single source of truth shared by the jobs discovery policy, the applications insert policy and the Open jobs query.';

-- ── 2) Discovery: an awaiting-replacement job is browsable like an open one ──
--  ADDITIVE permissive policy. jobs_browse_open_approved / jobs_read are left
--  exactly as they are; this only widens the OR by one precise state.
DROP POLICY IF EXISTS "jobs_browse_awaiting_replacement" ON public.jobs;
CREATE POLICY "jobs_browse_awaiting_replacement" ON public.jobs
  FOR SELECT TO authenticated
  USING (public.nx_job_awaiting_replacement(id));

-- ── 3) Application: an eligible inspector may apply to it ───────────────────
DROP POLICY IF EXISTS "applications_insert_awaiting_replacement" ON public.applications;
CREATE POLICY "applications_insert_awaiting_replacement" ON public.applications
  FOR INSERT TO authenticated
  WITH CHECK (
    applicant_id = auth.uid()
    AND public.nx_job_awaiting_replacement(job_id)
  );

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def text := pg_get_functiondef('public.nx_job_awaiting_replacement(uuid)'::regprocedure);
BEGIN
  -- (a) the predicate must stay fail-closed on every dimension
  IF position('deleted_at IS NULL'        IN v_def) = 0
     OR position('moderation_status'      IN v_def) = 0
     OR position('contractor_id      IS NULL' IN v_def) = 0
     OR position('hired_inspector_id IS NULL' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: predicate lost one of its fail-closed conditions';
  END IF;

  -- (b) it must require BOTH "a voided contract exists" and "no live contract";
  --     without the second, a healthy in-flight job would become browsable
  IF position('NOT EXISTS' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: predicate does not exclude jobs that still have a live contract';
  END IF;

  -- (c) it must be SECURITY DEFINER or the jobs policy recurses
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_job_awaiting_replacement' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_awaiting_replacement must be SECURITY DEFINER';
  END IF;

  -- (d) both new policies are attached
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='jobs' AND policyname='jobs_browse_awaiting_replacement'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs discovery policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='applications' AND policyname='applications_insert_awaiting_replacement'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applications insert policy missing';
  END IF;

  -- (e) the pre-existing gates must be untouched (additive-only guarantee)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='jobs' AND policyname='jobs_browse_open_approved'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='applications' AND policyname='applications_insert'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an existing gate was dropped — this migration must be additive';
  END IF;

  RAISE NOTICE 'awaiting-replacement jobs are now discoverable and applicable; voided contracts untouched.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
