-- ════════════════════════════════════════════════════════════════════════════
--  20260801522000_restrictive_write_block_also_blocked_reads.sql
--
--  P1 — two tables have a RESTRICTIVE policy that was meant to block WRITES and
--  silently blocked every READ as well, making the tables unreadable by anyone
--  through RLS.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  00000000000000_remote_baseline.sql declares, on public.job_disputes and
--  public.job_events:
--
--      CREATE POLICY job_disputes_no_writes ON public.job_disputes
--        AS RESTRICTIVE FOR ALL USING (false);
--
--  The intent is legible and correct: writes must go through the SECURITY
--  DEFINER RPCs (file_dispute, flag_job_dispute, resolve_job_dispute), never by
--  direct table DML. The implementation is not. Two PostgreSQL rules combine
--  badly here:
--
--    • RESTRICTIVE policies are AND-ed with the OR-ed permissive set. They can
--      only ever subtract.
--    • FOR ALL applies to SELECT as well as INSERT/UPDATE/DELETE.
--
--  So the effective SELECT predicate on job_disputes was:
--
--      (job_disputes_admin_read OR job_disputes_parties_read)   -- permissive
--      AND (deleted_at IS NULL OR is_super_admin())             -- restrictive
--      AND (false)                                              -- ← this
--    = FALSE, for every caller, forever.
--
--  Both tables carry carefully written permissive read policies —
--  job_disputes_parties_read grants the raiser and the job's client,
--  contractor and agency; job_disputes_admin_read grants super_admin — and
--  NEITHER HAS EVER RETURNED A ROW. Not to a party, not to an admin, not to a
--  super_admin. Only service_role and postgres could read, because both bypass
--  RLS entirely, which is exactly why every server-side test passed.
--
--  ── PROVEN, NOT INFERRED ───────────────────────────────────────────────────
--  Against the live 197-migration database, with one job_disputes row seeded as
--  postgres and request.jwt.claims set to the raiser:
--
--      as postgres (RLS bypass)                 : 1
--      as authenticated raiser                  : 0
--      after dropping ONLY job_disputes_no_writes: 1
--
--  and identically for job_events (2 / 0 / 1, the 1 correctly scoped to that
--  party's own job). The restrictive policy is solely responsible.
--
--  ── USER-VISIBLE CONSEQUENCE ───────────────────────────────────────────────
--  A client files a dispute; file_dispute() succeeds because it is SECURITY
--  DEFINER; the client's Disputes page then shows nothing at all. The dispute
--  exists, pauses their payout, and is invisible to the person who filed it and
--  to the admin meant to mediate it.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Say what was meant: block the three write commands, and leave SELECT to the
--  permissive read policies. Writes remain exactly as locked as before — a
--  RESTRICTIVE INSERT/UPDATE/DELETE policy with a false predicate cannot be
--  satisfied by any permissive policy, and the SECURITY DEFINER RPCs are
--  unaffected because they bypass RLS.
--
--  Also revokes the stray SELECT grant held by `anon` on both tables. It was
--  already inert (both permissive read policies require auth.uid(), which is
--  NULL for anon), but restoring reads should not leave an unauthenticated
--  grant standing on a dispute record. Defence in depth, and consistent with
--  the anon lockdown sweeps.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • hide_soft_deleted stays RESTRICTIVE FOR ALL. That one is CORRECT: it is
--     meant to subtract soft-deleted rows from reads as well as writes, and its
--     predicate is not a constant false.
--   • No permissive policy is added, widened or reworded. This migration only
--     stops an existing restrictive policy from applying to SELECT.
--   • No grant is added to any role. The only grant change is a REVOKE.
--   • No money, funding, dispatch or identity-disclosure path is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) job_disputes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS job_disputes_no_writes ON public.job_disputes;

CREATE POLICY job_disputes_no_insert ON public.job_disputes
  AS RESTRICTIVE FOR INSERT TO public WITH CHECK (false);
CREATE POLICY job_disputes_no_update ON public.job_disputes
  AS RESTRICTIVE FOR UPDATE TO public USING (false) WITH CHECK (false);
CREATE POLICY job_disputes_no_delete ON public.job_disputes
  AS RESTRICTIVE FOR DELETE TO public USING (false);

REVOKE SELECT ON public.job_disputes FROM anon;

COMMENT ON TABLE public.job_disputes IS
  'Job-scoped disputes. Writes are refused at the table by three RESTRICTIVE write-only policies and must go through file_dispute / flag_job_dispute / resolve_job_dispute (SECURITY DEFINER, RLS-bypassing). Reads are governed by job_disputes_parties_read and job_disputes_admin_read. Do NOT reinstate a single RESTRICTIVE FOR ALL USING(false) policy here: FOR ALL includes SELECT and RESTRICTIVE is AND-ed, so it makes the table unreadable by every caller including super_admin — which is what 20260801522000 repaired.';

-- ── 2) job_events ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS job_events_no_writes ON public.job_events;

CREATE POLICY job_events_no_insert ON public.job_events
  AS RESTRICTIVE FOR INSERT TO public WITH CHECK (false);
CREATE POLICY job_events_no_update ON public.job_events
  AS RESTRICTIVE FOR UPDATE TO public USING (false) WITH CHECK (false);
CREATE POLICY job_events_no_delete ON public.job_events
  AS RESTRICTIVE FOR DELETE TO public USING (false);

REVOKE SELECT ON public.job_events FROM anon;

COMMENT ON TABLE public.job_events IS
  'Append-only job event log, written by triggers. Same shape as job_disputes: RESTRICTIVE policies block the three write commands only, and job_events_parties_read / job_events_admin_read govern reads. Before 20260801522000 a RESTRICTIVE FOR ALL USING(false) policy made both read policies dead letters.';

-- ── 3) Self-test — no RESTRICTIVE policy may block SELECT with a constant ────
--  Scoped to a constant-false predicate on purpose. A restrictive policy that
--  covers SELECT is legitimate when it actually discriminates (hide_soft_deleted
--  subtracts soft-deleted rows; jobs_dept_scoping_restrictive scopes by
--  department). One whose qual is literally `false` cannot discriminate — it can
--  only make the relation unreadable, which is never what a write block means.
DO $$
DECLARE
  v_bad int;
  v_list text;
BEGIN
  SELECT count(*), string_agg(tablename || '.' || policyname, ', ')
    INTO v_bad, v_list
    FROM pg_policies
   WHERE schemaname = 'public'
     AND permissive = 'RESTRICTIVE'
     AND cmd IN ('ALL', 'SELECT')
     AND btrim(coalesce(qual, '')) = 'false';

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'RESTRICTIVE_BLOCKS_SELECT: % policy/policies make a relation unreadable: %',
      v_bad, v_list;
  END IF;

  RAISE NOTICE 'ok: no RESTRICTIVE policy blocks SELECT with a constant-false predicate.';
END $$;

-- ── 4) Self-test — writes are still refused ─────────────────────────────────
--  Reads being restored must not have cost us the write block. Asserted by
--  attempting a direct INSERT as `authenticated` and requiring it to fail.
DO $$
DECLARE
  v_client uuid;
  v_job    uuid;
  v_ok     boolean := false;
BEGIN
  SELECT id INTO v_client FROM public.profiles WHERE role = 'client' LIMIT 1;
  IF v_client IS NULL THEN
    RAISE NOTICE 'skip write-block self-test: no client profile in this database.';
    RETURN;
  END IF;
  SELECT id INTO v_job FROM public.jobs LIMIT 1;
  IF v_job IS NULL THEN
    RAISE NOTICE 'skip write-block self-test: no job in this database.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_client, 'role', 'authenticated')::text, true);

  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.job_disputes (job_id, raised_by, reason_category, reason)
      VALUES (v_job, v_client, 'quality', 'self-test: this direct INSERT must be refused');
    v_ok := true;   -- reached only if the write was ALLOWED
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := false;
  END;
  RESET ROLE;

  IF v_ok THEN
    RAISE EXCEPTION 'WRITE_BLOCK_LOST: authenticated performed a direct INSERT into job_disputes.';
  END IF;
  RAISE NOTICE 'ok: direct writes to job_disputes are still refused for authenticated.';
END $$;

COMMIT;
