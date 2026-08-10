-- ════════════════════════════════════════════════════════════════════════════
--  20260801402000_itp_write_path_lockdown.sql
--
--  Post-integration Phase 3 security review. Two ways to clear a blocking Hold
--  point without ever calling nx_itp_release_hold — which is the one function
--  that enforces "an inspector may not release their own hold". The release
--  gate was correct and simply not on the only road.
--
--  ── DEFECT 1 (CRITICAL): RAW INSERT WITH NO COLUMN PINNING ─────────────────
--  398000:206  GRANT SELECT, INSERT ON itp_point_results TO authenticated
--  398000:194  itp_results_write WITH CHECK (admin OR contractor OR team member)
--
--  The policy authorises the ROW but pins no COLUMN. Compare the sibling
--  policy for evidence, 20260801378000:82, which pins inspector_id = auth.uid().
--  So any active team member — or the contractor, i.e. the inspected party —
--  can go straight to PostgREST:
--
--    POST /rest/v1/itp_point_results
--    { point_id, job_id, result: 'pending',
--      released_at: now(), released_by: <any uuid>,
--      inspector_id: <someone else>, signed_off_by: <someone else> }
--
--  is_blocking_now (398000:271) is computed as
--      blocks_progress AND result NOT IN (passed,waived,not_applicable)
--                      AND released_at IS NULL
--  so a forged released_at silently clears the hold. The same call forges
--  attribution and sign-off — signed_off_by/at have no other writer at all.
--
--  FIX: authenticated loses INSERT entirely. nx_itp_record_result is SECURITY
--  DEFINER and is already the only writer the application has (the web actions
--  and the mobile/offline path both route through it — the offline suite
--  asserts "exactly one RPC, the canonical one"). The policy is kept and
--  tightened as defence in depth so that if a future migration re-grants
--  INSERT, the forgeable columns are still refused rather than silently open.
--
--  ── DEFECT 2 (HIGH): 'waived' CLEARS A HOLD WITHOUT A RELEASE ──────────────
--  Any team member may record any result (398000:333). 'waived' is inside the
--  cleared set at 398000:272, so recording it on a blocking point clears that
--  point — the recording inspector waives their own hold. 'waived' is an
--  ACCEPTANCE decision, not an inspection observation: it belongs to whoever
--  may release, which is exactly the rule nx_itp_release_hold already encodes.
--  passed/failed/not_applicable are untouched — those are findings, and the
--  inspector must keep recording them freely.
--
--  ── DEFECT 5 (LOW): A WITNESS POINT COULD BE WAIVED WITH NO WITNESS ────────
--  398000:347 demands witnessed_by only for passed/failed. With 'waived' now
--  admin/buyer-only the hole mostly closes, but the check is completed here so
--  it does not depend on that.
--
--  ── DEFERRED, DELIBERATELY (reported, not silently dropped) ────────────────
--  Review defect 3 (in-place UPDATE rewrites result history and reassigns
--  inspector_id without a job_events row) and defect 4 (the NCR link-back never
--  persists because there is no UPDATE policy, so the idempotency guard is
--  dead and one failed point can raise unlimited flash reports) are REAL and
--  remain open. Both change the result-row lifecycle — supersession instead of
--  update — which is a schema-shaped change, not a lockdown, and it must not be
--  bolted onto a security fix. Tracked as the first Phase 3 follow-up.
--
--  ── VERIFIED NOT CHANGED ───────────────────────────────────────────────────
--  No table, no reader, no RPC signature. nx_itp_release_hold is untouched: it
--  was always correct. No money column is read or written anywhere here, and
--  nothing in this file can trigger a settlement.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── DEFECT 1: the only road to a result row is the canonical RPC ────────────
REVOKE INSERT ON TABLE public.itp_point_results FROM authenticated;

--  Kept and tightened rather than dropped. If some later migration re-grants
--  INSERT, this refuses the forgeable columns instead of silently reopening the
--  hold bypass. nx_itp_record_result is SECURITY DEFINER (owner = postgres) and
--  is not subject to this policy, so the canonical path is unaffected.
DROP POLICY IF EXISTS itp_results_write ON public.itp_point_results;
CREATE POLICY itp_results_write ON public.itp_point_results
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Attribution may not be forged: you record as yourself.
    itp_point_results.inspector_id = auth.uid()
    -- Release and sign-off are NOT recording acts. They have their own
    -- authority (nx_itp_release_hold) and may never be set on insert.
    AND itp_point_results.released_at  IS NULL
    AND itp_point_results.released_by  IS NULL
    AND itp_point_results.signed_off_at IS NULL
    AND itp_point_results.signed_off_by IS NULL
    AND (
      public.nx_is_admin()
      OR EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = itp_point_results.job_id AND j.contractor_id = auth.uid())
      OR public.nx_is_active_job_team_member(itp_point_results.job_id, auth.uid())
    )
  );

COMMENT ON POLICY itp_results_write ON public.itp_point_results IS
  'Defence in depth only — authenticated no longer holds INSERT, so the canonical SECURITY DEFINER RPC nx_itp_record_result is the sole writer. Previously this policy authorised the row but pinned no column, letting any team member POST a result carrying released_at/released_by and clear a blocking Hold point without ever calling nx_itp_release_hold, while also forging inspector_id and sign-off.';

-- ── DEFECT 2 + 5: waiving is an acceptance decision, not an observation ─────
CREATE OR REPLACE FUNCTION public.nx_itp_may_waive(
  p_job_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- The same audience nx_itp_release_hold trusts: admin, or the buyer
  -- principal. Deliberately NOT the contractor or the inspection team — a
  -- waiver by the inspected party is the bypass this closes.
  SELECT public.nx_is_admin(p_uid)
      OR EXISTS (
           SELECT 1 FROM public.jobs j
            WHERE j.id = p_job_id
              AND COALESCE(j.agency_id, j.client_id) = p_uid);
$$;
ALTER FUNCTION public.nx_itp_may_waive(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_itp_may_waive(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_itp_may_waive(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_itp_may_waive(uuid, uuid) IS
  'May this user WAIVE an ITP point on this job? Admin or the buyer principal (COALESCE(agency_id, client_id)) only. A waiver accepts a nonconformity, so it carries release authority, not recording authority — otherwise the inspector who recorded a blocking Hold could waive it themselves and never reach nx_itp_release_hold.';

--  Patch the two new preconditions into the canonical recorder without
--  restating the rest of it. Refuses to guess if the body has moved.
DO $patch$
DECLARE
  v_src text;
  v_new text;
  v_anchor text := 'IF NOT (public.nx_is_admin()';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'nx_itp_record_result';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 398000 must apply before 402000';
  END IF;
  IF strpos(v_src, v_anchor) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_itp_record_result no longer matches the 398000 shape this migration patches — refusing to rewrite a function that changed underneath it';
  END IF;

  v_new := replace(v_src, v_anchor,
    'IF p_result = ''waived'' AND NOT public.nx_itp_may_waive(p_job_id) THEN'
 || E'\n    RAISE EXCEPTION ''ITP_WAIVE_DENIED: waiving an ITP point accepts a nonconformity and requires release authority (admin or the buyer). Record passed/failed/not_applicable, or ask for a hold release.'''
 || E'\n      USING ERRCODE = ''42501'';'
 || E'\n  END IF;'
 || E'\n  ' || v_anchor);

  IF v_new = v_src THEN
    RAISE EXCEPTION 'SELFTEST: the waive precondition was not inserted';
  END IF;
  EXECUTE v_new;
END
$patch$;

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_src text;
BEGIN
  IF has_table_privilege('authenticated', 'public.itp_point_results', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated still holds INSERT on itp_point_results — the Hold bypass is still open';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.itp_point_results', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated lost SELECT on itp_point_results — the ITP register would go blank';
  END IF;

  -- The tightened policy must actually pin the forgeable columns.
  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_src
    FROM pg_policy pol WHERE pol.polname = 'itp_results_write';
  IF v_src IS NULL OR strpos(v_src, 'released_at') = 0 OR strpos(v_src, 'signed_off_by') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: itp_results_write does not pin the release/sign-off columns';
  END IF;

  v_src := regexp_replace(
             pg_get_functiondef('public.nx_itp_record_result(uuid,uuid,text,uuid,text,text)'::regprocedure),
             '--[^\n]*', '', 'g');
  IF strpos(v_src, 'ITP_WAIVE_DENIED') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: an inspector can still waive their own blocking Hold point';
  END IF;

  -- Everything this migration must NOT have disturbed.
  IF to_regprocedure('public.nx_itp_release_hold(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: nx_itp_release_hold was disturbed — it was always correct';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.nx_itp_record_result(uuid,uuid,text,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REGRESSION: the canonical recorder is no longer callable — ITP execution would be dead';
  END IF;
END
$verify$;

COMMIT;
